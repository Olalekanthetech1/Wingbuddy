import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { webChatService } from "../services/web-chat.service";
import { memoryService } from "../services/memory.service";
import { taskService } from "../services/task.service";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { unifiedModelRegistryService } from "../services/unified-model-registry.service";
import { healthMonitorService } from "../services/health-monitor.service";
import { telegramIdentityService } from "../services/telegram-identity.service";
import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { getDisplayName, getGreeting, userIdentityResolverService } from "../services/user-identity-resolver.service";
import multer from "multer";
import { chatImportService } from "../services/chat-import.service";
import { semanticSearchService } from "../services/semantic-search.service";

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for now
});
router.use(requireAuth);
router.use(async (req: Request, _res: Response, next) => {
  if (req.user) {
    try {
      await webChatService.ensurePartitionUser(req.user);
    } catch (err) {
      logger.warn({ error: err }, "Failed to auto-ensure partition user");
    }
  }
  next();
});

/**
 * GET /api/user/overview
 * Zero-fallback authoritative user dashboard overview DTO.
 * Strict DTO allowlist: No internal keys, partition IDs, or key pool matrices exposed.
 */
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();

    const [tasksRes, memoriesRes, remindersRes, msgCountRes, userRecordRes, recentTasksRes, recentMemoriesRes, tzRes] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE status IN ('active', 'in_progress', 'pending', 'waiting'))::int as active
        FROM agent_tasks 
        WHERE telegram_user_id = $1
      `, [partitionId]),
      pool.query(`
        SELECT COUNT(*)::int as count 
        FROM user_memories 
        WHERE telegram_user_id = $1 AND status != 'deleted'
      `, [partitionId]),
      pool.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE is_completed = FALSE)::int as pending
        FROM reminders 
        WHERE telegram_user_id = $1
      `, [partitionId]),
      pool.query(`
        SELECT COUNT(*)::int as count 
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.telegram_user_id = $1
      `, [partitionId]),
      pool.query(`
        SELECT tier, daily_quota, requests_today, status 
        FROM users 
        WHERE telegram_user_id = $1
      `, [partitionId]),
      pool.query(`
        SELECT id, title, goal, status, created_at as "createdAt"
        FROM agent_tasks
        WHERE telegram_user_id = $1
        ORDER BY created_at DESC
        LIMIT 3
      `, [partitionId]),
      pool.query(`
        SELECT id, key, content, category, created_at as "createdAt"
        FROM user_memories
        WHERE telegram_user_id = $1 AND status != 'deleted'
        ORDER BY created_at DESC
        LIMIT 3
      `, [partitionId]),
      pool.query(`
        SELECT content FROM user_memories 
        WHERE telegram_user_id = $1 AND key = 'user_timezone' AND status != 'deleted'
        LIMIT 1
      `, [partitionId]),
    ]);

    const health = healthMonitorService.evaluateHealth();
    const botUsername = telegramIdentityService.getBotUsername();
    const isBotConfigured = telegramIdentityService.isConfigured();

    const userTimezone = tzRes.rows[0]?.content || "UTC";

    const userRecord = userRecordRes.rows[0];
    const isUnlimited = Boolean(
      userRecord?.daily_quota === null || 
      userRecord?.daily_quota === -1 || 
      userRecord?.tier === "vip" || 
      userRecord?.tier === "unlimited"
    );

    const taskCount = tasksRes.rows[0]?.total || 0;
    const activeTasks = tasksRes.rows[0]?.active || 0;
    const completedTasks = tasksRes.rows[0]?.completed || 0;
    const memoryCount = memoriesRes.rows[0]?.count || 0;
    const reminderCount = remindersRes.rows[0]?.total || 0;
    const pendingReminders = remindersRes.rows[0]?.pending || 0;
    const messageCount = msgCountRes.rows[0]?.count || 0;

    // Context-adaptive quick prompts based on live data state
    const quickPrompts = [
      taskCount > 0
        ? { id: "check_tasks", label: "Check Scheduled Tasks", prompt: "Summarize all active scheduled tasks and their execution status", icon: "⚡" }
        : { id: "create_task", label: "Create Automated Task", prompt: "Help me create an automated recurring strategic briefing task", icon: "⚡" },
      memoryCount > 0
        ? { id: "review_memories", label: "Review Memory Vault", prompt: "Review and summarize the key facts you remember about me in my Memory Vault", icon: "🧠" }
        : { id: "teach_facts", label: "Teach Assistant Facts", prompt: "Here are some facts and background about me you should remember for future tasks: ", icon: "🧠" },
      reminderCount > 0
        ? { id: "check_reminders", label: "Check Reminders", prompt: "What reminders and upcoming alarms do I have scheduled?", icon: "⏰" }
        : { id: "create_reminder", label: "Set a Reminder", prompt: "Set a reminder for me in 30 minutes to review my daily tasks", icon: "⏰" },
      { id: "daily_digest", label: "Send Today's Digest", prompt: "Generate and send my daily morning digest now", icon: "🌅" },
    ];

    // Resolve user display name through central userIdentityResolverService
    const fullUserIdentity = {
      preferredName: user.preferredName,
      nameSource: user.nameSource,
      givenName: user.givenName,
      googleName: user.name,
      email: user.email,
      timezone: userTimezone,
    };
    const resolvedDisplayName = getDisplayName(fullUserIdentity);
    const greetingInfo = getGreeting(fullUserIdentity);

    // Strict DTO - no internal infrastructure fields
    const overviewDto = {
      user: {
        id: user.id,
        email: user.email,
        displayName: resolvedDisplayName,
        preferredName: user.preferredName || null,
        nameSource: user.nameSource || null,
        fullName: user.fullName || null,
        greeting: greetingInfo.greeting,
        hasName: greetingInfo.hasName,
        promptQuestion: greetingInfo.promptQuestion || null,
        picture: user.picture || null,
        role: user.role || "user",
        timezone: userTimezone,
        themePreference: user.themePreference || "system",
      },
      assistant: {
        status: health.status,
        statusLabel: health.statusLabel,
        details: health.details,
      },
      telegram: {
        isConfigured: isBotConfigured,
        isPaired: Boolean(user.telegramUserId),
        telegramUsername: user.telegramUsername || null,
        botUsername: botUsername,
      },
      metrics: {
        memories: {
          count: memoryCount,
        },
        tasks: {
          total: taskCount,
          active: activeTasks,
          completed: completedTasks,
        },
        reminders: {
          total: reminderCount,
          pending: pendingReminders,
        },
        messages: {
          total: messageCount,
        },
        quota: userRecord ? {
          tier: userRecord.tier || "Standard",
          isUnlimited,
          limit: isUnlimited ? null : (userRecord.daily_quota || 50),
          requestsToday: userRecord.requests_today || 0,
          remaining: isUnlimited ? null : Math.max(0, (userRecord.daily_quota || 50) - (userRecord.requests_today || 0)),
          resetLabel: `Resets daily at 00:00 (${userTimezone})`,
          timezone: userTimezone,
        } : null,
      },
      recentTasks: recentTasksRes.rows || [],
      recentMemories: recentMemoriesRes.rows || [],
      quickPrompts,
      updatedAt: new Date().toISOString(),
    };

    const safeOverviewDto = JSON.parse(JSON.stringify(overviewDto, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));

    res.json(safeOverviewDto);
  } catch (err: any) {
    logger.error({ error: err }, "Failed fetching user overview");
    res.status(500).json({ error: err.message || "Failed fetching overview" });
  }
});

