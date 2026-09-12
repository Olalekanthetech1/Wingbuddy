import { Router, type Request, type Response, type IRouter } from "express";
import { executionEngine } from "../execution/execution-engine";
import {
  getExecutionConfig,
  isExecutionEngineEnabled,
  setExecutionEngineEnabled,
  toggleExecutionEngine,
} from "../execution/config";
import { executionObservability } from "../execution/observability/execution-logger";
import { executionPersistence } from "../execution/persistence/execution-persistence.service";
import { logger } from "../lib/logger";
import { agentPlannerService } from "../planner/agent-planner.service";
import { planPersistenceService } from "../planner/plan-persistence.service";
import { explainWhyService } from "../execution/explain-why.service";
import { durableEventStoreService } from "../execution/persistence/durable-event-store.service";
import { regressionSuiteService } from "../execution/evaluation/regression-suite.service";
import { universalArtifactService } from "../services/universal-artifact.service";
import { asyncJobPollerService } from "../services/async-job-poller.service";
import type { CandidatePlan } from "../planner/types";

const router: IRouter = Router();

async function compileGoalToGraph(goal: string, customCandidate?: any, telegramUserId?: number, userTier?: string) {
  let plannerResult = await agentPlannerService.plan(
    {
      goal,
      requestId: `req_plan_${Date.now()}`,
      telegramUserId: telegramUserId || 1,
      userCapabilities: [],
      userTier: userTier || "TIER_PRO",
      allowedDomains: ["api.telegram.org", "generativelanguage.googleapis.com"],
    },
    customCandidate,
  );

  if (!plannerResult.graph) {
    const fallbackCandidate: CandidatePlan = {
      goal,
      strategy: "Multi-tier autonomous execution and synthesis",
      nodes: [
        {
          id: "step_1_analyze",
          title: "Analyze Objective",
          type: "llm_reasoning",
          reasoningSpec: {
            prompt: `Analyze the user goal, gather requirements, and formulate execution steps for: ${goal}`,
            targetFormat: "markdown",
          },
        },
        {
          id: "step_2_execute",
          title: "Execute Core Task",
          type: "llm_reasoning",
          reasoningSpec: {
            prompt: `Execute the core task according to the formulated plan for: ${goal}`,
            targetFormat: "markdown",
          },
          dependsOn: ["step_1_analyze"],
        },
        {
          id: "step_3_verify",
          title: "Verify & Synthesize",
          type: "subgoal_aggregate",
          reasoningSpec: {
            prompt: "Synthesize outputs, verify criteria satisfaction, and produce the final briefing.",
            targetFormat: "markdown",
          },
          dependsOn: ["step_2_execute"],
        },
      ],
      edges: [
        { fromNodeId: "step_1_analyze", toNodeId: "step_2_execute", dependencyType: "hard" },
        { fromNodeId: "step_2_execute", toNodeId: "step_3_verify", dependencyType: "hard" },
      ],
    };

    plannerResult = await agentPlannerService.plan(
      {
        goal,
        requestId: `req_plan_fb_${Date.now()}`,
        telegramUserId: telegramUserId || 1,
      },
      fallbackCandidate,
    );
  }

  return plannerResult;
}

/**
 * POST /api/execution/toggle
 * Dynamically toggles the autonomous execution engine state (ON <-> OFF).
 */
