import type {
  ExecutionGraph,
  GraphNode,
  ValidationResult,
  ValidationDiagnostic,
} from "./types";
import {
  CURRENT_GRAPH_SCHEMA_VERSION,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_NODE_RETRIES,
  MIN_NODE_TIMEOUT_MS,
  MAX_NODE_TIMEOUT_MS,
  MAX_TOOL_CALLS,
  MAX_PLAN_REVISIONS,
} from "./types";
import { ToolRegistry, type ToolSecurityPolicy } from "../tools/tool-registry";

export interface ValidatorContext {
  toolRegistry?: ToolRegistry;
  userCapabilities?: string[]; userTier?: string; allowedDomains?: string[];
  userId?: number;
}

export class GraphValidator {
  /**
   * Validates an ExecutionGraph against all structural, topological, security, and invariant constraints.
   */
  static validate(
    graph: ExecutionGraph,
    context: ValidatorContext = {},
  ): ValidationResult {
    const errors: ValidationDiagnostic[] = [];
    const warnings: ValidationDiagnostic[] = [];
    const effectivePolicies: Record<string, ToolSecurityPolicy> = {};

    // 1. Schema Version & ID Validation
    if (graph.schemaVersion !== CURRENT_GRAPH_SCHEMA_VERSION) {
      errors.push({
        severity: "error",
        code: "UNSUPPORTED_SCHEMA_VERSION",
        message: `Schema version ${graph.schemaVersion} is not supported. Current supported version is ${CURRENT_GRAPH_SCHEMA_VERSION}.`,
      });
    }

    if (!graph.graphId || !/^[a-zA-Z0-9_-]{3,64}$/.test(graph.graphId)) {
      errors.push({
        severity: "error",
        code: "INVALID_GRAPH_ID",
        message: `Graph ID "${graph.graphId}" is invalid. Must be 3-64 characters matching [a-zA-Z0-9_-].`,
      });
    }

    if (!Number.isInteger(graph.planRevision) || graph.planRevision < 1) {
      errors.push({
        severity: "error",
        code: "INVALID_PLAN_REVISION",
        message: `Plan revision must be an integer >= 1 (got: ${graph.planRevision}).`,
      });
    } else if (graph.planRevision > MAX_PLAN_REVISIONS) {
      errors.push({
        severity: "error",
        code: "PLAN_REVISION_LIMIT_EXCEEDED",
        message: `Plan revision (${graph.planRevision}) exceeds maximum allowed limit of ${MAX_PLAN_REVISIONS}.`,
      });
    }

    // 2. Graph Size Bounds
    const nodeKeys = Object.keys(graph.nodes || {});
    const totalNodes = nodeKeys.length;
    const totalEdges = (graph.edges || []).length;
    
    const maxNodesLimit = graph.effectivePolicy?.maxNodes || MAX_GRAPH_NODES;
    const maxEdgesLimit = graph.effectivePolicy?.maxEdges || MAX_GRAPH_EDGES;
    const maxToolCallsLimit = graph.effectivePolicy?.maxToolCalls || MAX_TOOL_CALLS;

    if (totalNodes > maxNodesLimit) {
      errors.push({
        severity: "error",
        code: "GRAPH_SIZE_EXCEEDED",
        message: `Graph node count (${totalNodes}) exceeds effective budget limit of ${maxNodesLimit}.`,
      });
    }

    if (totalEdges > maxEdgesLimit) {
      errors.push({
        severity: "error",
        code: "GRAPH_EDGES_EXCEEDED",
        message: `Graph edge count (${totalEdges}) exceeds effective budget limit of ${maxEdgesLimit}.`,
      });
    }

    let toolCallCount = 0;
    for (const node of Object.values(graph.nodes || {})) {
      if (node && node.type === "tool_call") {
        toolCallCount++;
      }
    }
    if (toolCallCount > maxToolCallsLimit) {
      errors.push({
        severity: "error",
        code: "TOOL_CALL_LIMIT_EXCEEDED",
        message: `Graph tool call count (${toolCallCount}) exceeds effective budget limit of ${maxToolCallsLimit}.`,
      });
    }

    if (totalNodes === 0) {
      errors.push({
        severity: "error",
        code: "EMPTY_GRAPH",
        message: "Execution graph must contain at least one node.",
      });
      return {
        valid: false,
        errors,
        warnings,
        derivedStepCount: 0,
      };
    }

    if (totalNodes > MAX_GRAPH_NODES) {
      errors.push({
        severity: "error",
        code: "GRAPH_SIZE_EXCEEDED",
        message: `Graph node count (${totalNodes}) exceeds effective budget of ${MAX_GRAPH_NODES}.`, 
      });
    }

    // 3. Node Validation & Boundaries
    for (const [key, node] of Object.entries(graph.nodes)) {
      if (!node) {
        errors.push({
          severity: "error",
          code: "NULL_NODE_ENTRY",
          message: `Node entry at key "${key}" is null or undefined.`,
        });
        continue;
      }

      if (key !== node.id) {
        errors.push({
          severity: "error",
          code: "NODE_KEY_MISMATCH",
          message: `Node dictionary key "${key}" does not match node.id "${node.id}".`,
          nodeId: node.id,
        });
      }

      if (!node.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id)) {
        errors.push({
          severity: "error",
          code: "INVALID_NODE_ID",
          message: `Node ID "${node.id}" is invalid. Must match [a-zA-Z0-9_-]{1,64}.`,
          nodeId: node.id,
        });
      }

      // Retry policy validation
      if (
        !node.retryPolicy ||
        typeof node.retryPolicy.maxAttempts !== "number" ||
        node.retryPolicy.maxAttempts < 0 ||
        node.retryPolicy.maxAttempts > MAX_NODE_RETRIES
      ) {
        errors.push({
          severity: "error",
          code: "INVALID_RETRY_POLICY",
          message: `Node "${node.id}" retry maxAttempts must be between 0 and ${MAX_NODE_RETRIES}.`,
          nodeId: node.id,
        });
      }

      // Timeout validation
      if (
        typeof node.timeoutMs !== "number" ||
        node.timeoutMs < MIN_NODE_TIMEOUT_MS ||
        node.timeoutMs > MAX_NODE_TIMEOUT_MS
      ) {
        errors.push({
          severity: "error",
          code: "INVALID_TIMEOUT",
          message: `Node "${node.id}" timeoutMs (${node.timeoutMs}) must be between ${MIN_NODE_TIMEOUT_MS}ms and ${MAX_NODE_TIMEOUT_MS}ms.`,
          nodeId: node.id,
        });
      }

      // Action type boundaries (Strict boundaries around llm_reasoning & tool_call)
      this.validateNodeActionBoundaries(node, context, errors, effectivePolicies);

      // Verification spec validation
      if (node.verification?.required) {
        if (node.verification.strategy === "none") {
          errors.push({
            severity: "error",
            code: "INVALID_VERIFICATION_STRATEGY",
            message: `Node "${node.id}" requires verification but strategy is set to "none".`,
            nodeId: node.id,
          });
        }
        if (node.verification.strategy === "schema" && !node.verification.schemaOrRule) {
          errors.push({
            severity: "error",
            code: "MISSING_VERIFICATION_SCHEMA",
            message: `Node "${node.id}" uses "schema" verification but no schemaOrRule is provided.`,
            nodeId: node.id,
          });
        }
        if (
          node.verification.strategy === "assertion" &&
          (!node.verification.assertionExpression || !node.verification.assertionExpression.trim())
        ) {
          errors.push({
            severity: "error",
            code: "MISSING_VERIFICATION_ASSERTION",
            message: `Node "${node.id}" uses "assertion" verification but no assertionExpression is provided.`,
            nodeId: node.id,
          });
        }
      }
    }