/**
 * POST /api/user/profile
 * Updates user preferred_name, full_name, timezone, or themePreference.
 */
router.post("/profile", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { preferredName, fullName, timezone, themePreference } = req.body || {};
    const partitionId = webChatService.getPartitionUserId(user);

    let updatedName: string | null = null;

    if (preferredName !== undefined) {
      if (preferredName === "" || preferredName === null) {
        const pool = getPool();
        await pool.query(`UPDATE web_users SET preferred_name = NULL, name_source = NULL WHERE id = $1`, [user.id]);
        await pool.query(`UPDATE users SET preferred_name = NULL, name_source = NULL WHERE telegram_user_id = $1`, [partitionId]);
      } else {
        const nameRes = await userIdentityResolverService.updatePreferredName(user.id, String(preferredName), "user", true);
        if (!nameRes.success) {
          res.status(400).json({ error: nameRes.error || "Invalid preferred name" });
          return;
        }
        updatedName = nameRes.preferredName;
      }
    }

    if (fullName !== undefined) {
      const pool = getPool();
      await pool.query(`UPDATE web_users SET full_name = $1 WHERE id = $2`, [fullName || null, user.id]);
      await pool.query(`UPDATE users SET full_name = $1 WHERE telegram_user_id = $2`, [fullName || null, partitionId]);
    }

    if (timezone && typeof timezone === "string") {
      await memoryService.saveMemory(partitionId, "user_timezone", timezone, "preference");
    }

    if (themePreference && ["light", "dark", "system"].includes(themePreference)) {
      const pool = getPool();
      await pool.query(`UPDATE web_users SET theme_preference = $1 WHERE id = $2`, [themePreference, user.id]);
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      preferredName: updatedName,
    });
  } catch (err: any) {
    logger.error({ error: err }, "Failed updating user profile");
    res.status(500).json({ error: err.message || "Failed updating user profile" });
  }
});

