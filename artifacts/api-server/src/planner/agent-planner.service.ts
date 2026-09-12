import type {
  PlannerRequest,
  ReplannerRequest,
  PlannerResult,
  CandidatePlan,
  CandidateNode,
  CompilerContext,
  ExecutionGraph,
  InputBinding,
} from "./types";
import { PlannerCompiler } from "./planner-compiler";
import { PlanPersistenceService, planPersistenceService } from "./plan-persistence.service";
import { ToolRegistry } from "../tools/tool-registry";
import { getProductionToolRegistry } from "../tools/production-tools";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { AutonomyDecisionService } from "../services/autonomy-decision.service";

import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import { type AIChatRequest } from "../services/ai-provider.adapters";

import { getConfig } from "../config/env";
import { logger } from "../lib/logger";

export class AgentPlannerService {
  private autonomyDecisionService?: AutonomyDecisionService;

  constructor(
    private persistenceService: PlanPersistenceService = planPersistenceService,
    private defaultToolRegistry?: ToolRegistry,
  ) {}

  private getAutonomyDecisionService(): AutonomyDecisionService {
    if (!this.autonomyDecisionService) {
      this.autonomyDecisionService = new AutonomyDecisionService(async (history, message) => {
        const routed = await adaptiveAIRouterService.route({
          systemInstruction: "You are an autonomous agent decision evaluator.",
          messages: [
            ...history.map((h) => ({ role: h.role === "model" ? "assistant" as const : "user" as const, content: h.content })),
            { role: "user" as const, content: message },
          ],
        }, {
          isSystemTask: true,
          isDeepReasoning: false,
        });
        return routed.response.text;
      });
    }
    return this.autonomyDecisionService;
  }

