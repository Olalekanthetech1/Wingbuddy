import type {
  PlannerRequest,
  ReplannerRequest,
  PlannerResult,
  CandidatePlan,
  CandidateNode,
  CompilerContext,
  ExecutionGraph,
} from "./types";
import { PlannerCompiler } from "./planner-compiler";
import { PlanPersistenceService, planPersistenceService } from "./plan-persistence.service";
import { ToolRegistry } from "../tools/tool-registry";
import { getProductionToolRegistry } from "../tools/production-tools";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { AutonomyDecisionService } from "../services/autonomy-decision.service";
import { GeminiService } from "../gemini/gemini.service";
import { getConfig } from "../config/env";
import { logger } from "../lib/logger";

export class AgentPlannerService {
  private autonomyDecisionService?: AutonomyDecisionService;
  private candidateGenerator?: GeminiService;

  constructor(
    private persistenceService: PlanPersistenceService = planPersistenceService,
    private defaultToolRegistry?: ToolRegistry,
  ) {}

  private getGemini(): GeminiService {
    if (!this.candidateGenerator) {
      const config = getConfig();
      this.candidateGenerator = new GeminiService(config.geminiApiKey, config.geminiModel, config.geminiTimeoutMs);
    }
    return this.candidateGenerator;
  }

  private getAutonomyDecisionService(): AutonomyDecisionService {
    if (!this.autonomyDecisionService) {
      const gemini = this.getGemini();
      this.autonomyDecisionService = new AutonomyDecisionService((history, message) => gemini.generateReply(history, message));
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
          diagnostics: [{
            severity: "warning",
            code: autonomyDecision.route === "direct" ? "DIRECT_CONVERSATION_ROUTE" : "CLARIFICATION_CONVERSATION_ROUTE",
            message: autonomyDecision.rationale,
          }],
          isDirectResponse: true,
        };
      }