/**
 * GET /api/user/chat/conversations
 */
router.get("/chat/conversations", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const conversations = await webChatService.listConversations(user);
    res.json({ conversations });
  } catch (err: any) {
    logger.error({ error: err }, "Failed listing user conversations");
    res.status(500).json({ error: err.message || "Failed listing conversations" });
  }
});

/**
 * POST /api/user/chat/conversations
 */
router.post("/chat/conversations", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { title } = req.body || {};
    const conversation = await webChatService.createConversation(user, title);
    res.json({ conversation });
  } catch (err: any) {
    logger.error({ error: err }, "Failed creating conversation");
    res.status(500).json({ error: err.message || "Failed creating conversation" });
  }
});

/**
 * DELETE /api/user/chat/conversations/:id
 */
router.delete("/chat/conversations/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const conversationId = parseInt(req.params.id, 10);
    if (isNaN(conversationId)) {
      res.status(400).json({ error: "Invalid conversation ID" });
      return;
    }
    const result = await webChatService.deleteConversation(user, conversationId);
    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Failed deleting conversation");
    res.status(500).json({ error: err.message || "Failed deleting conversation" });
  }
});

/**
 * GET /api/user/chat/messages
 */
router.get("/chat/messages", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const limit = parseInt((req.query.limit as string) || "100", 10);
    const conversationId = req.query.conversationId ? parseInt(req.query.conversationId as string, 10) : undefined;
    const { messages, conversationId: resolvedConvId } = await webChatService.getMessages(user, limit, conversationId);
    res.json({ messages, conversationId: resolvedConvId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed fetching messages" });
  }
});

/**
 * POST /api/user/chat/send
 */
router.post("/chat/send", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { content, mode, model, clientMsgId, conversationId } = req.body;
    if (!content || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const parsedConvId = conversationId ? parseInt(String(conversationId), 10) : undefined;

    const result = await webChatService.sendMessage(user, content.trim(), {
      mode,
      modelOverride: model,
      clientMsgId: typeof clientMsgId === "string" ? clientMsgId : undefined,
      conversationId: parsedConvId,
    });
    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Error in user chat send");
    res.status(500).json({ error: err.message || "Failed sending message" });
  }
});

/**
 * POST /api/user/chat/stream
 */
router.post("/chat/stream", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { content, mode, model, clientMsgId, conversationId } = req.body;
    if (!content || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "Content is required" });
      return;
    }

    const parsedConvId = conversationId ? parseInt(String(conversationId), 10) : undefined;

    await webChatService.streamMessage(user, content.trim(), res, req, {
      mode,
      modelOverride: model,
      clientMsgId: typeof clientMsgId === "string" ? clientMsgId : undefined,
      conversationId: parsedConvId,
    });
  } catch (err: any) {
    logger.error({ error: err }, "Error in user chat stream route");
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Failed starting stream" });
    }
  }
});

/**
 * POST /api/user/chat/stop
 */
router.post("/chat/stop", async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.body;
    const parsedConvId = conversationId ? parseInt(String(conversationId), 10) : undefined;
    if (!parsedConvId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }
    const stopped = webChatService.stopStream(parsedConvId);
    res.json({ success: stopped });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed stopping stream" });
  }
});

/**
 * DELETE /api/user/chat/clear
 */
