import { Router, type Request, type Response, type IRouter } from "express";
import { executionEngine } from "../execution/execution-engine";
import { getExecutionConfig } from "../execution/config";
import { executionObservability } from "../execution/observability/execution-logger";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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
 * POST /api/execution/dry-run
 * Deterministic dry run simulation without side effects or mutations.
 */
router.post("/execution/dry-run", async (req: Request, res: Response) => {
  try {
    const { graphId, planRevision, executionContext } = req.body;

    if (!graphId || typeof planRevision !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: graphId (string) and planRevision (number) are required.",
      });
    }

    const dryRun = await executionEngine.dryRunExecution({
      graphId,
      planRevision,
      requestId: `req_dryrun_${Date.now()}`,
      executionContext: executionContext || {
        telegramUserId: req.body.telegramUserId || 1,
        availableCapabilities: req.body.availableCapabilities || [],
      },
    });

    return res.status(200).json({
      success: true,
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

export default router;
