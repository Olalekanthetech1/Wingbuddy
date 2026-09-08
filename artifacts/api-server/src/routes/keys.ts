import { Router, type IRouter, type Request, type Response } from "express";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { GeminiService } from "../gemini/gemini.service";
import { getConfig } from "../config/env";
import { logger } from "../lib/logger";
import { chatDatabaseService, db, systemSettingsTable } from "@workspace/db";

const router: IRouter = Router();

async function syncKeysToDatabase(): Promise<void> {
  try {
    const joined = apiKeyPoolService.getJoinedRawKeys();
    process.env.GEMINI_API_KEY = joined;
    await db
      .insert(systemSettingsTable)
      .values({ key: "GEMINI_API_KEY", value: joined, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: joined, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ error: String(err) }, "Failed to sync API keys to PostgreSQL database");
  }
}

// GET /api/keys - List all keys in pool with status & metrics
router.get("/keys", (_req: Request, res: Response) => {
  const summary = apiKeyPoolService.getSummary();
  res.json(summary);
});

// POST /api/keys - Add and validate a new API key
router.post("/keys", async (req: Request, res: Response) => {
  try {
    const { key, name } = req.body;
    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Missing required field 'key'" });
      return;
    }

    const added = await apiKeyPoolService.addKey(key, name);
    await syncKeysToDatabase();

    res.status(201).json({
      message: "API key validated, saved to database, and added to pool successfully",
      key: added,
      poolSummary: apiKeyPoolService.getSummary(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// DELETE /api/keys/:id - Remove a key
router.delete("/keys/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const removed = apiKeyPoolService.removeKey(id);
  if (!removed) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  await syncKeysToDatabase();
  res.json({ message: "Key removed from database and pool", poolSummary: apiKeyPoolService.getSummary() });
});

// PATCH /api/keys/:id/toggle - Enable/disable a key
router.patch("/keys/:id/toggle", (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const updated = apiKeyPoolService.toggleKey(id);
  if (!updated) {
    res.status(404).json({ error: "Key not found" });
    return;
  }
  res.json({ message: "Key toggled", key: updated, poolSummary: apiKeyPoolService.getSummary() });
});

// POST /api/keys/mode - Change rotation mode
router.post("/keys/mode", async (req: Request, res: Response) => {
  const { mode } = req.body;
  if (mode !== "round_robin" && mode !== "failover") {
    res.status(400).json({ error: "Invalid mode. Must be 'round_robin' or 'failover'" });
    return;
  }
  apiKeyPoolService.setRotationMode(mode);
  process.env.KEY_ROTATION_MODE = mode;
  try {
    await db
      .insert(systemSettingsTable)
      .values({ key: "KEY_ROTATION_MODE", value: mode, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: mode, updatedAt: new Date() },
      });
  } catch (e) {
    logger.warn({ error: String(e) }, "Failed to persist KEY_ROTATION_MODE to database");
  }

  res.json({ message: "Rotation mode updated and saved to database", rotationMode: mode });
});

// POST /api/keys/test - Test an arbitrary key or existing key
router.post("/keys/test", async (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "Missing required field 'key'" });
    return;
  }
  const result = await apiKeyPoolService.testRawKey(key);
  res.json(result);
});

// GET /api/stats - Global server metrics
router.get("/stats", (_req: Request, res: Response) => {
  const pool = apiKeyPoolService.getSummary();
  const config = getConfig();

  res.json({
    timestamp: new Date().toISOString(),
    geminiModel: config.geminiModel,
    telegramBotStatus: Boolean(config.telegramBotToken?.trim()) ? "active" : "pending_token",
    databaseStatus: Boolean(process.env.DATABASE_URL?.trim()) ? "connected" : "standalone",
    keyPool: pool,
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// POST /api/chat/test - Direct interactive test console with multi-key pool
router.post("/chat/test", async (req: Request, res: Response) => {
  try {
    const { message, personality, mode, enableSearch, userId } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing required 'message' field" });
      return;
    }

    const config = getConfig();
    const gemini = new GeminiService(apiKeyPoolService, config.geminiModel, config.geminiTimeoutMs);

    let memoryContext = "";
    if (userId) {
      try {
        const mems = await chatDatabaseService.getUserMemories(BigInt(userId));
        if (mems.length > 0) {
          memoryContext = mems.map((m) => `[${m.key}]: ${m.content}`).join("\n");
        }
      } catch (e) {
        logger.warn({ error: String(e) }, "Failed to fetch user memories for test chat");
      }
    }

    const start = Date.now();
    const reply = await gemini.generateReply(
      [],
      message,
      {
        personalityInstruction: personality ? `Personality: ${personality}` : undefined,
        modeInstruction: mode ? `Mode: ${mode}` : undefined,
        memoryInstruction: memoryContext || undefined,
      },
      { enableSearch: Boolean(enableSearch) },
    );
    const latencyMs = Date.now() - start;

    res.json({
      reply,
      latencyMs,
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