router.delete("/chat/clear", async (req: Request, res: Response) => {
  try {
    const conversationId = req.query.conversationId ? parseInt(req.query.conversationId as string, 10) : undefined;
    await webChatService.clearMessages(req.user!, conversationId);
    res.json({ success: true, message: "Chat conversation cleared" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed clearing chat" });
  }
});

/**
 * GET /api/user/tasks
 */
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();

    const query = `
      SELECT t.*,
        (SELECT json_agg(s ORDER BY s.step_order) FROM agent_task_steps s WHERE s.task_id = t.id) as steps
      FROM agent_tasks t
      WHERE t.telegram_user_id = $1
      ORDER BY t.created_at DESC;
    `;
    const resTasks = await pool.query(query, [partitionId]);
    res.json({ tasks: resTasks.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed fetching tasks" });
  }
});

/**
 * POST /api/user/tasks
 */
router.post("/tasks", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { title, goal, taskType, deadlineAt } = req.body;

    if (!title || !goal) {
      res.status(400).json({ error: "Title and goal are required" });
      return;
    }

    const pool = getPool();
    const insertRes = await pool.query(
      `INSERT INTO agent_tasks (telegram_user_id, title, goal, task_type, status, deadline_at)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING *`,
      [partitionId, title.trim(), goal.trim(), taskType || "general", deadlineAt ? new Date(deadlineAt) : null]
    );

    res.status(201).json({ task: insertRes.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed creating task" });
  }
});

/**
 * POST /api/user/tasks/stop-all
 * Stops/cancels all active or pending tasks for the authenticated user
 */
router.post("/tasks/stop-all", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();

    // 1. Identify all active/pending/in_progress tasks
    const activeTasksRes = await pool.query(
      `SELECT id, title FROM agent_tasks 
       WHERE telegram_user_id = $1 AND status IN ('active', 'pending', 'in_progress', 'waiting')`,
      [partitionId]
    );

    if (activeTasksRes.rows.length === 0) {
      res.json({ success: true, count: 0, message: "No active tasks to stop." });
      return;
    }

    const taskIds = activeTasksRes.rows.map((r: { id: number }) => r.id);

    // 2. Mark active tasks as cancelled
    await pool.query(
      `UPDATE agent_tasks 
       SET status = 'cancelled', updated_at = NOW(), completed_at = NOW() 
       WHERE id = ANY($1::int[]) AND telegram_user_id = $2`,
      [taskIds, partitionId]
    );

    // 3. Mark uncompleted steps as cancelled
    await pool.query(
      `UPDATE agent_task_steps 
       SET status = 'cancelled', updated_at = NOW() 
       WHERE task_id = ANY($1::int[]) AND status != 'completed'`,
      [taskIds]
    );

    res.json({
      success: true,
      count: taskIds.length,
      message: `Stopped ${taskIds.length} active task${taskIds.length === 1 ? "" : "s"}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed stopping tasks" });
  }
});

/**
 * DELETE /api/user/tasks/clear-all
 * Permanently deletes all tasks and cascaded steps for the authenticated user
 */
router.delete("/tasks/clear-all", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();

    const deleteRes = await pool.query(
      `DELETE FROM agent_tasks WHERE telegram_user_id = $1 RETURNING id`,
      [partitionId]
    );

    const clearedCount = deleteRes.rowCount || 0;
    res.json({
      success: true,
      count: clearedCount,
      message: `Cleared ${clearedCount} task${clearedCount === 1 ? "" : "s"}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed clearing tasks" });
  }
});

/**
 * POST /api/user/tasks/:id/stop
 * Stops/cancels an individual task
 */
router.post("/tasks/:id/stop", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const taskId = parseInt(req.params.id, 10);
    const pool = getPool();

    const taskCheck = await pool.query(
      `SELECT * FROM agent_tasks WHERE id = $1 AND telegram_user_id = $2`,
      [taskId, partitionId]
    );
    if (taskCheck.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const task = taskCheck.rows[0];
    await pool.query(
      `UPDATE agent_tasks SET status = 'cancelled', updated_at = NOW(), completed_at = NOW() WHERE id = $1`,
      [taskId]
    );
    await pool.query(
      `UPDATE agent_task_steps SET status = 'cancelled', updated_at = NOW() WHERE task_id = $1 AND status != 'completed'`,
      [taskId]
    );

    res.json({ success: true, message: `Task "${task.title}" stopped`, taskId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed stopping task" });
  }
});

/**
 * DELETE /api/user/tasks/:id
 * Permanently deletes an individual task and its execution steps
 */
router.delete("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const taskId = parseInt(req.params.id, 10);
    const pool = getPool();

    const deleteRes = await pool.query(
      `DELETE FROM agent_tasks WHERE id = $1 AND telegram_user_id = $2 RETURNING id, title`,
      [taskId, partitionId]
    );

    if (deleteRes.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json({
      success: true,
      message: `Task "${deleteRes.rows[0].title}" deleted successfully`,
      taskId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed deleting task" });
  }
});

/**
 * POST /api/user/tasks/:id/run
 */
router.post("/tasks/:id/run", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const taskId = parseInt(req.params.id, 10);
    const pool = getPool();

    const taskCheck = await pool.query(`SELECT * FROM agent_tasks WHERE id = $1 AND telegram_user_id = $2`, [taskId, partitionId]);
    if (taskCheck.rows.length === 0) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const task = taskCheck.rows[0];
    await pool.query(`UPDATE agent_tasks SET status = 'active', updated_at = NOW() WHERE id = $1`, [taskId]);
    res.json({ success: true, message: `Task "${task.title}" triggered`, task });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed triggering task execution" });
  }
});

/**
 * GET /api/user/memories
 */
router.get("/memories", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    logger.debug({ partitionId, userId: user.id }, "Fetching user memories");
    
    const memories = await memoryService.getUserMemories(partitionId);
    
    // Defensive BigInt serialization for Express
    const safeMemories = JSON.parse(JSON.stringify(memories, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
    
    res.json({ memories: safeMemories });
  } catch (err: any) {
    logger.error({ 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      user: req.user?.id,
      path: req.path
    }, "CRITICAL_ROUTE_ERROR: Failed fetching user memories");
    res.status(500).json({ error: err.message || "Failed fetching memories" });
  }
});

/**
 * POST /api/user/memories
 */
router.post("/memories", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { key, content, category, importance } = req.body;

    if (!key || !content) {
      res.status(400).json({ error: "Key and content are required" });
      return;
    }

    const memory = await memoryService.saveUserMemory(partitionId, key.trim(), content.trim(), category || "general", importance || "medium");
    res.status(201).json({ memory });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed creating memory" });
  }
});

