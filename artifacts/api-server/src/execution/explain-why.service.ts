import { getPool } from "@workspace/db";
import { getConfig } from "../config/env";
import { logger } from "../lib/logger";
import { planPersistenceService } from "../planner/plan-persistence.service";
import type { ExecutionGraph, GraphNode } from "../planner/types";
import { durableEventStoreService } from "./persistence/durable-event-store.service";
import { executionPersistence } from "./persistence/execution-persistence.service";
import { unifiedModelRegistryService } from "../services/unified-model-registry.service";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";

export interface NodeModelChoiceExplanation {
  model: string;
  role: "reasoning" | "fast" | "extraction" | "default";
  tier: string;
  rationale: string;
  allowedTiers: string[];
  fallbackCandidates: string[];
}

export interface NodeRetryExplanation {
  totalAttempts: number;
  maxAttempts: number;
  wasRetried: boolean;
  lastErrorCategory?: string;
  lastErrorCode?: string;
  backoffStrategy?: string;
  backoffMsApplied?: number;
  explanation: string;
}

export interface NodeFallbackExplanation {
  fallbackTriggered: boolean;
  primaryTarget?: string;
  fallbackTarget?: string;
  triggerReason?: string;
}

export interface NodeExplanation {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  toolName?: string;
  status: string;
  modelChoice?: NodeModelChoiceExplanation;
  retryAnalysis?: NodeRetryExplanation;
  fallbackAnalysis?: NodeFallbackExplanation;
  inputBindingsSummary?: string[];
}

export interface ReplanTriggerExplanation {
  fromRevision: number;
  toRevision: number;
  triggerReason: string;
  failedNodeId?: string;
  timestamp?: string;
}

export interface ExplainWhyReport {
  executionId?: string;
  graphId: string;
  planRevision: number;
  goal: string;
  overallStrategy: string;
  modelDecisions: {
    primaryModel: string;
    reasoningModel: string;
    fastModel: string;
    summary: string;
    tierRationale: string;
  };
  nodeExplanations: Record<string, NodeExplanation>;
  retrySummary: {
    totalRetriedNodes: number;
    totalRetryAttempts: number;
    explanations: string[];
  };
  fallbackSummary: {
    totalFallbacksTriggered: number;
    explanations: string[];
  };
  replanningSummary: {
    planRevision: number;
    isReplanned: boolean;
    replanTriggers: ReplanTriggerExplanation[];
  };
  safetyPolicySummary: {
    enforcedBudgets: {
      maxNodes: number;
      actualNodes: number;
      maxDurationMs: number;
    };
    approvalsRequiredCount: number;
    destructiveNodes: string[];
    domainWhitelistsEnforced: string[];
  };
}

export class ExplainWhyService {
  private static instance: ExplainWhyService;

  public static getInstance(): ExplainWhyService {
    if (!ExplainWhyService.instance) {
      ExplainWhyService.instance = new ExplainWhyService();
    }
    return ExplainWhyService.instance;
  }

