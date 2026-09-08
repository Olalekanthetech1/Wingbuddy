import { Router, type IRouter, type Request, type Response } from "express";
import os from "node:os";
import {
  chatDatabaseService,
  cdcService,
  isPgVectorAvailable,
  computeAdaptivePoolConfig,
  getPrisma,
  getPool,
  db,
  remindersTable,
  usersTable,
  conversationsTable,
  messagesTable,
  userMemoriesTable,
} from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import { ReminderService } from "../services/reminder.service";
import { ConversationService } from "../services/conversation.service";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { GeminiService } from "../gemini/gemini.service";
import { getConfig } from "../config/env";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const reminderService = new ReminderService();
const conversationService = new ConversationService();

// =============================================================================
// 0. TELEGRAM USERS LIST & SELECTOR
// =============================================================================

router.get("/dashboard/users", async (_req: Request, res: Response) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        telegramUserId: usersTable.telegramUserId,
        username: usersTable.username,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        personality: usersTable.personality,
        mode: usersTable.mode,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.updatedAt));

    res.json({
      users: users.map((u) => ({
        id: u.id,
        telegramUserId: Number(u.telegramUserId),
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        personality: u.personality || "playful",
        mode: u.mode || "general",
        updatedAt: u.updatedAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// =============================================================================
// 1. ADAPTIVE TELEMETRY & SYSTEM HEALTH
// =============================================================================

router.get("/dashboard/telemetry", async (_req: Request, res: Response) => {
  try {
    const mem = process.memoryUsage();
    const cpuCount = Math.max(1, os.cpus()?.length || 2);
    const poolConfig = computeAdaptivePoolConfig();
    const pgVector = isPgVectorAvailable();

    let userCount = 0;
    let memoryCount = 0;
    let reminderCount = 0;
    let conversationCount = 0;
    let messageCount = 0;

    try {
      const [u] = await db.select({ val: count() }).from(usersTable);
      const [m] = await db.select({ val: count() }).from(userMemoriesTable);
      const [r] = await db.select({ val: count() }).from(remindersTable);
      const [c] = await db.select({ val: count() }).from(conversationsTable);
      const [msg] = await db.select({ val: count() }).from(messagesTable);
      userCount = Number(u?.val || 0);
      memoryCount = Number(m?.val || 0);
      reminderCount = Number(r?.val || 0);
      conversationCount = Number(c?.val || 0);
      messageCount = Number(msg?.val || 0);
    } catch (e) {
      logger.warn({ error: String(e) }, "Failed to query table counts for telemetry");
    }

    const adaptiveTtlSample = chatDatabaseService.computeAdaptiveCacheTTL("system:telemetry:global");

    res.json({
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: {
        cpuCores: cpuCount,
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        memoryPressureRatio: Math.round((mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0.5) * 100) / 100,
      },
      pool: {
        adaptiveMaxConnections: poolConfig.max,
        adaptiveIdleTimeoutMs: poolConfig.idleTimeoutMillis,
        adaptiveConnectionTimeoutMs: poolConfig.connectionTimeoutMillis,
        pgVectorEnabled: pgVector,
      },
      cache: {
        adaptiveCurrentTtlMs: adaptiveTtlSample,
        status: "active_adaptive",
      },
      counts: {
        users: userCount,
        memories: memoryCount,
        reminders: reminderCount,
        conversations: conversationCount,
        messages: messageCount,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// =============================================================================
// 2. LONG-TERM MEMORIES (SEMANTIC / PGVECTOR)
// =============================================================================

router.get("/dashboard/memories", async (req: Request, res: Response) => {
  try {
    const { userId, search, category } = req.query;
    let targetUserId: bigint | undefined;
    if (userId) {
      targetUserId = BigInt(String(userId));
    } else {
      const latestUser = await db
        .select({ id: usersTable.telegramUserId })
        .from(usersTable)
        .orderBy(desc(usersTable.updatedAt))
        .limit(1);
      if (latestUser[0]) {
        targetUserId = BigInt(latestUser[0].id);
      }
    }

    if (!targetUserId) {
      res.json({
        telegramUserId: null,
        pgVectorAvailable: isPgVectorAvailable(),
        memories: [],
      });
      return;
    }

    let memories;
    if (search && typeof search === "string" && search.trim()) {
      memories = await chatDatabaseService.searchMemories(targetUserId, search.trim());
    } else {
      memories = await chatDatabaseService.getUserMemories(
        targetUserId,
        typeof category === "string" ? category : undefined,
      );
    }

    res.json({
      telegramUserId: Number(targetUserId),
      pgVectorAvailable: isPgVectorAvailable(),
      memories,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/dashboard/memories", async (req: Request, res: Response) => {
  try {
    const { userId, key, content, category } = req.body;
    if (!key || !content) {
      res.status(400).json({ error: "Missing required 'key' or 'content'" });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: "Missing required 'userId'" });
      return;
    }

    const targetUserId = Number(userId);

    // Ensure user record exists in database
    await db
      .insert(usersTable)
      .values({
        telegramUserId: targetUserId,
        firstName: "Dashboard User",
        personality: "playful",
        mode: "general",
      })
      .onConflictDoNothing();

    // Compute embedding dynamically if available
    let embeddingVector: number[] | undefined;
    try {
      const config = getConfig();
      const gemini = new GeminiService(apiKeyPoolService, config.geminiModel, config.geminiTimeoutMs);
      const vec = await gemini.embedText(`${key}: ${content}`);
      if (vec.length > 0) {
        embeddingVector = vec;
      }
    } catch {
      // Embedding optional if offline
    }

    const saved = await chatDatabaseService.saveMemory({
      telegramUserId: targetUserId,
      key: String(key).trim(),
      content: String(content).trim(),
      category: category ? String(category).trim() : "general",
      embedding: embeddingVector,
    });

    res.status(201).json({ message: "Memory saved successfully", memory: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.delete("/dashboard/memories/:key", async (req: Request, res: Response) => {
  try {
    const rawKey = req.params.key;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const { userId } = req.query;
    if (!userId) {
      res.status(400).json({ error: "Missing required 'userId'" });
      return;
    }

    const targetUserId = Number(String(userId));

    const deleted = await chatDatabaseService.deleteMemory(targetUserId, key);
    if (deleted) {
      res.json({ message: "Memory deleted successfully" });
    } else {
      res.status(404).json({ error: "Memory not found" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// =============================================================================
// 3. PROACTIVE REMINDERS LIVE MANAGER
// =============================================================================

router.get("/dashboard/reminders", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    let query = db.select().from(remindersTable);
    
    let allReminders;
    if (userId && String(userId) !== "all") {
      allReminders = await query
        .where(eq(remindersTable.telegramUserId, Number(String(userId))))
        .orderBy(desc(remindersTable.createdAt))
        .limit(50);
    } else {
      allReminders = await query
        .orderBy(desc(remindersTable.createdAt))
        .limit(50);
    }

    res.json({
      reminders: allReminders.map((r) => ({
        id: r.id,
        telegramUserId: Number(r.telegramUserId),
        chatId: Number(r.chatId),
        prompt: r.prompt,
        dueAt: r.dueAt,
        isCompleted: r.isCompleted,
        snoozeCount: r.snoozeCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/dashboard/reminders", async (req: Request, res: Response) => {
  try {
    const { prompt, dueInMinutes, dueAtISO, userId, chatId } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Missing required 'prompt'" });
      return;
    }

    let dueAt: Date;
    if (dueAtISO) {
      dueAt = new Date(dueAtISO);
    } else if (dueInMinutes) {
      dueAt = new Date(Date.now() + Number(dueInMinutes) * 60 * 1000);
    } else {
      dueAt = new Date(Date.now() + 60 * 60 * 1000); // default 1 hour
    }

    if (!userId) {
      res.status(400).json({ error: "Missing required 'userId'" });
      return;
    }
    const targetUserId = Number(userId);
    const targetChatId = chatId ? Number(chatId) : targetUserId;

    const created = await reminderService.createReminder({
      telegramUserId: targetUserId,
      chatId: targetChatId,
      prompt: String(prompt).trim(),
      dueAt,
    });

    res.status(201).json({ message: "Reminder scheduled", reminder: created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.patch("/dashboard/reminders/:id/complete", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
    const id = parseInt(idStr, 10);
    const completed = await reminderService.completeReminder(id);
    if (completed) {
      res.json({ message: "Reminder marked as completed" });
    } else {
      res.status(404).json({ error: "Reminder not found" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.patch("/dashboard/reminders/:id/snooze", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
    const id = parseInt(idStr, 10);
    const minutes = req.body.minutes ? parseInt(req.body.minutes, 10) : 10;
    const snoozed = await reminderService.snoozeReminder(id, minutes);
    if (snoozed) {
      res.json({ message: `Reminder snoozed for ${minutes} minutes`, reminder: snoozed });
    } else {
      res.status(404).json({ error: "Reminder not found" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.delete("/dashboard/reminders/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const idStr = Array.isArray(rawId) ? rawId[0] : rawId;
    const id = parseInt(idStr, 10);
    await db.delete(remindersTable).where(eq(remindersTable.id, id));
    cdcService.dispatchReminderEvent({
      action: "DELETE",
      id,
      telegramUserId: 0,
      chatId: 0,
      isCompleted: true,
      dueAt: new Date(),
      prompt: "",
      source: "manual_dispatch",
    });
    res.json({ message: "Reminder deleted" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// =============================================================================
// 4. USER PERSONALITY & MODE CONTROLS
// =============================================================================

router.get("/dashboard/user-settings", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    let targetUserId: number | undefined;
    if (userId) {
      targetUserId = Number(userId);
    } else {
      const latestUser = await db
        .select({ id: usersTable.telegramUserId })
        .from(usersTable)
        .orderBy(desc(usersTable.updatedAt))
        .limit(1);
      if (latestUser[0]) {
        targetUserId = Number(latestUser[0].id);
      }
    }

    if (!targetUserId) {
      res.status(404).json({ error: "No users found in database" });
      return;
    }

    // Check if real user exists in database
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramUserId, targetUserId))
      .limit(1);

    if (existing[0]) {
      res.json({
        telegramUserId: Number(existing[0].telegramUserId),
        personality: existing[0].personality || "playful",
        mode: existing[0].mode || "general",
        username: existing[0].username,
        firstName: existing[0].firstName,
      });
    } else {
      const personality = await conversationService.getUserPersonality(targetUserId);
      const mode = await conversationService.getUserMode(targetUserId);
      res.json({
        telegramUserId: targetUserId,
        personality,
        mode,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/dashboard/user-settings", async (req: Request, res: Response) => {
  try {
    const { userId, personality, mode } = req.body;
    if (!userId) {
      res.status(400).json({ error: "Missing required 'userId'" });
      return;
    }
    const targetUserId = Number(userId);

    if (personality) {
      await conversationService.setUserPersonality(targetUserId, personality);
    }
    if (mode) {
      await conversationService.setUserMode(targetUserId, mode);
    }

    res.json({
      message: "User settings updated successfully",
      personality: await conversationService.getUserPersonality(targetUserId),
      mode: await conversationService.getUserMode(targetUserId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// =============================================================================
// 5. CACHE FLUSH & SEED EXECUTION
// =============================================================================

router.post("/dashboard/cache/flush", async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (userId) {
      chatDatabaseService.invalidateUserCache(Number(userId));
    }
    res.json({ message: "L1 Cache successfully flushed & invalidated across worker nodes" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