/**
 * DELETE /api/user/memories/clear-all
 * Purges all user memories for the authenticated user
 */
router.delete("/memories/clear-all", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();

    const deleteRes = await pool.query(
      `DELETE FROM user_memories WHERE telegram_user_id = $1 RETURNING id`,
      [partitionId]
    );

    const clearedCount = deleteRes.rowCount || 0;
    res.json({
      success: true,
      count: clearedCount,
      message: `Permanently cleared ${clearedCount} memor${clearedCount === 1 ? "y" : "ies"}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed clearing memories" });
  }
});

/**
 * POST /api/user/memories/batch-delete
 * Deletes multiple selected memories by their keys or IDs
 */
router.post("/memories/batch-delete", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { keys, ids } = req.body;
    const pool = getPool();

    if ((!keys || !Array.isArray(keys) || keys.length === 0) &&
        (!ids || !Array.isArray(ids) || ids.length === 0)) {
      res.status(400).json({ error: "No keys or IDs provided for batch deletion" });
      return;
    }

    let deleteRes;
    if (ids && ids.length > 0) {
      deleteRes = await pool.query(
        `DELETE FROM user_memories WHERE telegram_user_id = $1 AND id = ANY($2::int[]) RETURNING id`,
        [partitionId, ids]
      );
    } else {
      deleteRes = await pool.query(
        `DELETE FROM user_memories WHERE telegram_user_id = $1 AND key = ANY($2::text[]) RETURNING id`,
        [partitionId, keys]
      );
    }

    const count = deleteRes.rowCount || 0;
    res.json({
      success: true,
      count,
      message: `Deleted ${count} memor${count === 1 ? "y" : "ies"}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed deleting selected memories" });
  }
});

/**
 * DELETE /api/user/memories/:key
 */
router.delete("/memories/:key", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const key = decodeURIComponent(req.params.key);
    await memoryService.deleteUserMemory(partitionId, key);
    res.json({ success: true, message: "Memory removed" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed deleting memory" });
  }
});

/**
 * POST /api/user/memories/import/preview
 */