  async plan(request: PlannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> {
    const graphId = request.graphId || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const planRevision = 1;
    const revisionId = `${graphId}:r${planRevision}`;
    const registry = request.toolRegistry || this.defaultToolRegistry || getProductionToolRegistry();

    logger.info({ requestId: request.requestId, taskId: request.taskId, graphId, revisionId, userId: request.telegramUserId }, "PLAN_GENERATION_STARTED");

    let candidate: CandidatePlan;
    let isDirectResponse = false;

    if (customCandidate) {
      candidate = customCandidate;
      if (!candidate.graphId) candidate.graphId = graphId;
    } else {
      const autonomyDecision = await this.getAutonomyDecisionService().decide({
        userMessage: request.goal,
        history: request.context?.conversationHistory,
        effectiveMode: request.context?.mode,
        activeTask: request.context?.activeTask ? { id: request.context.activeTask.id, goal: request.context.activeTask.goal } : null,
        capabilities: request.context?.capabilities as any,
        mediaPresent: request.context?.mediaPresent,
      });

      logger.info({ requestId: request.requestId, graphId, route: autonomyDecision.route, confidence: autonomyDecision.confidence, reasons: autonomyDecision.executionReasons }, "PLAN_AUTONOMY_GATE_COMPLETED");

      if (autonomyDecision.route === "direct" || autonomyDecision.route === "clarify") {
        return {
          success: true,
          diagnostics: [{ severity: "warning", code: autonomyDecision.route === "direct" ? "DIRECT_CONVERSATION_ROUTE" : "CLARIFICATION_CONVERSATION_ROUTE", message: autonomyDecision.rationale }],
          isDirectResponse: true,
        };
      }

      try {
        candidate = await this.generateDynamicCandidate(request, registry, autonomyDecision.executionReasons);
      } catch (error) {
        logger.error({ requestId: request.requestId, graphId, error: error instanceof Error ? error.message : String(error) }, "DYNAMIC_PLAN_GENERATION_FAILED");
        return {
          success: false,
          errorCode: "PLAN_GENERATION_FAILED",
          errorMessage: "I could not safely construct the autonomous action plan, so no durable action was executed.",
          diagnostics: [{ severity: "error", code: "DYNAMIC_PLAN_GENERATION_FAILED", message: "Autonomous planning failed before execution." }],
          isDirectResponse: false,
        };
      }
    }

    candidate = this.normalizeCandidateForExecution(candidate, registry, request);
    const toolTypes = Array.from(new Set((candidate.nodes || []).map((node) => node.actionSpec?.toolName).filter(Boolean) as string[]));
    const effectivePolicy = AdaptiveEngineService.computeAdaptiveExecutionPolicy({ goal: candidate.goal || request.goal, subgoalCount: candidate.nodes?.length || 0, mode: request.context?.mode, toolTypes });
    const compilerContext: CompilerContext = {
      telegramUserId: request.telegramUserId,
      requestId: request.requestId,
      taskId: request.taskId,
      graphId,
      planRevision,
      toolRegistry: registry,
      userCapabilities: request.context?.capabilities || [],
      plannerModel: request.plannerModel || getConfig().geminiModel,
      effectivePolicy,
    };

    const compilationResult = PlannerCompiler.compile(candidate, compilerContext);
    if (!compilationResult.success || !compilationResult.graph) {
      logger.warn({ requestId: request.requestId, graphId, diagnostics: compilationResult.diagnostics }, "PLAN_REJECTED");
      return { success: false, errorCode: compilationResult.errorCode || "PLAN_VALIDATION_FAILED", errorMessage: compilationResult.diagnostics[0]?.message || "Plan compilation or validation failed.", diagnostics: compilationResult.diagnostics, isDirectResponse };
    }

    try {
      await this.persistenceService.saveGraph(compilationResult.graph);
    } catch (err: any) {
      logger.error({ requestId: request.requestId, graphId, error: err?.message }, "PLAN_PERSISTENCE_FAILED");
      return { success: false, errorCode: "PLAN_COMPILATION_FAILED", errorMessage: "The validated plan could not be durably persisted, so no autonomous action was executed.", diagnostics: [{ severity: "error", code: "PERSISTENCE_ERROR", message: err?.message || "Persistence failed." }], isDirectResponse };
    }

    logger.info({ requestId: request.requestId, graphId, revisionId, nodes: Object.keys(compilationResult.graph.nodes).length, toolTypes }, "PLAN_PERSISTED");
    isDirectResponse = candidate.nodes?.length === 1 && (!candidate.edges || candidate.edges.length === 0);
    return { success: true, graph: compilationResult.graph, diagnostics: compilationResult.diagnostics, isDirectResponse };
  }

  async planAndCompile(request: PlannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> { return this.plan(request, customCandidate); }

  async replan(replanRequest: ReplannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> {
    const nextRevision = replanRequest.previousRevision + 1;
    const graphId = replanRequest.previousGraphId;
    const parentRevisionId = `${graphId}:r${replanRequest.previousRevision}`;
    const revisionId = `${graphId}:r${nextRevision}`;
    const registry = replanRequest.toolRegistry || this.defaultToolRegistry || getProductionToolRegistry();
    const previousGraph = await this.persistenceService.getGraph(graphId, replanRequest.previousRevision);

    if (!previousGraph) return { success: false, errorCode: "PLAN_GENERATION_FAILED", errorMessage: `Previous plan revision "${parentRevisionId}" not found for replanning.`, diagnostics: [{ severity: "error", code: "PARENT_REVISION_NOT_FOUND", message: parentRevisionId }] };

    const request: PlannerRequest = {
      requestId: replanRequest.requestId,
      telegramUserId: replanRequest.telegramUserId,
      taskId: replanRequest.taskId,
      goal: `${previousGraph.goal}\nRecovery reason: ${replanRequest.replanReason}`,
      context: replanRequest.context,
      toolRegistry: registry,
      graphId,
      plannerModel: replanRequest.plannerModel,
    };

    let candidate = customCandidate;
    if (!candidate) {
      try {
        candidate = await this.generateDynamicCandidate(request, registry, [`Recover failed node ${replanRequest.failedNodeId || "unknown"}.`, replanRequest.replanReason], previousGraph);
      } catch (error) {
        return { success: false, errorCode: "PLAN_GENERATION_FAILED", errorMessage: "A safe recovery plan could not be constructed; the failed execution was not silently retried.", diagnostics: [{ severity: "error", code: "DYNAMIC_REPLAN_FAILED", message: error instanceof Error ? error.message : String(error) }] };
      }
    }

    candidate.graphId = graphId;
    candidate = this.normalizeCandidateForExecution(candidate, registry, request);
    const toolTypes = Array.from(new Set(candidate.nodes.map((node) => node.actionSpec?.toolName).filter(Boolean) as string[]));
    const effectivePolicy = AdaptiveEngineService.computeAdaptiveExecutionPolicy({ goal: candidate.goal, subgoalCount: candidate.nodes.length, mode: replanRequest.context?.mode, toolTypes });
    const compilationResult = PlannerCompiler.compile(candidate, {
      telegramUserId: replanRequest.telegramUserId,
      requestId: replanRequest.requestId,
      taskId: replanRequest.taskId,
      graphId,
      planRevision: nextRevision,
      parentRevisionId,
      toolRegistry: registry,
      userCapabilities: replanRequest.context?.capabilities || [],
      plannerModel: replanRequest.plannerModel || getConfig().geminiModel,
      effectivePolicy,
    });

    if (!compilationResult.success || !compilationResult.graph) return { success: false, errorCode: compilationResult.errorCode || "PLAN_VALIDATION_FAILED", errorMessage: compilationResult.diagnostics[0]?.message || "Recovery plan validation failed.", diagnostics: compilationResult.diagnostics };
    await this.persistenceService.saveGraph(compilationResult.graph);
    logger.info({ requestId: replanRequest.requestId, graphId, revisionId, parentRevisionId }, "PLAN_REPLAN_PERSISTED");
    return { success: true, graph: compilationResult.graph, diagnostics: compilationResult.diagnostics };
  }

  private async generateDynamicCandidate(request: PlannerRequest, registry: ToolRegistry, reasons: string[], previousGraph?: ExecutionGraph): Promise<CandidatePlan> {
    const tools = registry.list().map((tool) => ({ name: tool.name, description: tool.description, policy: registry.getPolicy(tool.name) }));
    const context = {
      mode: request.context?.mode || "general",
      capabilities: request.context?.capabilities || [],
      activeTask: request.context?.activeTask || null,
      recentHistory: (request.context?.conversationHistory || []).slice(-10),
      previousGraph: previousGraph ? { graphId: previousGraph.graphId, revision: previousGraph.planRevision, goal: previousGraph.goal, nodes: Object.values(previousGraph.nodes).map((node) => ({ id: node.id, title: node.title, type: node.type, toolName: node.actionSpec?.toolName })) } : null,
    };

    const prompt = [
      "You are the autonomous execution planner for Wingbuddy.",
      "Generate the smallest complete execution graph for the user's goal.",
      "Return ONLY one JSON object matching the CandidatePlan shape; no markdown and no commentary.",
      "",
      "CandidatePlan shape:",
      '{"goal":"...","strategy":"...","nodes":[{"id":"n1","title":"...","type":"llm_reasoning|tool_call|memory_write|user_checkpoint|subgoal_aggregate","actionSpec":{"toolName":"REGISTERED_TOOL","parameters":{}},"reasoningSpec":{"prompt":"...","targetFormat":"markdown"},"memorySpec":{"key":"...","content":"...","category":"..."},"inputBindings":{},"approval":{"status":"not_required|pending","reason":"..."},"verification":{"required":false,"strategy":"none"},"dependsOn":[]}],"edges":[{"fromNodeId":"n1","toNodeId":"n2","dependencyType":"hard"}]}',
      "",
      "Planner invariants:",
      "- A node with actionSpec MUST have type tool_call. Never put actionSpec on llm_reasoning.",
      "- A tool_call node executes exactly one registered external/durable tool action.",
      "- An llm_reasoning node is a pure transformation over supplied context and prior node outputs; it has no actionSpec.",
      "- If a tool result must be synthesized, create a separate downstream llm_reasoning node and bind its inputs to the tool node output using {source:{type:\"node_output\",nodeId:<toolNodeId>,path:\"output\"}}.",
      "- Never invent tool names; use only registered tools supplied below.",
      "- If the user's goal explicitly specifies numbered steps (e.g., 'Step 1', 'Step 2', ...), plan a distinct node for each specified step and connect them with sequential dependency edges.",
      "- For open-ended single-intent requests, use the fewest nodes that completely fulfill the goal.",
      "- Do not fabricate missing dates, times, recipients, accounts, identifiers, or other material action parameters.",
      "- When required action information is genuinely missing, do not invent it. Use a user_checkpoint only when a safe, meaningful clarification is required for execution.",
      "- Registry security policy is authoritative. Never downgrade approval, capability, retry, or timeout requirements.",
      "- For current/broad/multi-source information, prefer the registered live web search capability when it is available; do not substitute model memory for missing evidence.",
      "- Durable task creation should use create_task with explicit title, goal and ordered steps when persistent task state is requested.",
      "- Reminder scheduling should use create_reminder only when a valid future dueAt can be established; never guess.",
      "- A final reasoning/synthesis node may claim success only from successful upstream tool results.",
      ...(context?.isBackgroundTask ? [
        "- BACKGROUND CONDITIONAL WATCHERS: Because this is an autonomous background execution, the final output node (or direct response) MUST output a strictly formatted JSON evaluation of the user's condition.",
        "- Your output MUST be a valid JSON object matching this schema: {\"action\": \"notify\" | \"silent\", \"reason\": \"internal reasoning\", \"message\": \"message to send user if notify\"}",
        "- If the condition is MET, set action to 'notify' and provide the 'message'.",
        "- If the condition is NOT MET, set action to 'silent'."
      ] : []),
      "",
      `Execution reasons: ${JSON.stringify(reasons)}`,
      `Runtime context: ${JSON.stringify(context)}`,
      `Registered tools: ${JSON.stringify(tools)}`,
      "",
      `CURRENT USER GOAL:\n${request.goal}`,
    ].join("\n");

    let raw: string;
    try {
      
      const routeResult = await adaptiveAIRouterService.route({
        systemInstruction: "",
        messages: [{ role: "user", content: prompt }]
      }, {
        isSystemTask: true,
        reasoningRequired: true
      });
      raw = routeResult.response.text;

    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Dynamic planner model call failed; refusing to guess an execution plan");
      throw new Error("Dynamic planner model call failed; execution plan generation is unavailable.");
    }

    try {
      const parsed = this.parseCandidate(raw);
      if (!parsed.goal) parsed.goal = request.goal;
      if (!parsed.graphId) parsed.graphId = request.graphId;
      if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) throw new Error("Dynamic planner returned an empty plan.");
      return parsed;
    } catch (parseError) {
      logger.warn({ error: parseError instanceof Error ? parseError.message : String(parseError) }, "Candidate parsing failed; refusing to execute an ambiguous plan");
      throw new Error("Dynamic planner returned an invalid execution plan.");
    }
  }

  private normalizeCandidateForExecution(candidate: CandidatePlan, registry: ToolRegistry, request: PlannerRequest): CandidatePlan {
    const nodes = Array.isArray(candidate.nodes) ? candidate.nodes.map((node) => ({ ...node })) : [];
    const normalizedNodes: CandidateNode[] = [];
    const extraEdges = Array.isArray(candidate.edges) ? [...candidate.edges] : [];

    for (const node of nodes) {
      // Auto-migrate legacy or model-hallucinated toolSpec/toolName/action properties into canonical actionSpec
      const anyNode = node as any;
      if (!node.actionSpec && anyNode.toolSpec && (anyNode.toolSpec.toolName || anyNode.toolSpec.name)) {
        node.actionSpec = {
          toolName: anyNode.toolSpec.toolName || anyNode.toolSpec.name,
          parameters: anyNode.toolSpec.input || anyNode.toolSpec.parameters || {},
        };
      } else if (!node.actionSpec && anyNode.toolName) {
        node.actionSpec = {
          toolName: anyNode.toolName,
          parameters: anyNode.parameters || anyNode.input || {},
        };
      }

      if (node.type === "llm_reasoning") {
        if (!node.reasoningSpec || !node.reasoningSpec.prompt?.trim()) {
          node.reasoningSpec = {
            prompt: node.title || `Synthesize findings for: ${candidate.goal || request.goal}`,
            targetFormat: node.reasoningSpec?.targetFormat || "markdown",
          };
        }
      }

      if (node.type === "llm_reasoning" && node.actionSpec?.toolName) {
        const toolName = node.actionSpec.toolName.trim();
        if (!registry.get(toolName)) {
          normalizedNodes.push(node);
          continue;
        }
        const toolNodeId = `${node.id || "node"}_tool`;
        const reasoningNodeId = node.id || `${toolNodeId}_synthesis`;
        const malformedOrDerivedBindings = Object.keys(node.inputBindings || {});
        normalizedNodes.push({ ...node, id: toolNodeId, type: "tool_call", title: `${node.title} — execute tool`, actionSpec: node.actionSpec, reasoningSpec: undefined, inputBindings: undefined });
        if (node.reasoningSpec?.prompt?.trim()) {
          const reasoningBindings: Record<string, InputBinding> = {};
          for (const parameterName of malformedOrDerivedBindings) reasoningBindings[parameterName] = { source: { type: "node_output", nodeId: toolNodeId, path: "output" } };
          normalizedNodes.push({ ...node, id: reasoningNodeId, type: "llm_reasoning", actionSpec: undefined, inputBindings: reasoningBindings, dependsOn: [toolNodeId], reasoningSpec: node.reasoningSpec });
          extraEdges.push({ fromNodeId: toolNodeId, toNodeId: reasoningNodeId, dependencyType: "hard" });
        }
        logger.warn({ requestId: request.requestId, originalNodeId: node.id, toolNodeId, repairedHybridNode: true }, "PLANNER_CANDIDATE_SHAPE_REPAIRED");
        continue;
      }

      if (node.type === "tool_call" && node.actionSpec?.toolName) {
        const tool = registry.get(node.actionSpec.toolName.trim());
        if (tool) {
          const policy = registry.getPolicy(node.actionSpec.toolName.trim());
          if ((policy.destructive || policy.confirmationRequired) && (!node.approval || node.approval.status === "not_required")) {
            node.approval = {
              status: "pending",
              reason: `Security policy mandates confirmation for tool "${node.actionSpec.toolName}".`,
              requestedAt: new Date().toISOString(),
            };
          }
        }
      }

      if (node.verification) {
        if (node.verification.required && (!node.verification.strategy || node.verification.strategy === "none")) {
          node.verification.strategy = "llm_review";
          if (!node.verification.reviewPrompt?.trim()) {
            node.verification.reviewPrompt = `Verify that step "${node.title || node.id}" completed successfully.`;
          }
        }
      }

      if (node.inputBindings) {
        const validBindings: Record<string, InputBinding> = {};
        for (const [key, binding] of Object.entries(node.inputBindings)) {
          if (!binding?.source || typeof binding.source !== "object" || typeof (binding.source as any).type !== "string") continue;
          const source = binding.source as any;
          if (source.type === "node_output" && typeof source.nodeId === "string" && source.nodeId.trim()) validBindings[key] = { source: { type: "node_output", nodeId: source.nodeId, path: typeof source.path === "string" && source.path.trim() ? source.path : "output" } };
          else if (source.type === "literal" || source.type === "context") validBindings[key] = binding;
        }
        node.inputBindings = validBindings;
      }
      normalizedNodes.push(node);
    }

    return { ...candidate, goal: candidate.goal || request.goal, nodes: normalizedNodes, edges: extraEdges };
  }

  private parseCandidate(raw: string): CandidatePlan {
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let candidateText = jsonText;
    try { JSON.parse(candidateText); }
    catch {
      const first = candidateText.indexOf("{");
      const last = candidateText.lastIndexOf("}");
      if (first < 0 || last <= first) throw new Error("Dynamic planner did not return a JSON object.");
      candidateText = candidateText.slice(first, last + 1);
    }
    const parsed = JSON.parse(candidateText) as CandidatePlan;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) throw new Error("Dynamic planner response does not match CandidatePlan.");
    parsed.nodes = parsed.nodes.map((node) => ({ ...node, type: node.type, title: String(node.title || "Untitled step").trim() })) as CandidateNode[];
    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    return parsed;
  }
}

export const agentPlannerService = new AgentPlannerService();
