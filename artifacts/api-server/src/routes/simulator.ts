import { Router, type IRouter, type Request, type Response } from "express";
import { MODE_KEYS, type ModeKey } from "../config/mode";
import { botSimulatorService } from "../services/bot-simulator.service";
import { safeErrorMetadata } from "../utils/safe-error";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseUserId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("telegramUserId must be a non-negative safe integer");
  return parsed;
}

function parseMode(value: unknown): ModeKey | "auto" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "auto") return "auto";
  if (typeof value !== "string" || !MODE_KEYS.includes(value as ModeKey)) {
    throw new Error(`modeOverride must be one of: auto, ${MODE_KEYS.join(", ")}`);
  }
  return value as ModeKey;
}

router.get("/simulator/runs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const runs = await botSimulatorService.list(limit);
    return res.json({ success: true, runs });
  } catch (error) {
    logger.error({ stage: "simulator_list", error: safeErrorMetadata(error) }, "Failed to list simulator runs");
    return res.status(500).json({ success: false, error: "Failed to load simulator runs" });
  }
});

router.post("/simulator/run", async (req: Request, res: Response) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message : "";
    const telegramUserId = parseUserId(body.telegramUserId);
    const modeOverride = parseMode(body.modeOverride);
    const includeHistory = body.includeHistory !== false;
    const enableLiveSearch = body.enableLiveSearch === undefined ? undefined : Boolean(body.enableLiveSearch);

    const result = await botSimulatorService.run({
      message,
      telegramUserId,
      modeOverride,
      includeHistory,
      enableLiveSearch,
    });
    return res.status(result.status === "completed" ? 200 : 422).json({ success: result.status === "completed", result });
  } catch (error) {
    logger.warn({ stage: "simulator_run_validation", error: safeErrorMetadata(error) }, "Bot simulation request rejected");
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/simulator/runs/:id", async (req: Request, res: Response) => {
  try {
    const run = await botSimulatorService.get(req.params.id);
    if (!run) return res.status(404).json({ success: false, error: "Simulation run not found" });
    return res.json({ success: true, run });
  } catch (error) {
    logger.error({ stage: "simulator_get", error: safeErrorMetadata(error) }, "Failed to load simulator run");
    return res.status(500).json({ success: false, error: "Failed to load simulator run" });
  }
});

export default router;