router.post("/memories/import/preview", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { text } = req.body;
    if (!text || text.length < 10) {
      res.status(400).json({ error: "Provide a valid memory block for extraction" });
      return;
    }
    const candidates = await memoryService.extractImportCandidates(partitionId, text);
    res.json({ candidates });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Extraction failed" });
  }
});

/**
 * POST /api/user/memories/import/confirm
 */
router.post("/memories/import/confirm", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { items, source } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items to import" });
      return;
    }
    const result = await memoryService.commitImportedMemories(partitionId, items, source || "pasted_text");
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Import failed" });
  }
});

/**
 * POST /api/user/conversations/import/upload
 * Handles multi-platform ZIP chat history exports.
 */
router.post("/conversations/import/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const source = req.body.source || "chatgpt";
    
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const batchId = await chatImportService.processZipImport(partitionId, req.file.buffer, source as any);
    res.json({ batchId, message: "Import processing started in background" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

/**
 * GET /api/user/conversations/import/:batchId/progress
 */
router.get("/conversations/import/:batchId/progress", (req: Request, res: Response) => {
  try {
    const batchId = req.params.batchId;
    const progress = chatImportService.getImportProgress(batchId);
    if (!progress) {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed fetching progress" });
  }
});

/**
 * POST /api/user/conversations/:id/index
 * Triggers background indexing for semantic search.
 */
router.post("/conversations/:id/index", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const conversationId = parseInt(req.params.id, 10);
    
    // Security check: ensure user owns the conversation
    const pool = getPool();
    const checkRes = await pool.query("SELECT id FROM conversations WHERE id = $1 AND telegram_user_id = $2", [conversationId, partitionId]);
    if (checkRes.rows.length === 0) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const jobId = await semanticSearchService.indexConversation(conversationId);
    res.json({ jobId, message: "Indexing started" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Indexing failed" });
  }
});

/**
 * GET /api/user/conversations/index/:jobId/progress
 */
router.get("/conversations/index/:jobId/progress", (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const progress = semanticSearchService.getIndexingProgress(jobId);
    if (!progress) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed fetching progress" });
  }
});

/**
 * GET /api/user/reminders
 */
router.get("/reminders", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const pool = getPool();
    const query = `
      SELECT * FROM reminders
      WHERE telegram_user_id = $1
      ORDER BY due_at ASC;
    `;
    const remindersRes = await pool.query(query, [partitionId]);
    res.json({ reminders: remindersRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed fetching reminders" });
  }
});

/**
 * POST /api/user/reminders
 */
router.post("/reminders", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { prompt, dueAt } = req.body;

    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: "Reminder text is required" });
      return;
    }

    const dueDate = dueAt ? new Date(dueAt) : new Date(Date.now() + 60 * 60 * 1000);
    const pool = getPool();
    const insertRes = await pool.query(
      `INSERT INTO reminders (telegram_user_id, chat_id, prompt, due_at, is_completed)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING *`,
      [partitionId, partitionId, prompt.trim(), dueDate]
    );

    res.status(201).json({ reminder: insertRes.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed creating reminder" });
  }
});

/**
 * POST /api/user/reminders/:id/snooze
 */
router.post("/reminders/:id/snooze", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const reminderId = parseInt(req.params.id, 10);
    const minutes = parseInt(req.body.minutes || "60", 10);
    const pool = getPool();

    const newDue = new Date(Date.now() + minutes * 60 * 1000);
    const result = await pool.query(
      `UPDATE reminders
       SET due_at = $1, is_completed = FALSE, reminder_fired = FALSE, updated_at = NOW()
       WHERE id = $2 AND telegram_user_id = $3
       RETURNING *`,
      [newDue, reminderId, partitionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }

    res.json({ reminder: result.rows[0], message: `Reminder snoozed for ${minutes} minutes.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed snoozing reminder" });
  }
});

/**
 * POST /api/user/reminders/:id/complete
 */
router.post("/reminders/:id/complete", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const reminderId = parseInt(req.params.id, 10);
    const pool = getPool();

    const result = await pool.query(
      `UPDATE reminders
       SET is_completed = TRUE, reminder_fired = TRUE, updated_at = NOW()
       WHERE id = $1 AND telegram_user_id = $2
       RETURNING *`,
      [reminderId, partitionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Reminder not found" });
      return;
    }

    res.json({ reminder: result.rows[0], message: "Reminder marked as completed." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed completing reminder" });
  }
});

export default router;
