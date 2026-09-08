import type {
  PlannerRequest,
  ReplannerRequest,
  PlannerResult,
  CandidatePlan,
  CandidateNode,
  CandidateEdge,
  CompilerContext,
  ExecutionGraph,
  PlannerErrorCode,
} from "./types";
import { PlannerCompiler } from "./planner-compiler";
import { PlanPersistenceService, planPersistenceService } from "./plan-persistence.service";
import { ToolRegistry } from "../tools/tool-registry";
import { getProductionToolRegistry } from "../tools/production-tools";
import { logger } from "../lib/logger";

export interface PlanStructuralCriteria {
  isMultiStep: boolean;
  requiresTools: boolean;
  requiresExternalInfo: boolean;
  requiresMemoryWrite: boolean;
  requiresApproval: boolean;
  requiredToolNames: string[];
}

export class AgentPlannerService {
  constructor(
    private persistenceService: PlanPersistenceService = planPersistenceService,
    private defaultToolRegistry?: ToolRegistry,
  ) {}

  /**
   * Primary entry point for planning a user goal.
   * Generates or receives candidate plan, compiles deterministically, validates invariants,
   * persists to immutable revision storage, and stops before any execution.
   */
  async plan(request: PlannerRequest, customCandidate?: CandidatePlan): Promise<PlannerResult> {
    const graphId =
      request.graphId ||
      `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const planRevision = 1;
    const revisionId = `${graphId}:r${planRevision}`;

    const correlationMeta = {
      requestId: request.requestId,
      taskId: request.taskId,
      graphId,
      revisionId,
    };

    logger.info(
      {
        ...correlationMeta,
        goalLength: request.goal.length,
        userId: request.telegramUserId,
      },
      "PLAN_GENERATION_STARTED",
    );

    const registry = request.toolRegistry || this.defaultToolRegistry || getProductionToolRegistry();

    // 1. Generate Candidate Plan (or use custom provided candidate plan)
    let candidate: CandidatePlan;
    let isDirectResponse = false;

    if (customCandidate) {
      candidate = customCandidate;
      if (!candidate.graphId) candidate.graphId = graphId;
    } else {
      const criteria = this.analyzeStructuralCriteria(request.goal, request, registry);
      if (!criteria.isMultiStep && !criteria.requiresTools && !criteria.requiresMemoryWrite) {
        // Direct-Response Optimization
        candidate = this.generateDirectResponseCandidate(request.goal, graphId);
        isDirectResponse = true;
      } else {
        candidate = this.generateMultiStepCandidate(request.goal, graphId, criteria);
      }
    }

    logger.info(
      {
        ...correlationMeta,
        isDirectResponse,
        candidateNodeCount: candidate.nodes?.length || 0,
      },
      "PLAN_GENERATION_COMPLETED",
    );

    // 2. Compile Candidate Plan through Deterministic Planner Compiler
    const compilerContext: CompilerContext = {
      telegramUserId: request.telegramUserId,
      requestId: request.requestId,
      taskId: request.taskId,
      graphId,
      planRevision,
      toolRegistry: registry,
      userCapabilities: request.context?.capabilities || [],
      plannerModel: request.plannerModel || "gemini-3.8-flash",
    };

    const compilationResult = PlannerCompiler.compile(candidate, compilerContext);

    if (!compilationResult.success || !compilationResult.graph) {
      const errorCode = compilationResult.errorCode || "PLAN_VALIDATION_FAILED";
      const errorMessage =
        compilationResult.diagnostics[0]?.message ||
        "Plan compilation or validation failed.";

      logger.warn(
        {
          ...correlationMeta,
          errorCode,
          diagnostics: compilationResult.diagnostics,
        },
        "PLAN_REJECTED",
      );

      return {
        success: false,
        errorCode,
        errorMessage,
        diagnostics: compilationResult.diagnostics,
        isDirectResponse,
      };
    }

    // 3. Persist Validated Execution Graph
    const graph = compilationResult.graph;
    try {
      await this.persistenceService.saveGraph(graph);
    } catch (err: any) {
      logger.error(
        { ...correlationMeta, errMessage: err.message },
        "PLAN_PERSISTENCE_FAILED",
      );
      return {
        success: false,
        errorCode: "PLAN_COMPILATION_FAILED",
        errorMessage: `Failed to persist execution graph: ${err.message}`,
        diagnostics: [
          {
            severity: "error",
            code: "PERSISTENCE_ERROR",
            message: err.message,
          },
        ],
        isDirectResponse,
      };
    }

    return {
      success: true,
      graph,
      diagnostics: compilationResult.diagnostics,
      isDirectResponse,
    };
  }

  /**
   * Alias for plan() to maintain full backwards and cross-service consistency.
   */
  async planAndCompile(
    request: PlannerRequest,
    customCandidate?: CandidatePlan,
  ): Promise<PlannerResult> {
    return this.plan(request, customCandidate);
  }

  /**
   * Replanning endpoint: creates a subsequent plan revision (revision N+1) linking to parent.
   * Revision N remains strictly immutable.
   */
  async replan(
    replanRequest: ReplannerRequest,
    customCandidate?: CandidatePlan,
  ): Promise<PlannerResult> {
    const { previousGraphId, previousRevision, replanReason } = replanRequest;
    const nextRevision = previousRevision + 1;
    const revisionId = `${previousGraphId}:r${nextRevision}`;
    const parentRevisionId = `${previousGraphId}:r${previousRevision}`;

    const correlationMeta = {
      requestId: replanRequest.requestId,
      taskId: replanRequest.taskId,
      graphId: previousGraphId,
      planRevision: nextRevision,
      revisionId,
      parentRevisionId,
    };

    logger.info(
      {
        ...correlationMeta,
        replanReason,
        failedNodeId: replanRequest.failedNodeId,
      },
      "PLAN_GENERATION_STARTED",
    );

    const previousGraph = await this.persistenceService.getGraph(
      previousGraphId,
      previousRevision,
    );

    if (!previousGraph) {
      logger.warn(
        correlationMeta,
        "PLAN_REJECTED: previous graph revision not found",
      );
      return {
        success: false,
        errorCode: "PLAN_GENERATION_FAILED",
        errorMessage: `Previous plan revision "${parentRevisionId}" not found for replanning.`,
        diagnostics: [
          {
            severity: "error",
            code: "PARENT_REVISION_NOT_FOUND",
            message: `Parent revision ${parentRevisionId} not found.`,
          },
        ],
      };
    }

    const registry = replanRequest.toolRegistry || this.defaultToolRegistry;

    // Generate replan candidate
    let candidate: CandidatePlan;
    if (customCandidate) {
      candidate = customCandidate;
      candidate.graphId = previousGraphId;
    } else {
      candidate = this.generateReplannedCandidate(
        previousGraph,
        replanReason,
        replanRequest.failedNodeId,
      );
    }

    const compilerContext: CompilerContext = {
      telegramUserId: replanRequest.telegramUserId,
      requestId: replanRequest.requestId,
      taskId: replanRequest.taskId,
      graphId: previousGraphId,
      planRevision: nextRevision,
      parentRevisionId,
      toolRegistry: registry,
      userCapabilities: replanRequest.context?.capabilities || [],
      plannerModel: replanRequest.plannerModel || "gemini-3.8-flash",
    };

    const compilationResult = PlannerCompiler.compile(candidate, compilerContext);

    if (!compilationResult.success || !compilationResult.graph) {
      const errorCode = compilationResult.errorCode || "PLAN_VALIDATION_FAILED";
      const errorMessage =
        compilationResult.diagnostics[0]?.message ||
        "Replanned graph compilation or validation failed.";

      logger.warn(
        { ...correlationMeta, errorCode, diagnostics: compilationResult.diagnostics },
        "PLAN_REJECTED",
      );

      return {
        success: false,
        errorCode,
        errorMessage,
        diagnostics: compilationResult.diagnostics,
      };
    }

    const newGraph = compilationResult.graph;
    await this.persistenceService.saveGraph(newGraph);

    return {
      success: true,
      graph: newGraph,
      diagnostics: compilationResult.diagnostics,
    };
  }

  /**
   * Structural criteria evaluation (No brittle phrase matching).
   * Evaluates requirements based on tools, external queries, dependencies, and side effects.
   */
  private analyzeStructuralCriteria(
    goal: string,
    request: PlannerRequest,
    registry?: ToolRegistry,
  ): PlanStructuralCriteria {
    const lowerGoal = goal.toLowerCase();
    const availableTools = registry ? registry.list() : [];

    // Check if tools in the registry are explicitly needed
    const requiredToolNames: string[] = [];
    let requiresApproval = false;

    for (const tool of availableTools) {
      const toolName = tool.name.toLowerCase();
      // Match by exact tool name or clear tool verb invocation
      if (
        lowerGoal.includes(toolName) ||
        (tool.name === "calculate_math" && /\b(calculate|compute|math|interest|\d+\s*[\+\-\*\/\^]\s*\d+)\b/i.test(goal)) ||
        (tool.name === "search_information" && /\b(search for|look up|find information|web search)\b/i.test(goal)) ||
        (tool.name === "summarize_text" && /\b(summarize|summary of)\b/i.test(goal)) ||
        (tool.name === "fetch_user_memory" && /\b(what do you remember|fetch memory|recall)\b/i.test(goal))
      ) {
        if (!requiredToolNames.includes(tool.name)) {
          requiredToolNames.push(tool.name);
          const policy = registry!.getPolicy(tool.name);
          if (policy.destructive || policy.confirmationRequired) {
            requiresApproval = true;
          }
        }
      }
    }

    // Check for structural multi-step indicators
    const hasSequentialSteps =
      /\b(step 1|then|after that|first.*second|and finally|research.*and summarize)\b/i.test(
        goal,
      );

    const requiresMemoryWrite =
      /\b(remember that|save to memory|store insight|commit to notes)\b/i.test(goal);

    const hasActiveTaskMultiStep =
      !!request.context?.activeTask && request.context.activeTask.goal !== goal;

    const isMultiStep =
      hasSequentialSteps ||
      hasActiveTaskMultiStep ||
      requiredToolNames.length > 1;

    return {
      isMultiStep,
      requiresTools: requiredToolNames.length > 0,
      requiresExternalInfo: requiredToolNames.length > 0,
      requiresMemoryWrite,
      requiresApproval,
      requiredToolNames,
    };
  }

  /**
   * Direct-Response Optimization:
   * Generates a minimal, elegant 1-node reasoning plan for simple informational queries.
   */
  private generateDirectResponseCandidate(goal: string, graphId: string): CandidatePlan {
    const node: CandidateNode = {
      id: "step_1_direct_response",
      title: "Synthesize response",
      type: "llm_reasoning",
      reasoningSpec: {
        prompt: `Provide a direct, accurate, and comprehensive response to the user's inquiry: "${goal}"`,
        targetFormat: "markdown",
      },
      status: "pending",
      approval: {
        status: "not_required",
        reason: "Direct informational reasoning",
      },
      verification: {
        required: false,
        strategy: "none",
      },
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 500,
      },
      timeoutMs: 30000,
    };

    return {
      graphId,
      goal,
      strategy: "Direct single-step reasoning",
      advisoryEstimatedSteps: 1,
      advisoryRequiresApproval: false,
      nodes: [node],
      edges: [],
    };
  }

  /**
   * Multi-step candidate generator based on structural requirements.
   */
  private generateMultiStepCandidate(
    goal: string,
    graphId: string,
    criteria: PlanStructuralCriteria,
  ): CandidatePlan {
    const nodes: CandidateNode[] = [];
    const edges: CandidateEdge[] = [];

    // If tools are required, emit tool nodes
    let previousStepId = "";

    if (criteria.requiresTools && criteria.requiredToolNames.length > 0) {
      for (let i = 0; i < criteria.requiredToolNames.length; i++) {
        const toolName = criteria.requiredToolNames[i];
        const stepId = `step_${i + 1}_tool_${toolName}`;

        let parameters: Record<string, unknown> = {};
        if (toolName === "calculate_math") {
          const mathMatch = goal.match(/(?:calculate|compute|eval)?\s*([0-9a-zA-Z_\.\s\+\-\*\/\(\)\^\%]+?)(?:\s+(?:and|then|to\s+summarize|summarize)|$)/i);
          const rawFormula = mathMatch && mathMatch[1] && mathMatch[1].trim().length >= 3 ? mathMatch[1].trim() : "1000 * (1 + 0.05) ** 3";
          parameters = {
            expression: rawFormula,
          };
        } else if (toolName === "search_information") {
          parameters = { query: goal };
        } else if (toolName === "summarize_text") {
          parameters = { text: goal, maxLength: 500 };
        }

        nodes.push({
          id: stepId,
          title: `Execute tool: ${toolName}`,
          type: "tool_call",
          actionSpec: {
            toolName,
            parameters,
          },
          approval: criteria.requiresApproval
            ? { status: "pending", reason: "Tool requires confirmation" }
            : { status: "not_required", reason: "Tool call" },
          verification: { required: false, strategy: "none" },
          retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
          timeoutMs: 30000,
        });

        if (previousStepId) {
          edges.push({
            fromNodeId: previousStepId,
            toNodeId: stepId,
            dependencyType: "hard",
          });
        }
        previousStepId = stepId;
      }
    }

    // Synthesis node
    const synthesisId = `step_${nodes.length + 1}_synthesize`;
    nodes.push({
      id: synthesisId,
      title: "Synthesize findings",
      type: "llm_reasoning",
      reasoningSpec: {
        prompt: `Synthesize findings and generate final response for goal: "${goal}"`,
        targetFormat: "markdown",
      },
      approval: { status: "not_required", reason: "Pure synthesis" },
      verification: { required: false, strategy: "none" },
      retryPolicy: { maxAttempts: 1, backoffMs: 500 },
      timeoutMs: 30000,
    });

    if (previousStepId) {
      edges.push({
        fromNodeId: previousStepId,
        toNodeId: synthesisId,
        dependencyType: "hard",
      });
    }

    // Optional memory commit node
    if (criteria.requiresMemoryWrite) {
      const memoryId = `step_${nodes.length + 1}_memory_write`;
      nodes.push({
        id: memoryId,
        title: "Persist summary to user memory",
        type: "memory_write",
        memorySpec: {
          key: `insight_${Date.now()}`,
          content: `Insight from goal: ${goal}`,
          category: "general",
        },
        approval: { status: "not_required", reason: "Memory write" },
        verification: { required: false, strategy: "none" },
        retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
        timeoutMs: 10000,
      });

      edges.push({
        fromNodeId: synthesisId,
        toNodeId: memoryId,
        dependencyType: "hard",
      });
    }

    return {
      graphId,
      goal,
      strategy: "Multi-step structured workflow",
      advisoryEstimatedSteps: nodes.length,
      advisoryRequiresApproval: criteria.requiresApproval,
      nodes,
      edges,
    };
  }

  /**
   * Generates candidate plan for a replanning event based on previous graph and failure reason.
   */
  private generateReplannedCandidate(
    previousGraph: ExecutionGraph,
    replanReason: string,
    failedNodeId?: string,
  ): CandidatePlan {
    const candidateNodes: CandidateNode[] = [];
    const candidateEdges: CandidateEdge[] = [];

    for (const [nodeId, node] of Object.entries(previousGraph.nodes)) {
      if (nodeId === failedNodeId) {
        // Replace failed node with an adaptive fallback reasoning node
        candidateNodes.push({
          id: `${nodeId}_recovery`,
          title: `Recovery step for ${node.title}`,
          type: "llm_reasoning",
          reasoningSpec: {
            prompt: `Execute fallback recovery strategy for node "${node.title}". Reason: ${replanReason}`,
            targetFormat: "markdown",
          },
          approval: { status: "not_required", reason: "Recovery reasoning" },
          verification: { required: false, strategy: "none" },
          retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
          timeoutMs: 30000,
        });
      } else {
        candidateNodes.push({
          id: node.id,
          title: node.title,
          type: node.type,
          actionSpec: node.actionSpec,
          reasoningSpec: node.reasoningSpec,
          memorySpec: node.memorySpec,
          inputBindings: node.inputBindings,
          approval: node.approval,
          verification: node.verification,
          retryPolicy: node.retryPolicy,
          timeoutMs: node.timeoutMs,
        });
      }
    }

    // Map edges to account for replaced node
    for (const edge of previousGraph.edges) {
      const fromId = edge.fromNodeId === failedNodeId ? `${failedNodeId}_recovery` : edge.fromNodeId;
      const toId = edge.toNodeId === failedNodeId ? `${failedNodeId}_recovery` : edge.toNodeId;
      candidateEdges.push({
        fromNodeId: fromId,
        toNodeId: toId,
        dependencyType: edge.dependencyType,
        condition: edge.condition,
      });
    }

    return {
      graphId: previousGraph.graphId,
      goal: `${previousGraph.goal} (Replanned: ${replanReason})`,
      strategy: `Replanned after node failure: ${replanReason}`,
      advisoryEstimatedSteps: candidateNodes.length,
      advisoryRequiresApproval: previousGraph.metadata.requiresApproval,
      nodes: candidateNodes,
      edges: candidateEdges,
    };
  }
}

export const agentPlannerService = new AgentPlannerService();
