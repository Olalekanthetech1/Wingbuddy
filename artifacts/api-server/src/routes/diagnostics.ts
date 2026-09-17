import { Router, type IRouter, type Request, type Response } from "express";
import { diagnosticsService } from "../services/diagnostics.service";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * GET /dashboard/diagnostics/status
 * Returns system health matrix, provider statuses, active alerts, and summary counts.
 */
router.get("/dashboard/diagnostics/status", async (_req: Request, res: Response) => {
  try {
    const matrix = await diagnosticsService.getSystemHealthMatrix();
    res.json(matrix);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Diagnostics status check failed");
    res.status(500).json({
      overallStatus: "CRITICAL",
      error: error instanceof Error ? error.message : "Failed to retrieve diagnostics status",
    });
  }
});

/**
 * GET /dashboard/diagnostics/trends
 * Returns 24-hour success/failure metrics, modality distribution, and categorized error counts.
 */
router.get("/dashboard/diagnostics/trends", (_req: Request, res: Response) => {
  try {
    const trends = diagnosticsService.getHistoricalTrends();
    res.json(trends);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Diagnostics trends check failed");
    res.status(500).json({ error: "Failed to compile diagnostic trends" });
  }
});

/**
 * POST /dashboard/diagnostics/probe
 * Executes an interactive probe against a provider or runs all probes.
 */
router.post("/dashboard/diagnostics/probe", async (req: Request, res: Response) => {
  try {
    const probeId = String(req.body?.probeId || "all").trim();
    if (probeId === "all") {
      const results = await diagnosticsService.runAllProbes();
      res.json({ results });
    } else {
      const result = await diagnosticsService.runProbe(probeId);
      res.json({ result });
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Interactive probe execution failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Probe execution failed",
    });
  }
});

/**
 * POST /dashboard/diagnostics/simulate
 * Simulates end-to-end prompt processing, router selection, tier authorization,
 * provider credentials, and storage readiness without consuming user budget.
 */
router.post("/dashboard/diagnostics/simulate", async (req: Request, res: Response) => {
  try {
    const prompt = String(req.body?.prompt || "").trim() || "A cinematic drone shot of a futuristic metropolis";
    const modality = req.body?.modality === "video" ? "video" : "image";
    const result = await diagnosticsService.simulatePipeline(prompt, modality);
    res.json(result);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Pipeline simulation failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Simulation execution failed",
    });
  }
});

/**
 * GET /dashboard/diagnostics/jobs
 * Returns recent media execution jobs with classified errors and remediation guides.
 */
router.get("/dashboard/diagnostics/jobs", (req: Request, res: Response) => {
  try {
    const modality = typeof req.query.modality === "string" ? (req.query.modality as any) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 40;

    const jobs = diagnosticsService.listJobsWithDiagnostics({ modality, status, limit });
    res.json({ jobs });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to fetch diagnostic jobs");
    res.status(500).json({ error: "Failed to list diagnostic jobs" });
  }
});

/**
 * POST /dashboard/diagnostics/alert-telegram
 * Dispatches a formatted diagnostics snapshot directly to Telegram admin chat.
 */
router.post("/dashboard/diagnostics/alert-telegram", async (req: Request, res: Response) => {
  try {
    const chatId = req.body?.chatId;
    const result = await diagnosticsService.sendTelegramSnapshot(chatId);
    res.json(result);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to dispatch Telegram diagnostic snapshot");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to send alert to Telegram",
    });
  }
});

export default router;
