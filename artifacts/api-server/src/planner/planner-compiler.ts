import type {
  CandidatePlan,
  CandidateNode,
  CompilerContext,
  CompilationResult,
  ExecutionGraph,
  GraphNode,
  GraphEdge,
  InputBinding,
  NodeApprovalInfo,
  NodeVerificationSpec,
  NodeRetryPolicy,
  ValidationDiagnostic,
  PlannerErrorCode,
} from "./types";
import {
  CURRENT_GRAPH_SCHEMA_VERSION,
  MAX_GRAPH_NODES,
  MAX_NODE_RETRIES,
  MIN_NODE_TIMEOUT_MS,
  MAX_NODE_TIMEOUT_MS,
} from "./types";
import { GraphValidator } from "./graph-validator";
import { logger } from "../lib/logger";

const DEFAULT_RETRY_BACKOFF_MS = 1000;
const DEFAULT_NODE_TIMEOUT_MS = 30000;

export class PlannerCompiler {
  static compile(candidate: CandidatePlan, context: CompilerContext): CompilationResult {
    const correlationMeta = {
      requestId: context.requestId,
      taskId: context.taskId,
      graphId: context.graphId || candidate.graphId,
      planRevision: context.planRevision || 1,
    };

    logger.info(correlationMeta, "PLAN_COMPILATION_STARTED");
    const diagnostics: ValidationDiagnostic[] = [];

    if (!candidate || !Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
      diagnostics.push({ severity: "error", code: "EMPTY_GRAPH", message: "Candidate plan must contain at least one node." });
      logger.warn(correlationMeta, "PLAN_COMPILATION_FAILED: candidate has no nodes");
      return { success: false, diagnostics, errorCode: "PLAN_COMPILATION_FAILED" };
    }

    if (candidate.nodes.length > MAX_GRAPH_NODES) {
      diagnostics.push({ severity: "error", code: "GRAPH_SIZE_EXCEEDED", message: `Candidate plan contains ${candidate.nodes.length} nodes, exceeding limit of ${MAX_GRAPH_NODES}.` });
      logger.warn(correlationMeta, "PLAN_COMPILATION_FAILED: graph size exceeded");
      return { success: false, diagnostics, errorCode: "PLAN_COMPILATION_FAILED" };
    }

    const idMap = new Map<string, string>();
    const canonicalNodesList: Array<{ candidate: CandidateNode; canonicalId: string }> = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < candidate.nodes.length; i++) {
      const cNode = candidate.nodes[i];
      let canonicalId = "";
      if (cNode.id && /^[a-zA-Z0-9_-]{1,64}$/.test(cNode.id) && !usedIds.has(cNode.id)) {
        canonicalId = cNode.id;
      } else {
        const slug = (cNode.title || cNode.type || "step").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 32);
        canonicalId = `step_${i + 1}_${slug || "action"}`;
      }
      let uniqueId = canonicalId;
      let counter = 1;
      while (usedIds.has(uniqueId)) uniqueId = `${canonicalId}_${counter++}`;
      canonicalId = uniqueId;
      usedIds.add(canonicalId);
      if (cNode.id) idMap.set(cNode.id, canonicalId);
      if (cNode.title) idMap.set(cNode.title, canonicalId);
      idMap.set(String(i), canonicalId);
      canonicalNodesList.push({ candidate: cNode, canonicalId });
    }

    const compiledNodes: Record<string, GraphNode> = {};

    for (const { candidate: cNode, canonicalId } of canonicalNodesList) {
      if (cNode.type === "llm_reasoning") {
        if (cNode.actionSpec) diagnostics.push({ severity: "error", code: "LLM_REASONING_CANNOT_HAVE_TOOL_ACTION", message: `Node "${canonicalId}" is of type "llm_reasoning" but specifies an actionSpec.`, nodeId: canonicalId });
        if (!cNode.reasoningSpec || !cNode.reasoningSpec.prompt?.trim()) diagnostics.push({ severity: "error", code: "MISSING_REASONING_SPEC", message: `Node "${canonicalId}" is of type "llm_reasoning" but is missing a valid reasoningSpec.prompt.`, nodeId: canonicalId });
      } else if (cNode.type === "tool_call") {
        if (!cNode.actionSpec || !cNode.actionSpec.toolName?.trim()) diagnostics.push({ severity: "error", code: "MISSING_TOOL_ACTION_SPEC", message: `Node "${canonicalId}" is of type "tool_call" but is missing actionSpec.toolName.`, nodeId: canonicalId });
      }

      let approval: NodeApprovalInfo = {
        status: (cNode.approval?.status as NodeApprovalInfo["status"]) || "not_required",
        reason: cNode.approval?.reason || "Standard step",
        requestedAt: cNode.approval?.requestedAt,
        resolvedAt: cNode.approval?.resolvedAt,
        expiresAt: cNode.approval?.expiresAt,
        resolvedByUserId: cNode.approval?.resolvedByUserId,
      };

      if (cNode.type === "tool_call" && cNode.actionSpec?.toolName && context.toolRegistry) {
        const toolName = cNode.actionSpec.toolName.trim();
        const tool = context.toolRegistry.get(toolName);
        if (!tool) {
          diagnostics.push({ severity: "error", code: "UNKNOWN_TOOL_IN_PLAN", message: `Tool "${toolName}" in node "${canonicalId}" does not exist in ToolRegistry. Plan rejected.`, nodeId: canonicalId });
        } else {
          const policy = context.toolRegistry.getPolicy(toolName);
          if (context.userCapabilities && policy.requiredCapabilities.length > 0) {
            const userCaps = new Set(context.userCapabilities);
            const missingCaps = policy.requiredCapabilities.filter((c: string) => !userCaps.has(c));
            if (missingCaps.length > 0) diagnostics.push({ severity: "error", code: "UNAUTHORIZED_TOOL_CAPABILITY", message: `User lacks required capabilities [${missingCaps.join(", ")}] for tool "${toolName}" in node "${canonicalId}". Plan rejected.`, nodeId: canonicalId });
          }
          const requiresConfirmation = policy.destructive || policy.confirmationRequired;
          if (requiresConfirmation) {
            if (cNode.approval?.status === "not_required") diagnostics.push({ severity: "error", code: "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE", message: `Tool "${toolName}" in node "${canonicalId}" requires confirmation by registry policy.`, nodeId: canonicalId });
            else approval = {
              status: cNode.approval?.status || "pending",
              reason: cNode.approval?.reason || `Registry security policy mandates confirmation for tool "${toolName}".`,
              requestedAt: cNode.approval?.requestedAt || context.timestamp || new Date().toISOString(),
              resolvedAt: cNode.approval?.resolvedAt,
              expiresAt: cNode.approval?.expiresAt,
              resolvedByUserId: cNode.approval?.resolvedByUserId,
            };
          }
        }
      } else if (cNode.type === "user_checkpoint") {
        approval = {
          status: cNode.approval?.status || "pending",
          reason: cNode.approval?.reason || `User checkpoint: ${cNode.title}`,
          requestedAt: cNode.approval?.requestedAt || context.timestamp || new Date().toISOString(),
        };
      }

      const inputBindings: Record<string, InputBinding> = {};
      if (cNode.inputBindings) {
        for (const [paramKey, binding] of Object.entries(cNode.inputBindings)) {
          if (!binding || !binding.source) {
            diagnostics.push({ severity: "error", code: "MALFORMED_INPUT_BINDING", message: `Node "${canonicalId}" parameter "${paramKey}" has malformed binding.`, nodeId: canonicalId });
            continue;
          }
          if (binding.source.type === "node_output") {
            const resolvedTargetId = idMap.get(binding.source.nodeId) || binding.source.nodeId;
            inputBindings[paramKey] = { source: { type: "node_output", nodeId: resolvedTargetId, path: binding.source.path || "output" } };
          } else inputBindings[paramKey] = binding;
        }
      }

      const verification: NodeVerificationSpec = {
        required: cNode.verification?.required ?? false,
        strategy: cNode.verification?.strategy ?? "none",
        schemaOrRule: cNode.verification?.schemaOrRule,
        assertionExpression: cNode.verification?.assertionExpression,
        reviewPrompt: cNode.verification?.reviewPrompt,
      };
      if (verification.required && verification.strategy === "none") diagnostics.push({ severity: "error", code: "INVALID_VERIFICATION_STRATEGY", message: `Node "${canonicalId}" requires verification but strategy is set to "none".`, nodeId: canonicalId });

      const candidateMaxAttempts = cNode.retryPolicy?.maxAttempts;
      if (typeof candidateMaxAttempts === "number" && (!Number.isInteger(candidateMaxAttempts) || candidateMaxAttempts < 1 || candidateMaxAttempts > MAX_NODE_RETRIES)) diagnostics.push({ severity: "error", code: "INVALID_RETRY_POLICY", message: `Node "${canonicalId}" requested maxAttempts ${candidateMaxAttempts}, which is outside the allowed range [1, ${MAX_NODE_RETRIES}].`, nodeId: canonicalId });
      if (typeof cNode.timeoutMs === "number" && (cNode.timeoutMs < MIN_NODE_TIMEOUT_MS || cNode.timeoutMs > MAX_NODE_TIMEOUT_MS)) diagnostics.push({ severity: "error", code: "INVALID_TIMEOUT", message: `Node "${canonicalId}" requested timeoutMs ${cNode.timeoutMs}, which is outside allowed range [${MIN_NODE_TIMEOUT_MS}, ${MAX_NODE_TIMEOUT_MS}].`, nodeId: canonicalId });

      let effectiveMaxAttempts = typeof candidateMaxAttempts === "number" ? candidateMaxAttempts : 1;
      let effectiveTimeoutMs = typeof cNode.timeoutMs === "number" ? cNode.timeoutMs : DEFAULT_NODE_TIMEOUT_MS;
      const backoffMs = typeof cNode.retryPolicy?.backoffMs === "number" ? Math.max(100, cNode.retryPolicy.backoffMs) : DEFAULT_RETRY_BACKOFF_MS;

      if (cNode.type === "tool_call" && cNode.actionSpec?.toolName && context.toolRegistry) {
        const policy = context.toolRegistry.getPolicy(cNode.actionSpec.toolName);
        effectiveTimeoutMs = typeof cNode.timeoutMs === "number" ? cNode.timeoutMs : policy.timeoutMs;
        if (!policy.idempotent || policy.sideEffect || policy.destructive || policy.confirmationRequired) effectiveMaxAttempts = 1;
      }

      effectiveMaxAttempts = Math.max(1, Math.min(effectiveMaxAttempts, MAX_NODE_RETRIES));
      effectiveTimeoutMs = Math.max(MIN_NODE_TIMEOUT_MS, Math.min(effectiveTimeoutMs, MAX_NODE_TIMEOUT_MS));

      compiledNodes[canonicalId] = {
        id: canonicalId,
        title: cNode.title || canonicalId,
        type: cNode.type,
        actionSpec: cNode.type === "tool_call" ? cNode.actionSpec : undefined,
        reasoningSpec: cNode.type === "llm_reasoning" ? cNode.reasoningSpec : undefined,
        memorySpec: cNode.type === "memory_write" ? cNode.memorySpec : undefined,
        inputBindings,
        status: "pending",
        approval,
        verification,
        retryPolicy: { maxAttempts: effectiveMaxAttempts, backoffMs },
        timeoutMs: effectiveTimeoutMs,
      };
    }

    const compiledEdges: GraphEdge[] = [];
    const seenEdges = new Set<string>();
    if (candidate.edges && Array.isArray(candidate.edges)) {
      for (const edge of candidate.edges) {
        const fromId = idMap.get(edge.fromNodeId) || edge.fromNodeId;
        const toId = idMap.get(edge.toNodeId) || edge.toNodeId;
        if (fromId === toId) {
          diagnostics.push({ severity: "error", code: "SELF_EDGE_DETECTED", message: `Self-edge detected on node "${fromId}".`, edge: { from: fromId, to: toId } });
          continue;
        }
        const edgeKey = `${fromId}->${toId}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          compiledEdges.push({ fromNodeId: fromId, toNodeId: toId, dependencyType: edge.dependencyType || "hard", condition: edge.condition });
        }
      }
    }
    for (const { candidate: cNode, canonicalId } of canonicalNodesList) {
      for (const dep of cNode.dependsOn || []) {
        const fromId = idMap.get(dep) || dep;
        const toId = canonicalId;
        if (fromId === toId) {
          diagnostics.push({ severity: "error", code: "SELF_EDGE_DETECTED", message: `Node "${canonicalId}" declares dependency on itself.`, edge: { from: fromId, to: toId } });
          continue;
        }
        const edgeKey = `${fromId}->${toId}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          compiledEdges.push({ fromNodeId: fromId, toNodeId: toId, dependencyType: "hard" });
        }
      }
    }

    const derivedStepCount = Object.keys(compiledNodes).length;
    const requiresApproval = Object.values(compiledNodes).some((node) => node.approval.status === "pending" || node.type === "user_checkpoint");
    const nowIso = context.timestamp || new Date().toISOString();
    const graphId = context.graphId || candidate.graphId || `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const planRevision = context.planRevision || 1;
    const revisionId = `${graphId}:r${planRevision}`;

    const graph: ExecutionGraph = {
      schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
      graphId,
      planRevision,
      revisionId,
      parentRevisionId: context.parentRevisionId,
      telegramUserId: context.telegramUserId,
      goal: candidate.goal,
      status: requiresApproval ? "paused_for_approval" : "ready",
      nodes: compiledNodes,
      edges: compiledEdges,
      effectivePolicy: context.effectivePolicy,
      metadata: {
        model: context.plannerModel,
        derivedStepCount,
        advisoryEstimatedSteps: candidate.advisoryEstimatedSteps,
        requiresApproval,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };

    const hardCompileErrors = diagnostics.filter((d) => d.severity === "error");
    if (hardCompileErrors.length > 0) {
      const errorCode = this.classifyErrorCode(hardCompileErrors[0].code);
      logger.warn({ ...correlationMeta, errorCode, errorCount: hardCompileErrors.length }, "PLAN_COMPILATION_FAILED: validation diagnostics present");
      return { success: false, diagnostics, errorCode };
    }

    logger.info(correlationMeta, "PLAN_VALIDATION_STARTED");
    const validationResult = GraphValidator.validate(graph, { toolRegistry: context.toolRegistry, userCapabilities: context.userCapabilities, userId: context.telegramUserId });
    if (!validationResult.valid) {
      const allErrors = [...diagnostics, ...validationResult.errors];
      const errorCode = this.classifyErrorCode(validationResult.errors[0]?.code);
      logger.warn({ ...correlationMeta, errorCode, errors: validationResult.errors }, "PLAN_VALIDATION_COMPLETED: rejected");
      return { success: false, diagnostics: allErrors, errorCode };
    }

    logger.info(correlationMeta, "PLAN_VALIDATION_COMPLETED: passed");
    logger.info(correlationMeta, "PLAN_COMPILATION_COMPLETED: success");
    return { success: true, graph, diagnostics: [...diagnostics, ...validationResult.warnings], topologicalOrder: validationResult.topologicalOrder };
  }

  private static classifyErrorCode(code?: string): PlannerErrorCode {
    switch (code) {
      case "UNAUTHORIZED_TOOL_CAPABILITY": return "UNAUTHORIZED_TOOL_CAPABILITY";
      case "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE": return "APPROVAL_REQUIRED";
      case "UNKNOWN_TOOL_IN_PLAN": return "PLAN_REJECTED";
      case "BINDING_TARGET_NODE_NOT_FOUND":
      case "BINDING_SELF_REFERENCE":
      case "BINDING_SOURCE_NOT_ANCESTOR":
      case "INVALID_BINDING_PATH":
      case "UNDEFINED_LITERAL_BINDING":
      case "MALFORMED_INPUT_BINDING": return "INVALID_INPUT_BINDING";
      case "CYCLE_DETECTED":
      case "SELF_EDGE_DETECTED":
      case "DUPLICATE_EDGE_DETECTED":
      case "INVALID_EDGE_NODE_REFERENCE":
      case "NO_SOURCE_NODE":
      case "NO_TERMINAL_NODE":
      case "UNREACHABLE_NODE_DETECTED": return "INVALID_DEPENDENCY";
      case "GRAPH_SIZE_EXCEEDED":
      case "EMPTY_GRAPH":
      case "INVALID_GRAPH_ID":
      case "UNSUPPORTED_SCHEMA_VERSION":
      case "INVALID_PLAN_REVISION":
      case "INVALID_RETRY_POLICY":
      case "INVALID_TIMEOUT":
      case "LLM_REASONING_CANNOT_HAVE_TOOL_ACTION":
      case "MISSING_REASONING_SPEC":
      case "MISSING_TOOL_ACTION_SPEC":
      case "INVALID_VERIFICATION_STRATEGY": return "PLAN_COMPILATION_FAILED";
      default: return "PLAN_VALIDATION_FAILED";
    }
  }
}