router.post("/execution/toggle", (_req: Request, res: Response) => {
  try {
    const newState = toggleExecutionEngine();
    logger.info({ enabled: newState }, "AUTONOMOUS_EXECUTION_TOGGLED_VIA_API");
    return res.status(200).json({
      success: true,
      enabled: newState,
      message: `Autonomous execution engine is now ${newState ? "ENABLED (ON)" : "DISABLED (OFF)"}.`,
      config: getExecutionConfig(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/set-enabled
 * Explicitly sets autonomous execution engine enabled/disabled.
 */
router.post("/execution/set-enabled", (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'enabled' boolean in request body.",
      });
    }
    setExecutionEngineEnabled(enabled);
    logger.info({ enabled }, "AUTONOMOUS_EXECUTION_STATE_SET_VIA_API");
    return res.status(200).json({
      success: true,
      enabled,
      message: `Autonomous execution engine is now ${enabled ? "ENABLED (ON)" : "DISABLED (OFF)"}.`,
      config: getExecutionConfig(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/sessions
 * Returns recent and active autonomous execution sessions with status and telemetry.
 */
router.get("/execution/sessions", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const sessions = await executionPersistence.listRecentSessions(limit);
    const enabled = isExecutionEngineEnabled();
    const metrics = executionObservability.getMetrics();

    return res.status(200).json({
      success: true,
      enabled,
      totalSessions: sessions.length,
      sessions,
      metrics,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/start
 * Starts autonomous execution of a persisted graph revision.
 */
router.post("/execution/start", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, requestId, taskId, executionContext } = req.body;

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId (string) and planRevision (number) are required.",
      });
    }

    const session = await executionEngine.startExecution({
      graphId,
      planRevision,
      requestId: requestId || `req_api_${Date.now()}`,
      taskId,
      executionContext: executionContext || {
        telegramUserId: req.body.telegramUserId || 1,
        availableCapabilities: req.body.availableCapabilities || [],
      },
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (err: any) {
    logger.error({ err: String(err) }, "API_EXECUTION_START_ERROR");
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/plan-only
 * Mode 1: Compiles candidate DAG without executing it.
 */
router.post("/execution/plan-only", async (req: Request, res: Response) => {
  try {
    const { goal, customCandidate, telegramUserId, userCapabilities, userTier } = req.body;
    if (!goal || typeof goal !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing required field: 'goal' (string) is required for plan compilation.",
      });
    }

    const plannerResult = await compileGoalToGraph(goal, customCandidate, telegramUserId, userTier);

    return res.status(200).json({
      success: true,
      mode: "PLAN_ONLY",
      graph: plannerResult.graph,
      validation: plannerResult.validation,
      diagnostics: plannerResult.diagnostics,
      strategy: plannerResult.strategy,
      requiresApproval: plannerResult.requiresApproval,
      isDirectResponse: plannerResult.isDirectResponse,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/dry-run
 * Mode 2: Simulates tool boundaries & validates permissions without external side effects.
 */
router.post("/execution/dry-run", async (req: Request, res: Response) => {
  try {
    let { graphId, planRevision, goal, executionContext, telegramUserId, userCapabilities } = req.body;

    let compiledGraph = null;
    if (!graphId && goal) {
      const planRes = await compileGoalToGraph(goal, undefined, telegramUserId, "TIER_PRO");
      if (!planRes.graph) {
        throw new Error("Failed to compile graph for dry run.");
      }
      graphId = planRes.graph.graphId;
      planRevision = planRes.graph.planRevision;
      compiledGraph = planRes.graph;
    }

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: Provide either 'goal' (string) or 'graphId' (string) + 'planRevision' (number).",
      });
    }

    const dryRun = await executionEngine.dryRunExecution({
      graphId,
      planRevision,
      requestId: `req_dryrun_${Date.now()}`,
      executionContext: executionContext || {
        telegramUserId: telegramUserId || 1,
        availableCapabilities: userCapabilities || [],
      },
    });

    if (!compiledGraph) {
      compiledGraph = await planPersistenceService.getGraph(graphId, planRevision);
    }

    return res.status(200).json({
      success: true,
      mode: "DRY_RUN",
      graph: compiledGraph,
      dryRun,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/live-run
 * Mode 3: Compiles (if goal given) and initiates authoritative live autonomous execution.
 */
router.post("/execution/live-run", async (req: Request, res: Response) => {
  try {
    let { graphId, planRevision, goal, executionContext, telegramUserId, userCapabilities } = req.body;

    let compiledGraph = null;
    if (!graphId && goal) {
      const planRes = await compileGoalToGraph(goal, undefined, telegramUserId, "TIER_PRO");
      if (!planRes.graph) {
        throw new Error("Failed to compile graph for live run.");
      }
      graphId = planRes.graph.graphId;
      planRevision = planRes.graph.planRevision;
      compiledGraph = planRes.graph;
    }

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: Provide either 'goal' (string) or 'graphId' (string) + 'planRevision' (number).",
      });
    }

    const session = await executionEngine.startExecution({
      graphId,
      planRevision,
      requestId: `req_live_${Date.now()}`,
      executionContext: executionContext || {
        telegramUserId: telegramUserId || 1,
        availableCapabilities: userCapabilities || [],
      },
    });

    if (!compiledGraph) {
      compiledGraph = await planPersistenceService.getGraph(graphId, planRevision);
    }

    return res.status(200).json({
      success: true,
      mode: "LIVE_RUN",
      graph: compiledGraph,
      session,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/pause
 * Pauses active execution session cleanly.
 */
router.post("/execution/pause", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, reason } = req.body;

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId and planRevision.",
      });
    }

    const session = await executionEngine.pauseExecution({
      graphId,
      planRevision,
      reason,
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/resume
 * Resumes paused execution session.
 */
router.post("/execution/resume", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, telegramUserId } = req.body;

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId and planRevision.",
      });
    }

    const session = await executionEngine.resumeExecution({
      graphId,
      planRevision,
      telegramUserId: telegramUserId || 1,
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/cancel
 * Cancels active execution cleanly.
 */
router.post("/execution/cancel", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, reason } = req.body;

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId and planRevision.",
      });
    }

    const session = await executionEngine.cancelExecution({
      graphId,
      planRevision,
      reason: reason || "Cancelled by user via API",
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/approval
 * Submits user approval or denial for a checkpoint / destructive node.
 */
router.post("/execution/approval", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, nodeId, approved, reason, telegramUserId } = req.body;

    if (!graphId || typeof planRevision !== "number" || !nodeId || typeof approved !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId, planRevision, nodeId, and approved (boolean).",
      });
    }

    const result = await executionEngine.submitApproval({
      graphId,
      planRevision,
      nodeId,
      approved,
      reason,
      telegramUserId: telegramUserId || 1,
    });

    return res.status(200).json({
      success: true,
      result,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/:executionId/status
 * Fetches authoritative execution status, progress, and node results.
 */
router.get("/execution/:executionId/status", async (req: Request, res: Response) => {
  try {
    const rawExecutionId = req.params.executionId;
    const executionId = Array.isArray(rawExecutionId) ? rawExecutionId[0] : rawExecutionId;
    if (!executionId) {
      return res.status(400).json({ success: false, error: "Missing executionId parameter" });
    }
    const status = await executionEngine.getExecutionStatus(executionId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: `Execution session "${executionId}" not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      status,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/metrics
 * Returns execution engine observability metrics.
 */
router.get("/execution/metrics", (_req: Request, res: Response) => {
  try {
    const metrics = executionObservability.getMetrics();
    return res.status(200).json({
      success: true,
      metrics,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/health
 * Returns autonomous execution engine health status, runtime limits, and diagnostic telemetry.
 */
router.get("/execution/health", (_req: Request, res: Response) => {
  try {
    const config = getExecutionConfig();
    const metrics = executionObservability.getMetrics();
    const tools = executionEngine.getToolRegistry().list().map((t) => ({
      name: t.name,
      policy: executionEngine.getToolRegistry().getPolicy(t.name),
    }));

    return res.status(200).json({
      status: "healthy",
      autonomousExecution: {
        enabled: config.enabled,
        version: "1.0.0",
        authoritativeToolRegistryCount: tools.length,
        config: {
          maxConcurrency: config.maxConcurrency,
          maxPerUser: config.maxPerUser,
          maxPerGraph: config.maxPerGraph,
          maxPerTool: config.maxPerTool,
          leaseDurationMs: config.leaseDurationMs,
          staleLeaseThresholdMs: config.staleLeaseThresholdMs,
          defaultTimeoutMs: config.defaultTimeoutMs,
          maxRetries: config.maxRetries,
        },
        tools,
        metrics,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      status: "unhealthy",
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/step
 * Interactive Stepper: Advances execution by exactly one topologically ready node.
 */
router.post("/execution/step", async (req: Request, res: Response) => {
  try {
    let { graphId, planRevision, executionId, telegramUserId, goal } = req.body;

    if (!graphId && goal) {
      const planRes = await compileGoalToGraph(goal, undefined, telegramUserId, "TIER_PRO");
      if (!planRes.graph) {
        throw new Error("Failed to compile graph for stepping.");
      }
      graphId = planRes.graph.graphId;
      planRevision = planRes.graph.planRevision;
    }

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: 'graphId' (string) and 'planRevision' (number).",
      });
    }

    const stepResult = await executionEngine.executeStep({
      graphId,
      planRevision,
      executionId,
      telegramUserId: telegramUserId || 1,
    });

    const graph = await planPersistenceService.getGraph(graphId, planRevision);

    return res.status(200).json({
      success: true,
      graph,
      ...stepResult,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/node-rerun
 * Interactive Stepper: Re-runs a specific node with fresh attempt and binding evaluation.
 */
router.post("/execution/node-rerun", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, nodeId, telegramUserId } = req.body;
    if (!graphId || typeof planRevision !== "number" || !nodeId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId, planRevision, and nodeId are required.",
      });
    }

    const rerunResult = await executionEngine.rerunNode({
      graphId,
      planRevision,
      nodeId,
      telegramUserId: telegramUserId || 1,
    });

    return res.status(200).json({
      success: true,
      ...rerunResult,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/:executionId/timeline
 * Timeline Event Stream Replay: Returns full ordered event history for session replay.
 */
router.get("/execution/:executionId/timeline", async (req: Request, res: Response) => {
  try {
    const rawExecutionId = req.params.executionId;
    const executionId = Array.isArray(rawExecutionId) ? rawExecutionId[0] : rawExecutionId;
    if (!executionId) {
      return res.status(400).json({ success: false, error: "Missing executionId" });
    }

    const timeline = await durableEventStoreService.getSessionTimeline(executionId);
    return res.status(200).json({
      success: true,
      executionId,
      count: timeline.length,
      timeline,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/:executionId/explain
 * Structured "Explain Why" Inspector: Human-readable explanations for choices, retries, fallbacks, and replanning.
 */
router.get("/execution/:executionId/explain", async (req: Request, res: Response) => {
  try {
    const rawExecutionId = req.params.executionId;
    const executionId = Array.isArray(rawExecutionId) ? rawExecutionId[0] : rawExecutionId;
    if (!executionId) {
      return res.status(400).json({ success: false, error: "Missing executionId" });
    }

    const session = await executionPersistence.getExecutionSession(executionId);
    if (!session) {
      return res.status(404).json({ success: false, error: `Execution session "${executionId}" not found.` });
    }

    const report = await explainWhyService.generateExplanation({
      executionId,
      graphId: session.graphId,
      planRevision: session.planRevision,
    });

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/execution/explain
 * Structured "Explain Why" Inspector: Explain any persisted graph revision.
 */
router.post("/execution/explain", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, executionId } = req.body;
    if (!graphId) {
      return res.status(400).json({ success: false, error: "Missing required field: graphId." });
    }

    const report = await explainWhyService.generateExplanation({
      graphId,
      planRevision: typeof planRevision === "number" ? planRevision : undefined,
      executionId,
    });

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/graph/:graphId
 * GET /api/execution/graph/:graphId/:planRevision
 * Fetches full graph structure with current session status and node results for DAG visualizer.
 */
const handleGetGraph = async (req: Request, res: Response) => {
  try {
    const rawGraphId = req.params.graphId;
    const graphId = Array.isArray(rawGraphId) ? rawGraphId[0] : rawGraphId;
    const rawRev = req.params.planRevision;
    const revStr = Array.isArray(rawRev) ? rawRev[0] : rawRev;
    const planRevision = revStr ? Number(revStr) : undefined;

    const graph = await planPersistenceService.getGraph(graphId, planRevision);
    if (!graph) {
      return res.status(404).json({ success: false, error: `Graph "${graphId}" not found.` });
    }

    const session = await executionPersistence.getSessionForGraph(graphId, graph.planRevision);
    const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(graphId, graph.planRevision);
    const nodeResults: Record<string, any> = {};
    for (const att of completedAttempts) {
      if (att.result) nodeResults[att.nodeId] = att.result;
    }

    return res.status(200).json({
      success: true,
      graph,
      session: session || null,
      nodeResults,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
};

router.get("/execution/graph/:graphId", handleGetGraph);
router.get("/execution/graph/:graphId/:planRevision", handleGetGraph);

/**
 * GET /api/execution/evaluation/fixtures
 * Returns all registered regression fixtures for tool accuracy, budget compliance, and verification rules.
 */
router.get("/execution/evaluation/fixtures", (_req: Request, res: Response) => {
  res.json({
    success: true,
    fixtures: regressionSuiteService.listFixtures(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/execution/evaluation/run
 * Runs either a specific fixture or the full regression test suite.
 */
router.post("/execution/evaluation/run", async (req: Request, res: Response) => {
  try {
    const { fixtureId, maxBudgetMs } = req.body || {};
    if (fixtureId) {
      const report = await regressionSuiteService.runFixture(fixtureId, { maxBudgetMs });
      return res.status(200).json({ success: true, report });
    }
    const summary = await regressionSuiteService.runAll({ maxBudgetMs });
    return res.status(200).json({ success: true, summary });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/execution/evaluation/summary
 * Returns the latest regression suite execution summary.
 */
router.get("/execution/evaluation/summary", (_req: Request, res: Response) => {
  const summary = regressionSuiteService.getLatestSummary();
  res.json({
    success: true,
    summary,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/execution/artifacts
 * Returns multimodal media artifacts and active async polling jobs.
 */
router.get("/execution/artifacts", (req: Request, res: Response) => {
  const executionId = req.query.executionId as string | undefined;
  const artifacts = executionId
    ? universalArtifactService.listArtifactsForExecution(executionId)
    : universalArtifactService.listAllArtifacts();

  const activeJobs = asyncJobPollerService.listActiveJobs();
  const summary = universalArtifactService.getSummary();

  res.json({
    success: true,
    artifacts,
    activeJobs,
    summary,
  });
});

/**
 * GET /api/execution/jobs/:jobId
 * Polls status for an asynchronous generation job.
 */
router.get("/execution/jobs/:jobId", (req: Request, res: Response) => {
  const job = asyncJobPollerService.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }
  return res.json({ success: true, job });
});

export default router;