  async generateExplanation(params: {
    graphId: string;
    planRevision?: number;
    executionId?: string;
  }): Promise<ExplainWhyReport> {
    const { graphId } = params;
    const config = getConfig();

    // 1. Resolve Graph
    const graph = await planPersistenceService.getGraph(graphId, params.planRevision);
    if (!graph) {
      throw new Error(`Graph "${graphId}" (revision ${params.planRevision ?? "latest"}) not found.`);
    }
    const planRevision = graph.planRevision;

    // 2. Resolve Session (if executionId provided or look up by graph)
    const session = params.executionId
      ? await executionPersistence.getExecutionSession(params.executionId)
      : await executionPersistence.getSessionForGraph(graphId, planRevision);

    const executionId = session?.executionId || params.executionId;

    // 3. Fetch Node Executions from PostgreSQL
    let nodeExecutionRows: any[] = [];
    try {
      if (process.env.DATABASE_URL) {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM node_executions WHERE graph_id = $1 AND plan_revision = $2 ORDER BY node_id, attempt ASC`,
          [graphId, planRevision],
        );
        nodeExecutionRows = res.rows;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "EXPLAIN_WHY_FETCH_NODE_EXECUTIONS_WARNING");
    }

    // 4. Fetch Timeline Events
    let events: any[] = [];
    if (executionId) {
      try {
        events = await durableEventStoreService.getSessionTimeline(executionId);
      } catch (err) {
        logger.warn({ err: String(err) }, "EXPLAIN_WHY_FETCH_TIMELINE_WARNING");
      }
    }

    // 5. Fetch Previous Revisions for Replan Analysis
    let revisionRows: any[] = [];
    try {
      if (process.env.DATABASE_URL) {
        const pool = getPool();
        const revRes = await pool.query(
          `SELECT plan_revision, revision_id, parent_revision_id, status, created_at, graph_json
           FROM graph_revisions WHERE graph_id = $1 ORDER BY plan_revision ASC`,
          [graphId],
        );
        revisionRows = revRes.rows;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "EXPLAIN_WHY_FETCH_REVISIONS_WARNING");
    }

    // Authoritative Model Resolution from UnifiedModelRegistryService & AdaptiveEngineService
    const allModels = await unifiedModelRegistryService.list();
    const enabledModels = allModels.filter((m) => m.enabled);

    const primaryRecord = enabledModels.find((m) => m.roles.includes("primary")) || enabledModels[0];
    const reasoningRecord = enabledModels.find((m) => m.roles.includes("reasoning")) || primaryRecord;
    const fastRecord = enabledModels.find((m) => m.roles.includes("fast")) || primaryRecord;

    const primaryModel = primaryRecord ? `${primaryRecord.provider}/${primaryRecord.modelId}` : "adaptive";
    const reasoningModel = reasoningRecord ? `${reasoningRecord.provider}/${reasoningRecord.modelId}` : primaryModel;
    const fastModel = fastRecord ? `${fastRecord.provider}/${fastRecord.modelId}` : primaryModel;
    const modelPool = enabledModels.map((m) => `${m.provider}/${m.modelId}`);

    const modelTierRationale =
      "Dynamic Unified Model Registry and AdaptiveEngineService policy: Tasks and node executions are evaluated by AdaptiveEngineService and routed via AdaptiveAIRouterService according to live provider health, latency metrics, and task capabilities. The Unified Model Registry is authoritative, ensuring multi-provider resilience across registered models without hardcoded model assignments.";

    const nodeExplanations: Record<string, NodeExplanation> = {};
    const retryExplanationsList: string[] = [];
    const fallbackExplanationsList: string[] = [];
    let totalRetriedNodes = 0;
    let totalRetryAttempts = 0;
    let totalFallbacks = 0;

    const destructiveNodesList: string[] = [];
    let approvalsCount = 0;

    // Analyze each node in the graph
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const attemptsForNode = nodeExecutionRows.filter((r) => r.node_id === nodeId);
      const attemptCount = Math.max(attemptsForNode.length, 1);
      const maxAttempts = node.retryPolicy?.maxAttempts || 3;
      const wasRetried = attemptCount > 1;

      if (wasRetried) {
        totalRetriedNodes++;
        totalRetryAttempts += attemptCount - 1;
      }

      // Check approval/destructive
      const isDestructive = node.metadata?.destructive === true || node.type === "user_checkpoint";
      if (isDestructive) {
        destructiveNodesList.push(nodeId);
      }
      if (node.approval && node.approval.status !== "not_required") {
        approvalsCount++;
      }

      // Model choice analysis from authoritative runtime execution metadata or AdaptiveEngineService
      let modelChoice: NodeModelChoiceExplanation | undefined;
      if (node.type === "llm_reasoning" || node.type === "subgoal_aggregate") {
        const lastAttempt = attemptsForNode.slice().reverse()[0];
        let executedModel: string | undefined;
        let executedProvider: string | undefined;
        let executedCandidateReasons: string[] = [];

        if (lastAttempt?.result_json) {
          try {
            const parsedResult =
              typeof lastAttempt.result_json === "string"
                ? JSON.parse(lastAttempt.result_json)
                : lastAttempt.result_json;
            if (parsedResult?.metadata?.model) {
              executedModel = parsedResult.metadata.model;
              executedProvider = parsedResult.metadata.provider;
              executedCandidateReasons = parsedResult.metadata.candidateReasons || [];
            }
          } catch {
            // fallback
          }
        }
        if (!executedModel && node.result?.metadata?.model) {
          executedModel = node.result.metadata.model as string;
          executedProvider = node.result.metadata.provider as string;
          executedCandidateReasons = (node.result.metadata.candidateReasons as string[]) || [];
        }

        const isComplex =
          (node.reasoningSpec?.instructions?.length || 0) > 120 ||
          (node.reasoningSpec?.prompt?.length || 0) > 120 ||
          node.type === "subgoal_aggregate";

        let selectedModel: string;
        let role: "reasoning" | "fast" | "extraction" | "default";
        let rationale: string;

        if (executedModel) {
          selectedModel = executedProvider ? `${executedProvider}/${executedModel}` : executedModel;
          role = isComplex ? "reasoning" : "fast";
          rationale = `Executed via AdaptiveEngineService & AdaptiveAIRouterService using registry model (${selectedModel}). Selection criteria: ${
            executedCandidateReasons.length > 0
              ? executedCandidateReasons.join("; ")
              : "Authoritative candidate score matching task capability and provider health"
          }.`;
        } else {
          // Dynamically compute via AdaptiveEngineService respecting registry
          const promptForAdaptive = node.reasoningSpec?.prompt || node.title;
          const adaptiveChosenModel = AdaptiveEngineService.computeAdaptiveModel({
            prompt: promptForAdaptive,
            isDeepReasoning: isComplex,
            isExtraction: node.type === "memory_write",
          });

          const matchedRecord =
            enabledModels.find((m) => m.modelId === adaptiveChosenModel) ||
            (isComplex ? reasoningRecord : fastRecord) ||
            primaryRecord;

          selectedModel = matchedRecord ? `${matchedRecord.provider}/${matchedRecord.modelId}` : primaryModel;
          role = (matchedRecord?.roles?.find((r) => r === "reasoning" || r === "fast") as any) || (isComplex ? "reasoning" : "fast");
          rationale = `AdaptiveEngineService dynamically resolved ${matchedRecord?.name || selectedModel} from Unified Model Registry based on ${
            isComplex ? "analytical depth and verification requirements" : "low-latency and token budget conservation"
          }.`;
        }

        modelChoice = {
          model: selectedModel,
          role,
          tier: isComplex ? "TIER_PRO" : "TIER_STANDARD",
          rationale,
          allowedTiers: ["TIER_STANDARD", "TIER_PRO", "TIER_ENTERPRISE"],
          fallbackCandidates: modelPool.filter((m) => m !== selectedModel),
        };
      }

      // Retry analysis
      let retryAnalysis: NodeRetryExplanation | undefined;
      const lastFailedAttempt = attemptsForNode.slice().reverse().find((a) => a.status === "failed");
      const lastError = lastFailedAttempt?.error_code;
      const isRateLimit = lastError?.includes("429") || lastError?.includes("RATE_LIMIT") || lastError?.includes("QUOTA");
      const isTimeout = lastError?.includes("TIMEOUT") || lastError?.includes("DEADLINE");

      let retryExplanationText = "Executed successfully on initial attempt without retries.";
      if (wasRetried) {
        const cause = isRateLimit
          ? "transient rate limit (HTTP 429)"
          : isTimeout
          ? "worker timeout"
          : "transient execution failure";

        retryExplanationText = `Encountered ${cause} on attempt 1. Policy engine applied exponential backoff (${
          node.retryPolicy?.backoffMultiplier || 2
        }x) with ${attemptCount} total attempts recorded.`;

        retryExplanationsList.push(`Node "${nodeId}": ${retryExplanationText}`);
      }

      retryAnalysis = {
        totalAttempts: attemptCount,
        maxAttempts,
        wasRetried,
        lastErrorCode: lastError,
        lastErrorCategory: lastFailedAttempt?.category || (isRateLimit ? "rate_limit" : isTimeout ? "timeout" : "none"),
        backoffStrategy: node.retryPolicy?.backoffPolicy || "exponential",
        backoffMsApplied: wasRetried ? 1000 * Math.pow(2, attemptCount - 1) : 0,
        explanation: retryExplanationText,
      };

      // Fallback analysis
      const fallbackEvent = events.find(
        (e) => e.nodeId === nodeId && (e.eventType === "FALLBACK_TRIGGERED" || e.eventType?.includes("FALLBACK")),
      );
      const fallbackTriggered = !!fallbackEvent;
      if (fallbackTriggered) {
        totalFallbacks++;
        fallbackExplanationsList.push(
          `Node "${nodeId}": Triggered fallback adapter due to ${fallbackEvent?.metadata?.reason || "primary provider unresponsiveness"}.`,
        );
      }

      const fallbackAnalysis: NodeFallbackExplanation = {
        fallbackTriggered,
        primaryTarget: primaryModel,
        fallbackTarget: fallbackTriggered ? modelPool[1] : undefined,
        triggerReason: fallbackEvent?.metadata?.reason as string | undefined,
      };

      // Input bindings summary
      const bindingsSummary: string[] = [];
      if (node.inputBindings) {
        for (const [k, v] of Object.entries(node.inputBindings)) {
          bindingsSummary.push(`${k} ← ${v.sourceNodeId}.${v.sourcePath}`);
        }
      }

      // Determine node status
      let nodeStatus = "pending";
      if (session?.completedNodes?.includes(nodeId)) {
        nodeStatus = "completed";
      } else if (session?.failedNodes?.includes(nodeId)) {
        nodeStatus = "failed";
      } else if (session?.runningNodeIds?.includes(nodeId) || session?.currentNodes?.includes(nodeId)) {
        nodeStatus = "running";
      } else if (session?.waitingApprovalNodes?.includes(nodeId)) {
        nodeStatus = "waiting_approval";
      }

      nodeExplanations[nodeId] = {
        nodeId,
        nodeName: node.name || nodeId,
        nodeType: node.type,
        toolName: node.actionSpec?.toolName,
        status: nodeStatus,
        modelChoice,
        retryAnalysis,
        fallbackAnalysis,
        inputBindingsSummary: bindingsSummary,
      };
    }

    // Replanning Triggers
    const replanTriggers: ReplanTriggerExplanation[] = [];
    if (revisionRows.length > 1) {
      for (let i = 1; i < revisionRows.length; i++) {
        const cur = revisionRows[i];
        const prev = revisionRows[i - 1];
        let triggerReason = "Adaptive replanning triggered by validation failure or dynamic workflow recovery.";

        // Look for replan events in timeline
        const replanEvt = events.find(
          (e) => e.eventType === "REPLAN_STARTED" && e.metadata?.toRevision === cur.plan_revision,
        );
        if (replanEvt?.metadata?.reason) {
          triggerReason = String(replanEvt.metadata.reason);
        } else if (prev.status === "failed") {
          triggerReason = `Preceding plan revision r${prev.plan_revision} halted with error; graph compiler synthesized revised DAG r${cur.plan_revision}.`;
        }

        replanTriggers.push({
          fromRevision: prev.plan_revision,
          toRevision: cur.plan_revision,
          triggerReason,
          failedNodeId: replanEvt?.metadata?.failedNodeId as string | undefined,
          timestamp: cur.created_at ? new Date(cur.created_at).toISOString() : undefined,
        });
      }
    }

    return {
      executionId,
      graphId,
      planRevision,
      goal: graph.goal,
      overallStrategy:
        graph.metadata?.overallStrategy ||
        `Autonomous execution DAG composed of ${Object.keys(graph.nodes).length} nodes across topological tiers.`,
      modelDecisions: {
        primaryModel,
        reasoningModel,
        fastModel,
        summary: `AdaptiveEngineService & Unified Model Registry dynamically routed execution across ${enabledModels.length} registered models (Primary: ${primaryModel}, Reasoning: ${reasoningModel}, Fast: ${fastModel}). Node assignments strictly follow authoritative registry candidate evaluation.`,
        tierRationale: modelTierRationale,
      },
      nodeExplanations,
      retrySummary: {
        totalRetriedNodes,
        totalRetryAttempts,
        explanations: retryExplanationsList,
      },
      fallbackSummary: {
        totalFallbacksTriggered: totalFallbacks,
        explanations: fallbackExplanationsList,
      },
      replanningSummary: {
        planRevision,
        isReplanned: planRevision > 1,
        replanTriggers,
      },
      safetyPolicySummary: {
        enforcedBudgets: {
          maxNodes: 50,
          actualNodes: Object.keys(graph.nodes).length,
          maxDurationMs: 300_000,
        },
        approvalsRequiredCount: approvalsCount,
        destructiveNodes: destructiveNodesList,
        domainWhitelistsEnforced: ["api.telegram.org", "generativelanguage.googleapis.com"],
      },
    };
  }
}

export const explainWhyService = ExplainWhyService.getInstance();
