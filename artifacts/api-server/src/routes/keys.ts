import { Router, type IRouter, type Request, type Response } from "express";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import { getConfig, AI_SYSTEM_INSTRUCTION } from "../config/env";
import { logger } from "../lib/logger";
import { chatDatabaseService, db, systemSettingsTable } from "@workspace/db";
import { isExecutionEngineEnabled } from "../execution/config";

const router: IRouter = Router();

router.get("/keys", (_req: Request, res: Response) => {
  res.json(apiKeyPoolService.getSummary());
});

router.post("/keys", async (req: Request, res: Response) => {
  try {
    const { key, name } = req.body;
    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Missing required field 'key'" });
      return;
    }
    const added = await apiKeyPoolService.addKey(key, name);
    res.status(201).json({
      message: added.status === "cooldown" ? `Key (${added.name}) is valid and saved, but temporarily rate-limited (${added.cooldownSecondsLeft}s left).` : "API key validated and saved to the encrypted database registry.",
      key: added,
      poolSummary: apiKeyPoolService.getSummary(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ error: message }, "Managed API key add request failed");
    res.status(400).json({ error: message });
  }
});

router.post("/keys/purge-invalid", async (_req: Request, res: Response) => {
  try {
    const p1 = await apiKeyPoolService.purgeInvalidKeys();
    res.json({ message: `Purged ${p1} invalid Gemini API keys from database.`, purgedCount: p1, poolSummary: apiKeyPoolService.getSummary() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.delete("/keys/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  try {
    const result = await apiKeyPoolService.removeKey(id);
    if (!result.removed) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.json({ message: result.source === "env" ? "Environment key revoked and tombstoned." : "Dashboard key permanently removed.", poolSummary: apiKeyPoolService.getSummary() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, id }, "Managed API key removal failed");
    res.status(500).json({ error: "Unable to remove API key" });
  }
});

router.patch("/keys/:id/toggle", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  try {
    const updated = await apiKeyPoolService.toggleKey(id);
    if (!updated) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.json({ message: "Key state persisted", key: updated, poolSummary: apiKeyPoolService.getSummary() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/keys/mode", async (req: Request, res: Response) => {
  const { mode } = req.body;
  if (mode !== "round_robin" && mode !== "failover") {
    res.status(400).json({ error: "Invalid mode. Must be 'round_robin' or 'failover'" });
    return;
  }
  apiKeyPoolService.setRotationMode(mode);
  try {
    await db.insert(systemSettingsTable).values({ key: "KEY_ROTATION_MODE", value: mode, updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: mode, updatedAt: new Date() } });
    res.json({ message: "Rotation mode persisted", rotationMode: mode });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to persist rotation mode");
    res.status(500).json({ error: "Unable to persist rotation mode" });
  }
});

router.post("/keys/:id/test", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  try {
    const publicKey = apiKeyPoolService.getSummary().keys.find((item) => item.id === id);
    if (!publicKey) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    const candidates = await apiKeyPoolService.getOrderedKeysForExecution();
    const managed = candidates.find((item) => item.id === id);
    if (!managed) {
      res.status(409).json({ error: "Key is disabled or invalid and cannot be tested" });
      return;
    }
    const result = await apiKeyPoolService.testRawKey(managed.key);
    if (result.valid && !result.isRateLimited) apiKeyPoolService.recordSuccess(id, result.latencyMs);
    else if (!result.valid) apiKeyPoolService.recordError(id, result.error || "Key validation failed");
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/keys/test", async (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "Missing required field 'key'" });
    return;
  }
  res.json(await apiKeyPoolService.testRawKey(key));
});

router.get("/stats", (_req: Request, res: Response) => {
  const pool = apiKeyPoolService.getSummary();
  const config = getConfig();
  const executionEngineEnabled = isExecutionEngineEnabled();
  res.json({ timestamp: new Date().toISOString(), geminiModel: config.geminiModel, telegramBotStatus: Boolean(config.telegramBotToken?.trim()) ? "active" : "pending_token", databaseStatus: Boolean(process.env.DATABASE_URL?.trim()) ? "connected" : "standalone", executionEngine: { enabled: executionEngineEnabled, status: executionEngineEnabled ? "active" : "disabled" }, keyPool: pool, uptimeSeconds: Math.floor(process.uptime()), nodeVersion: process.version, memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) });
});

router.post("/chat/test", async (req: Request, res: Response) => {
  try {
    const { message, personality, mode, enableSearch, userId } = req.body;
    if (!message || typeof message !== "string") { res.status(400).json({ error: "Missing required 'message' field" }); return; }
    let memoryContext = "";
    if (userId) {
      try {
        const mems = await chatDatabaseService.getUserMemories(BigInt(userId));
        if (mems.length > 0) memoryContext = mems.map((m) => `[${m.key}]: ${m.content}`).join("\n");
      } catch (error) { logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Failed to fetch user memories for test chat"); }
    }
    const start = Date.now();
    const systemInstruction = [
      AI_SYSTEM_INSTRUCTION,
      personality ? `Personality: ${personality}` : "",
      mode ? `Mode: ${mode}` : "",
      memoryContext ? `Memory:\n${memoryContext}` : "",
    ].filter(Boolean).join("\n\n");

    const routed = await adaptiveAIRouterService.route({
      systemInstruction,
      messages: [{ role: "user", content: message }],
    }, {
      mode,
      enableSearch: Boolean(enableSearch),
    });

    res.json({
      reply: routed.response.text,
      provider: routed.candidate.model.provider,
      model: routed.candidate.model.modelId,
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      poolState: apiKeyPoolService.getSummary(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, "Test chat request failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