      try {
        candidate = await this.generateDynamicCandidate(request, registry, autonomyDecision.executionReasons);
      } catch (error) {
        logger.error({ requestId: request.requestId, graphId, error: error instanceof Error ? error.message : String(error) }, "DYNAMIC_PLAN_GENERATION_FAILED");
        // Preserve conversational availability without pretending that durable execution occurred.
        return {
          success: false,
          errorCode: "PLAN_GENERATION_FAILED",
          errorMessage: "I could not safely construct the autonomous action plan, so no durable action was executed.",
          diagnostics: [{ severity: "error", code: "DYNAMIC_PLAN_GENERATION_FAILED", message: "Autonomous planning failed before execution." }],
          isDirectResponse: false,
        };
      }
    }

    const toolTypes = Array.from(new Set((candidate.nodes || []).map((node) => node.actionSpec?.toolName).filter(Boolean) as string[]));
    const effectivePolicy = AdaptiveEngineService.computeAdaptiveExecutionPolicy({
      goal: candidate.goal || request.goal,
      subgoalCount: candidate.nodes?.length || 0,
      mode: request.context?.mode,
      toolTypes,
    });

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
      return {
        success: false,
        errorCode: compilationResult.errorCode || "PLAN_VALIDATION_FAILED",
        errorMessage: compilationResult.diagnostics[0]?.message || "Plan compilation or validation failed.",
        diagnostics: compilationResult.diagnostics,
        isDirectResponse,
      };
    }

    try {
      await this.persistenceService.saveGraph(compilationResult.graph);
    } catch (err: any) {
      logger.error({ requestId: request.requestId, graphId, error: err?.message }, "PLAN_PERSISTENCE_FAILED");
      return {
        success: false,
        errorCode: "PLAN_COMPILATION_FAILED",
        errorMessage: "The validated plan could not be durably persisted, so no autonomous action was executed.",
        diagnostics: [{ severity: "error", code: "PERSISTENCE_ERROR", message: err?.message || "Persistence failed." }],
        isDirectResponse,
      };
    }

    logger.info({ requestId: request.requestId, graphId, revisionId, nodes: Object.keys(compilationResult.graph.nodes).length, toolTypes }, "PLAN_PERSISTED");
    return { success: true, graph: compilationResult.graph, diagnostics: compilationResult.diagnostics, isDirectResponse };
  }

  async planAndCompile(request: PlannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> {
    return this.plan(request, customCandidate);
  }

  async replan(replanRequest: ReplannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> {
    const nextRevision = replanRequest.previousRevision + 1;
    const graphId = replanRequest.previousGraphId;
    const parentRevisionId = `${graphId}:r${replanRequest.previousRevision}`;
    const revisionId = `${graphId}:r${nextRevision}`;
    const registry = replanRequest.toolRegistry || this.defaultToolRegistry || getProductionToolRegistry();
    const previousGraph = await this.persistenceService.getGraph(graphId, replanRequest.previousRevision);

    if (!previousGraph) {
      return {
        success: false,
        errorCode: "PLAN_GENERATION_FAILED",
        errorMessage: `Previous plan revision "${parentRevisionId}" not found for replanning.`,
        diagnostics: [{ severity: "error", code: "PARENT_REVISION_NOT_FOUND", message: parentRevisionId }],
      };
    }

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
        candidate = await this.generateDynamicCandidate(request, registry, [
          `Recover failed node ${replanRequest.failedNodeId || "unknown"}.`,
          replanRequest.replanReason,
        ], previousGraph);
      } catch (error) {
        return {
          success: false,
          errorCode: "PLAN_GENERATION_FAILED",
          errorMessage: "A safe recovery plan could not be constructed; the failed execution was not silently retried.",
          diagnostics: [{ severity: "error", code: "DYNAMIC_REPLAN_FAILED", message: error instanceof Error ? error.message : String(error) }],
        };
      }
    }

    candidate.graphId = graphId;
    const toolTypes = Array.from(new Set(candidate.nodes.map((node) => node.actionSpec?.toolName).filter(Boolean) as string[]));
    const effectivePolicy = AdaptiveEngineService.computeAdaptiveExecutionPolicy({
      goal: candidate.goal,
      subgoalCount: candidate.nodes.length,
      mode: replanRequest.context?.mode,
      toolTypes,
    });

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

    if (!compilationResult.success || !compilationResult.graph) {
      return {
        success: false,
        errorCode: compilationResult.errorCode || "PLAN_VALIDATION_FAILED",
        errorMessage: compilationResult.diagnostics[0]?.message || "Recovery plan validation failed.",
        diagnostics: compilationResult.diagnostics,
      };
    }

    await this.persistenceService.saveGraph(compilationResult.graph);
    logger.info({ requestId: replanRequest.requestId, graphId, revisionId, parentRevisionId }, "PLAN_REPLAN_PERSISTED");
    return { success: true, graph: compilationResult.graph, diagnostics: compilationResult.diagnostics };
  }

  private async generateDynamicCandidate(
    request: PlannerRequest,
    registry: ToolRegistry,
    reasons: string[],
    previousGraph?: ExecutionGraph,
  ): Promise<CandidatePlan> {
    const tools = registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      policy: registry.getPolicy(tool.name),
    }));

    const context = {
      mode: request.context?.mode || "general",
      capabilities: request.context?.capabilities || [],
      activeTask: request.context?.activeTask || null,
      recentHistory: (request.context?.conversationHistory || []).slice(-10),
      previousGraph: previousGraph ? {
        graphId: previousGraph.graphId,
        revision: previousGraph.planRevision,
        goal: previousGraph.goal,
        failedNodeId: request.goal.match(/Recovery reason:/i) ? undefined : undefined,
        nodes: Object.values(previousGraph.nodes).map((node) => ({ id: node.id, title: node.title, type: node.type, toolName: node.actionSpec?.toolName })),
      } : null,
    };

    const prompt = [
      "You are the autonomous execution planner for Wingbuddy.",
      "Generate a minimal, complete execution graph for the user's goal.",
      "Return ONLY one JSON object matching the CandidatePlan shape; no markdown and no commentary.",
      "",
      "CandidatePlan shape:",
      '{"goal":"...","strategy":"...","nodes":[{"id":"n1","title":"...","type":"llm_reasoning|tool_call|memory_write|user_checkpoint|subgoal_aggregate","actionSpec":{"toolName":"REGISTERED_TOOL","parameters":{}},"reasoningSpec":{"prompt":"...","targetFormat":"markdown"},"memorySpec":{"key":"...","content":"...","category":"..."},"inputBindings":{},"approval":{"status":"not_required|pending","reason":"..."},"verification":{"required":false,"strategy":"none"},"dependsOn":[]}],"edges":[{"fromNodeId":"n1","toNodeId":"n2","dependencyType":"hard"}]}',
      "",
      "Planner rules:",
      "- Use only the registered tools supplied below. Never invent tool names.",
      "- Create tool_call nodes for real external/durable actions; do not describe an action in an llm_reasoning node.",
      "- Use the fewest nodes that completely fulfill the goal; do not add generic analysis/evaluation steps merely to make the graph longer.",
      "- Use inputBindings when one node genuinely depends on another node's output.",
      "- Do not fabricate missing dates, times, recipients, accounts, identifiers, or other material action parameters.",
      "- When required action information is genuinely missing, do not invent it. A user_checkpoint may request explicit confirmation only when the graph can otherwise proceed safely; otherwise omit the side-effecting action and state the missing input in the final reasoning node.",
      "- Registry security policy is authoritative. Never downgrade approval, capability, retry, or timeout requirements.",
      "- Read-only informational requests should normally use search_information when external factual retrieval is actually needed, then a synthesis node if necessary.",
      "- Durable task creation should use create_task with explicit title, goal and ordered steps when the user actually asks for persistent task state.",
      "- Reminder scheduling should use create_reminder only when a valid future dueAt can be established from the user's request; otherwise do not guess.",
      "- A final response/synthesis node should summarize verified tool outputs and must never claim an action succeeded without a successful tool result.",
      "",
      `Execution reasons from the autonomy decision: ${JSON.stringify(reasons)}`,
      `Runtime context: ${JSON.stringify(context)}`,
      `Registered tools: ${JSON.stringify(tools)}`,
      "",
      `CURRENT USER GOAL:\n${request.goal}`,
    ].join("\n");

    const raw = await this.getGemini().generateReply([], prompt);
    const parsed = this.parseCandidate(raw);
    if (!parsed.goal) parsed.goal = request.goal;
    if (!parsed.graphId) parsed.graphId = request.graphId;
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) throw new Error("Dynamic planner returned an empty plan.");

    return parsed;
  }

  private parseCandidate(raw: string): CandidatePlan {
    const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let candidateText = jsonText;
    try {
      JSON.parse(candidateText);
    } catch {
      const first = candidateText.indexOf("{");
      const last = candidateText.lastIndexOf("}");
      if (first < 0 || last <= first) throw new Error("Dynamic planner did not return a JSON object.");
      candidateText = candidateText.slice(first, last + 1);
    }

    const parsed = JSON.parse(candidateText) as CandidatePlan;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) throw new Error("Dynamic planner response does not match CandidatePlan.");

    parsed.nodes = parsed.nodes.map((node) => ({
      ...node,
      type: node.type,
      title: String(node.title || "Untitled step").trim(),
    })) as CandidateNode[];
    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    return parsed;
  }
}

export const agentPlannerService = new AgentPlannerService();