    // 4. Edge Validation & Graph Adjacency Construction
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const nodeId of nodeKeys) {
      adj.set(nodeId, []);
      inDegree.set(nodeId, 0);
      outDegree.set(nodeId, 0);
    }

    const seenEdges = new Set<string>();

    for (const edge of graph.edges || []) {
      const fromExists = !!graph.nodes[edge.fromNodeId];
      const toExists = !!graph.nodes[edge.toNodeId];

      if (!fromExists || !toExists) {
        errors.push({
          severity: "error",
          code: "INVALID_EDGE_NODE_REFERENCE",
          message: `Edge references non-existent node(s): from "${edge.fromNodeId}" (exists: ${fromExists}), to "${edge.toNodeId}" (exists: ${toExists}).`,
          edge: { from: edge.fromNodeId, to: edge.toNodeId },
        });
        continue;
      }

      if (edge.fromNodeId === edge.toNodeId) {
        errors.push({
          severity: "error",
          code: "SELF_EDGE_DETECTED",
          message: `Self-directed edge detected on node "${edge.fromNodeId}". Graph must be strictly acyclic.`,
          edge: { from: edge.fromNodeId, to: edge.toNodeId },
        });
        continue;
      }

      const edgeKey = `${edge.fromNodeId}->${edge.toNodeId}`;
      if (seenEdges.has(edgeKey)) {
        errors.push({
          severity: "error",
          code: "DUPLICATE_EDGE_DETECTED",
          message: `Duplicate edge detected between "${edge.fromNodeId}" and "${edge.toNodeId}".`,
          edge: { from: edge.fromNodeId, to: edge.toNodeId },
        });
        continue;
      }
      seenEdges.add(edgeKey);

      adj.get(edge.fromNodeId)!.push(edge.toNodeId);
      inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
      outDegree.set(edge.fromNodeId, (outDegree.get(edge.fromNodeId) || 0) + 1);
    }

    // 5. Kahn's Algorithm for Topological Sort & Cycle Detection
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    const topologicalOrder: string[] = [];
    const inDegreeCopy = new Map(inDegree);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      topologicalOrder.push(curr);

      for (const neighbor of adj.get(curr) || []) {
        const nextDeg = (inDegreeCopy.get(neighbor) || 1) - 1;
        inDegreeCopy.set(neighbor, nextDeg);
        if (nextDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (topologicalOrder.length !== totalNodes) {
      const cycleNodes = [...inDegreeCopy.entries()]
        .filter(([, deg]) => deg > 0)
        .map(([nodeId]) => nodeId);

      errors.push({
        severity: "error",
        code: "CYCLE_DETECTED",
        message: `Cycle detected in graph! The following nodes are part of a cyclic dependency: [${cycleNodes.join(", ")}]. Graph must be a strictly acyclic DAG.`,
      });
    }

    // 6. Source and Terminal Node Invariants
    const sourceNodes = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
    const terminalNodes = [...outDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);

    if (sourceNodes.length === 0) {
      errors.push({
        severity: "error",
        code: "NO_SOURCE_NODE",
        message: "Graph must have at least one source entry node (in-degree = 0).",
      });
    }

    if (terminalNodes.length === 0) {
      errors.push({
        severity: "error",
        code: "NO_TERMINAL_NODE",
        message: "Graph must have at least one terminal exit node (out-degree = 0).",
      });
    }

    // 7. Reachability & Disconnected Node Check
    if (totalNodes > 1) {
      // 7a. Check for completely isolated nodes (0 incoming, 0 outgoing edges)
      for (const nodeId of nodeKeys) {
        const inDeg = inDegree.get(nodeId) || 0;
        const outDeg = outDegree.get(nodeId) || 0;
        if (inDeg === 0 && outDeg === 0) {
          errors.push({
            severity: "error",
            code: "UNREACHABLE_NODE_DETECTED",
            message: `Node "${nodeId}" is completely isolated with no incoming or outgoing connections in a multi-node graph.`,
            nodeId,
          });
        }
      }

      // 7b. Check for weakly connected components across all nodes
      const undirectedAdj = new Map<string, string[]>();
      for (const id of nodeKeys) {
        undirectedAdj.set(id, []);
      }
      for (const edge of graph.edges || []) {
        if (graph.nodes[edge.fromNodeId] && graph.nodes[edge.toNodeId]) {
          undirectedAdj.get(edge.fromNodeId)?.push(edge.toNodeId);
          undirectedAdj.get(edge.toNodeId)?.push(edge.fromNodeId);
        }
      }

      const visited = new Set<string>();
      const startNode = nodeKeys[0];
      const bfsQueue = [startNode];
      visited.add(startNode);

      while (bfsQueue.length > 0) {
        const curr = bfsQueue.shift()!;
        for (const neighbor of undirectedAdj.get(curr) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            bfsQueue.push(neighbor);
          }
        }
      }

      for (const nodeId of nodeKeys) {
        if (!visited.has(nodeId)) {
          // Avoid duplicate errors if already flagged as isolated
          const alreadyFlagged = errors.some(
            (e) => e.code === "UNREACHABLE_NODE_DETECTED" && e.nodeId === nodeId,
          );
          if (!alreadyFlagged) {
            errors.push({
              severity: "error",
              code: "UNREACHABLE_NODE_DETECTED",
              message: `Node "${nodeId}" is in a disconnected subgraph component. Graph must be a unified execution plan.`,
              nodeId,
            });
          }
        }
      }
    }

    // 8. Ancestor Set Computation & Input Binding Validation
    const ancestors = this.computeAncestors(nodeKeys, adj, topologicalOrder);
    this.validateInputBindings(graph, ancestors, errors);

    // 9. Derived Step Count & Advisory Metadata Invariant
    const derivedStepCount = totalNodes;
    if (graph.metadata?.derivedStepCount !== derivedStepCount) {
      warnings.push({
        severity: "warning",
        code: "DERIVED_STEP_COUNT_NORMALIZED",
        message: `Derived step count in metadata (${graph.metadata?.derivedStepCount}) did not match node count (${derivedStepCount}). Normalized to actual node count.`,
      });
    }

    if (
      graph.metadata?.advisoryEstimatedSteps !== undefined &&
      graph.metadata.advisoryEstimatedSteps !== derivedStepCount
    ) {
      warnings.push({
        severity: "warning",
        code: "ADVISORY_METADATA_MISMATCH",
        message: `Model advisoryEstimatedSteps (${graph.metadata.advisoryEstimatedSteps}) differs from actual derived step count (${derivedStepCount}).`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      topologicalOrder: errors.length === 0 ? topologicalOrder : undefined,
      derivedStepCount,
      effectivePolicies,
    };
  }

  /**
   * Enforces strict boundaries around node action types:
   * - llm_reasoning: pure transformation, no tool invocation.
   * - tool_call: tool registry check, capability check, destructive action approval gating.
   * - memory_write: key and content validation.
   */
  private static validateNodeActionBoundaries(
    node: GraphNode,
    context: ValidatorContext,
    errors: ValidationDiagnostic[],
    effectivePolicies: Record<string, ToolSecurityPolicy>,
  ): void {
    if (node.type === "llm_reasoning") {
      if (node.actionSpec) {
        errors.push({
          severity: "error",
          code: "LLM_REASONING_CANNOT_HAVE_TOOL_ACTION",
          message: `Node "${node.id}" is of type "llm_reasoning" but specifies an actionSpec. LLM reasoning nodes must be pure transformations with zero external tool calls.`,
          nodeId: node.id,
        });
      }
      if (!node.reasoningSpec || !node.reasoningSpec.prompt?.trim()) {
        errors.push({
          severity: "error",
          code: "MISSING_REASONING_SPEC",
          message: `Node "${node.id}" is of type "llm_reasoning" but is missing a valid reasoningSpec.prompt.`,
          nodeId: node.id,
        });
      }
    } else if (node.type === "tool_call") {
      if (!node.actionSpec || !node.actionSpec.toolName?.trim()) {
        errors.push({
          severity: "error",
          code: "MISSING_TOOL_ACTION_SPEC",
          message: `Node "${node.id}" is of type "tool_call" but is missing actionSpec.toolName.`,
          nodeId: node.id,
        });
        return;
      }

      const toolName = node.actionSpec.toolName.trim();

      // Tool Registry Validation (Point 7)
      if (context.toolRegistry) {
        const tool = context.toolRegistry.get(toolName);
        if (!tool) {
          errors.push({
            severity: "error",
            code: "UNKNOWN_TOOL_IN_PLAN",
            message: `Tool "${toolName}" referenced in node "${node.id}" does not exist in the ToolRegistry. Plan rejected.`,
            nodeId: node.id,
          });
          return;
        }

        const policy = context.toolRegistry.getPolicy(toolName);
        effectivePolicies[node.id] = policy;

        // Tier Permission Validation
        const userTier = context.userTier || "free";
        if (policy.allowedTiers && policy.allowedTiers.length > 0 && !policy.allowedTiers.includes(userTier)) {
          errors.push({
            severity: "error",
            code: "UNAUTHORIZED_TIER",
            message: `User tier "${userTier}" is not authorized for tool "${toolName}" in node "${node.id}". Allowed tiers: [${policy.allowedTiers.join(", ")}]. Plan rejected.`,
            nodeId: node.id,
          });
        }

        // Domain Whitelist Validation
        if (policy.domainWhitelist && !policy.domainWhitelist.includes("*")) {
          // If the tool has a strict domain whitelist, the user's allowedDomains must be a subset or exactly permitted,
          // or we check the parameters. For "Pre-Execution Policy Engine", we validate if the context allows it.
          const allowed = context.allowedDomains || [];
          // If the user context doesn't explicitly allow one of the tool's whitelisted domains, and the tool isn't open (*)
          const hasOverlap = policy.domainWhitelist.some(d => allowed.includes(d));
          if (!hasOverlap && allowed.length > 0) {
            errors.push({
              severity: "error",
              code: "UNAUTHORIZED_DOMAIN",
              message: `Execution context allowed domains [${allowed.join(", ")}] do not overlap with tool "${toolName}" domain whitelist [${policy.domainWhitelist.join(", ")}].`,
              nodeId: node.id,
            });
          }
        }

        // Capability Validation (Point 7)
        if (context.userCapabilities && policy.requiredCapabilities.length > 0) {
          const userCaps = new Set(context.userCapabilities);
          const missingCaps = policy.requiredCapabilities.filter((c) => !userCaps.has(c));
          if (missingCaps.length > 0) {
            errors.push({
              severity: "error",
              code: "UNAUTHORIZED_TOOL_CAPABILITY",
              message: `User lacks required capabilities [${missingCaps.join(", ")}] for tool "${toolName}" in node "${node.id}". Plan rejected.`,
              nodeId: node.id,
            });
          }
        }

        // Destructive / Confirmation Gate (Point 6)
        if (policy.destructive || policy.confirmationRequired) {
          if (node.approval?.status === "not_required") {
            errors.push({
              severity: "error",
              code: "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE",
              message: `Tool "${toolName}" in node "${node.id}" is designated as destructive/confirmation-required by policy, but node approval status is "not_required". An approval gate is strictly required.`,
              nodeId: node.id,
            });
          }
        }
      }
    } else if (node.type === "memory_write") {
      if (!node.memorySpec || !node.memorySpec.key?.trim() || !node.memorySpec.content?.trim()) {
        errors.push({
          severity: "error",
          code: "INVALID_MEMORY_WRITE_SPEC",
          message: `Node "${node.id}" is of type "memory_write" but is missing memorySpec.key or content.`,
          nodeId: node.id,
        });
      }
    }
  }

  /**
   * Computes the transitive ancestor set for all nodes in the DAG.
   */
  private static computeAncestors(
    nodeKeys: string[],
    adj: Map<string, string[]>,
    topologicalOrder: string[],
  ): Map<string, Set<string>> {
    const ancestors = new Map<string, Set<string>>();
    for (const id of nodeKeys) {
      ancestors.set(id, new Set<string>());
    }

    // Process nodes in topological order
    for (const u of topologicalOrder) {
      const uAncestors = ancestors.get(u)!;
      for (const v of adj.get(u) || []) {
        const vAncestors = ancestors.get(v);
        if (vAncestors) {
          vAncestors.add(u);
          for (const anc of uAncestors) {
            vAncestors.add(anc);
          }
        }
      }
    }

    return ancestors;
  }

  /**
   * Validates input bindings to ensure safe data references:
   * - source node exists
   * - source node is an ancestor of the consuming node
   * - path is well-formed
   */
  private static validateInputBindings(
    graph: ExecutionGraph,
    ancestors: Map<string, Set<string>>,
    errors: ValidationDiagnostic[],
  ): void {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (!node.inputBindings) continue;

      for (const [paramKey, binding] of Object.entries(node.inputBindings)) {
        if (!binding || !binding.source) {
          errors.push({
            severity: "error",
            code: "MALFORMED_INPUT_BINDING",
            message: `Node "${nodeId}" parameter "${paramKey}" has malformed or undefined binding source.`,
            nodeId,
          });
          continue;
        }

        const src = binding.source;
        if (src.type === "node_output") {
          const targetExists = !!graph.nodes[src.nodeId];
          if (!targetExists) {
            errors.push({
              severity: "error",
              code: "BINDING_TARGET_NODE_NOT_FOUND",
              message: `Node "${nodeId}" binds parameter "${paramKey}" to non-existent node "${src.nodeId}".`,
              nodeId,
            });
            continue;
          }

          if (src.nodeId === nodeId) {
            errors.push({
              severity: "error",
              code: "BINDING_SELF_REFERENCE",
              message: `Node "${nodeId}" cannot bind parameter "${paramKey}" to its own output.`,
              nodeId,
            });
            continue;
          }

          const nodeAncestors = ancestors.get(nodeId);
          if (!nodeAncestors || !nodeAncestors.has(src.nodeId)) {
            errors.push({
              severity: "error",
              code: "BINDING_SOURCE_NOT_ANCESTOR",
              message: `Node "${nodeId}" binds parameter "${paramKey}" to node "${src.nodeId}", which is not a topological ancestor.`,
              nodeId,
            });
          }

          if (!src.path || !/^[a-zA-Z0-9_.$[\]]+$/.test(src.path)) {
            errors.push({
              severity: "error",
              code: "INVALID_BINDING_PATH",
              message: `Node "${nodeId}" binding path "${src.path}" is invalid. Must match [a-zA-Z0-9_.$[\\]]+.`,
              nodeId,
            });
          }
        } else if (src.type === "literal") {
          if (src.value === undefined) {
            errors.push({
              severity: "error",
              code: "UNDEFINED_LITERAL_BINDING",
              message: `Node "${nodeId}" parameter "${paramKey}" specifies a literal binding with undefined value.`,
              nodeId,
            });
          }
        } else if (src.type === "context") {
          if (!src.path || typeof src.path !== "string" || !src.path.trim()) {
            errors.push({
              severity: "error",
              code: "INVALID_CONTEXT_BINDING_PATH",
              message: `Node "${nodeId}" parameter "${paramKey}" specifies a context binding with an empty path.`,
              nodeId,
            });
          }
        }
      }
    }
  }

  /**
   * Evaluates if an individual node is permitted to execute given its approval status.
   */
  static canExecuteNode(node: GraphNode): boolean {
    if (node.status === "completed" || node.status === "skipped") {
      return false;
    }
    if (node.approval.status === "pending") {
      return false; // Gated awaiting human approval
    }
    if (node.approval.status === "denied") {
      return false; // Explicitly rejected by human
    }
    if (node.approval.status === "expired") {
      return false; // Approval window elapsed
    }
    return node.approval.status === "approved" || node.approval.status === "not_required";
  }

  /**
   * Evaluates if the entire execution graph is authorized and ready for execution.
   */
  static isExecutionReady(graph: ExecutionGraph): boolean {
    if (graph.cancellation?.isCancelled) {
      return false;
    }
    if (graph.status === "cancelled" || graph.status === "failed" || graph.status === "draft") {
      return false;
    }

    // Check if any node is currently pending, denied, or expired on approval
    for (const node of Object.values(graph.nodes)) {
      if (node.approval.status === "pending" || node.approval.status === "denied" || node.approval.status === "expired") {
        return false;
      }
    }

    return true;
  }
}

