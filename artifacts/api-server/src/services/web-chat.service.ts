import { getPool } from "@workspace/db";
import { ConversationService } from "./conversation.service";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import { eventBusService } from "./event-bus.service";
import { telegramRuntime } from "../app";
import { logger } from "../lib/logger";
import { memoryService } from "./memory.service";
import { personaService } from "./persona.service";
import { userTierService } from "./user-tier.service";
import { unifiedModelRegistryService } from "./unified-model-registry.service";
import type { AuthenticatedUser } from "./auth.service";
import { buildUserPromptIdentityBlock, userIdentityResolverService } from "./user-identity-resolver.service";

const conversationService = new ConversationService();

export interface ConversationSummary {
  id: number;
  chatId: number;
  title: string;
  summary?: string;
  isActive: boolean;
  messageCount: number;
  lastMessageSnippet?: string;
  createdAt: string;
  updatedAt: string;
}

export class WebChatService {
  /**
   * Resolves the primary ID used for partitioning database tables.
   */
  public getPartitionUserId(user: AuthenticatedUser): number {
    return user.telegramUserId || 9000000000 + user.id;
  }

  /**
   * Ensures the partition user exists in the authoritative users table to satisfy foreign keys.
   */
  public async ensurePartitionUser(user: AuthenticatedUser): Promise<number> {
    const partitionId = this.getPartitionUserId(user);
    const pool = getPool();
    const isAdmin = user.role === "admin" || String(user.email).toLowerCase().includes("olalekan");
    const tier = isAdmin ? "vip" : "free";
    const quota = isAdmin ? 999999 : 50;

    const prefName = user.preferredName || user.givenName || user.name || null;
    const nameSource = user.nameSource || (prefName ? "google" : null);

    await pool.query(
      `INSERT INTO users (telegram_user_id, username, preferred_name, name_source, tier, daily_quota, requests_today, last_request_date, total_requests, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, '', 0, 'active', NOW())
       ON CONFLICT (telegram_user_id) DO UPDATE SET
         preferred_name = CASE
           WHEN users.name_source = 'user' AND users.preferred_name IS NOT NULL THEN users.preferred_name
           ELSE COALESCE(EXCLUDED.preferred_name, users.preferred_name)
         END,
         name_source = CASE
           WHEN users.name_source = 'user' THEN 'user'
           ELSE COALESCE(EXCLUDED.name_source, users.name_source)
         END,
         tier = CASE WHEN EXCLUDED.tier = 'vip' THEN 'vip' ELSE users.tier END,
         daily_quota = CASE WHEN EXCLUDED.tier = 'vip' THEN 999999 ELSE users.daily_quota END,
         status = 'active',
         updated_at = NOW();`,
      [partitionId, user.telegramUsername || null, prefName, nameSource, tier, quota]
    );

    return partitionId;
  }

  /**
   * Lists all conversations belonging to the authenticated user with metadata.
   */
  public async listConversations(user: AuthenticatedUser): Promise<ConversationSummary[]> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    const query = `
      SELECT 
        c.id, 
        c.chat_id, 
        COALESCE(c.title, 'New Chat') as title, 
        c.summary, 
        c.is_active, 
        c.created_at, 
        c.updated_at,
        COUNT(m.id)::int as message_count,
        (
          SELECT content 
          FROM messages m2 
          WHERE m2.conversation_id = c.id 
          ORDER BY m2.created_at DESC 
          LIMIT 1
        ) as last_message_snippet
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.telegram_user_id = $1
      GROUP BY c.id, c.chat_id, c.title, c.summary, c.is_active, c.created_at, c.updated_at
      ORDER BY c.updated_at DESC;
    `;

    const res = await pool.query(query, [partitionId]);

    // If no conversation exists yet, automatically create initial one
    if (res.rows.length === 0) {
      const newConv = await this.createConversation(user, "New Chat");
      return [{
        id: newConv.id,
        chatId: newConv.chatId,
        title: newConv.title,
        summary: undefined,
        isActive: true,
        messageCount: 0,
        lastMessageSnippet: undefined,
        createdAt: newConv.createdAt,
        updatedAt: newConv.updatedAt,
      }];
    }

    return res.rows.map((r) => ({
      id: r.id,
      chatId: Number(r.chat_id),
      title: r.title || "New Chat",
      summary: r.summary || undefined,
      isActive: Boolean(r.is_active),
      messageCount: Number(r.message_count || 0),
      lastMessageSnippet: r.last_message_snippet ? String(r.last_message_snippet).slice(0, 80) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Creates a new conversation thread for the authenticated user.
   */
  public async createConversation(user: AuthenticatedUser, title?: string): Promise<{ id: number; chatId: number; title: string; createdAt: string; updatedAt: string }> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    // Generate a unique chatId for web thread
    const newChatId = Date.now() + Math.floor(Math.random() * 1000);
    const chatTitle = (title && title.trim()) ? title.trim() : "New Chat";

    const insertQuery = `
      INSERT INTO conversations (telegram_user_id, chat_id, title, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      RETURNING id, chat_id, title, created_at, updated_at;
    `;

    const res = await pool.query(insertQuery, [partitionId, newChatId, chatTitle]);
    const row = res.rows[0];

    return {
      id: row.id,
      chatId: Number(row.chat_id),
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Deletes a specific conversation thread and all associated messages.
   */
  public async deleteConversation(user: AuthenticatedUser, conversationId: number): Promise<{ success: boolean; activeConversationId: number }> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    // Verify ownership
    const verifyRes = await pool.query(
      `SELECT id FROM conversations WHERE id = $1 AND telegram_user_id = $2;`,
      [conversationId, partitionId]
    );

    if (verifyRes.rows.length === 0) {
      throw new Error("Conversation not found or unauthorized");
    }

    // Delete messages cascade & conversation
    await pool.query(`DELETE FROM messages WHERE conversation_id = $1;`, [conversationId]);
    await pool.query(`DELETE FROM conversations WHERE id = $1;`, [conversationId]);

    // Check remaining conversations
    const remaining = await pool.query(
      `SELECT id FROM conversations WHERE telegram_user_id = $1 ORDER BY updated_at DESC LIMIT 1;`,
      [partitionId]
    );

    let activeId: number;
    if (remaining.rows.length > 0) {
      activeId = remaining.rows[0].id;
    } else {
      const fresh = await this.createConversation(user, "New Chat");
      activeId = fresh.id;
    }

    eventBusService.emitUserEvent({
      type: "chat_message",
      userId: user.id,
      telegramUserId: user.telegramUserId,
      data: { action: "conversation_deleted", conversationId, activeConversationId: activeId },
    });

    return { success: true, activeConversationId: activeId };
  }

  /**
   * Fetches full message history for a specific conversation (or latest active).
   */
  public async getMessages(user: AuthenticatedUser, limit = 100, conversationId?: number): Promise<{ messages: any[]; conversationId: number }> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    let targetConvId = conversationId;

    if (!targetConvId) {
      // Find the most recent conversation
      const latestConvRes = await pool.query(
        `SELECT id FROM conversations WHERE telegram_user_id = $1 ORDER BY updated_at DESC LIMIT 1;`,
        [partitionId]
      );
      if (latestConvRes.rows.length > 0) {
        targetConvId = latestConvRes.rows[0].id;
      } else {
        const created = await this.createConversation(user, "New Chat");
        targetConvId = created.id;
      }
    } else {
      // Verify ownership
      const checkRes = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND telegram_user_id = $2;`,
        [targetConvId, partitionId]
      );
      if (checkRes.rows.length === 0) {
        // Fallback to most recent
        const fallbackRes = await pool.query(
          `SELECT id FROM conversations WHERE telegram_user_id = $1 ORDER BY updated_at DESC LIMIT 1;`,
          [partitionId]
        );
        targetConvId = fallbackRes.rows[0]?.id || (await this.createConversation(user, "New Chat")).id;
      }
    }

    const query = `
      SELECT m.id, m.role, m.content, m.media_type, m.source, m.audio_url, m.created_at, m.conversation_id
      FROM messages m
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2;
    `;
    const res = await pool.query(query, [targetConvId, limit]);
    const messages = res.rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      mediaType: r.media_type || "text",
      source: r.source || "web",
      audioUrl: r.audio_url || undefined,
      createdAt: r.created_at,
    }));

    return { messages, conversationId: targetConvId };
  }

  /**
   * Clears conversation history for the specified conversation.
   */
  public async clearMessages(user: AuthenticatedUser, conversationId?: number): Promise<void> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    if (conversationId) {
      await pool.query(
        `DELETE FROM messages WHERE conversation_id = $1 AND conversation_id IN (SELECT id FROM conversations WHERE telegram_user_id = $2);`,
        [conversationId, partitionId]
      );
      await pool.query(
        `UPDATE conversations SET updated_at = NOW(), title = 'New Chat' WHERE id = $1 AND telegram_user_id = $2;`,
        [conversationId, partitionId]
      );
    } else {
      await conversationService.clearConversation(partitionId, partitionId);
    }

    eventBusService.emitUserEvent({
      type: "chat_message",
      userId: user.id,
      telegramUserId: user.telegramUserId,
      data: { action: "cleared", conversationId },
    });
  }

  /**
   * Processes a new user prompt from the Web Workspace.
   */
  public async sendMessage(
    user: AuthenticatedUser,
    content: string,
    options?: { mode?: string; modelOverride?: string; searchEnabled?: boolean; clientMsgId?: string; conversationId?: number }
  ): Promise<{ userMessage: any; assistantMessage: any; conversationId: number; conversationTitle?: string }> {
    const partitionId = await this.ensurePartitionUser(user);
    const pool = getPool();

    // 1. Resolve Target Conversation ID
    let conversationId = options?.conversationId;
    if (!conversationId) {
      const latestConvRes = await pool.query(
        `SELECT id, title FROM conversations WHERE telegram_user_id = $1 ORDER BY updated_at DESC LIMIT 1;`,
        [partitionId]
      );
      if (latestConvRes.rows.length > 0) {
        conversationId = latestConvRes.rows[0].id;
      } else {
        const created = await this.createConversation(user, "New Chat");
        conversationId = created.id;
      }
    } else {
      // Verify ownership
      const checkRes = await pool.query(
        `SELECT id, title FROM conversations WHERE id = $1 AND telegram_user_id = $2;`,
        [conversationId, partitionId]
      );
      if (checkRes.rows.length === 0) {
        const created = await this.createConversation(user, "New Chat");
        conversationId = created.id;
      }
    }

    // 2. Fetch authoritative user preferences and admin overrides
    const [userRecord, userTier] = await Promise.all([
      userTierService.getUser(partitionId).catch(() => null),
      userTierService.getUserTier(partitionId).catch(() => "free" as const),
    ]);

    // 3. Insert user message
    const insertUserMsgQuery = `
      INSERT INTO messages (conversation_id, role, content, media_type, source, created_at)
      VALUES ($1, 'user', $2, 'text', 'web', NOW())
      RETURNING id, role, content, media_type, source, created_at, conversation_id;
    `;
    const userMsgRes = await pool.query(insertUserMsgQuery, [conversationId, content]);
    const userMessage = {
      id: userMsgRes.rows[0].id,
      conversationId: userMsgRes.rows[0].conversation_id,
      clientMsgId: options?.clientMsgId,
      role: "user",
      content: userMsgRes.rows[0].content,
      mediaType: userMsgRes.rows[0].media_type,
      source: "web",
      createdAt: userMsgRes.rows[0].created_at,
    };

    // Auto-generate conversation title if currently "New Chat"
    let updatedTitle: string | undefined;
    const titleCheck = await pool.query(`SELECT title FROM conversations WHERE id = $1;`, [conversationId]);
    if (titleCheck.rows[0]?.title === "New Chat" || !titleCheck.rows[0]?.title) {
      const generatedTitle = content.trim().replace(/\s+/g, " ").slice(0, 40);
      updatedTitle = generatedTitle.length > 37 ? generatedTitle + "..." : generatedTitle;
      await pool.query(
        `UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2;`,
        [updatedTitle, conversationId]
      );
    } else {
      await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1;`, [conversationId]);
    }

    // Emit user message to SSE (includes clientMsgId for frontend deduplication/reconciliation)
    eventBusService.emitUserEvent({
      type: "chat_message",
      userId: user.id,
      telegramUserId: user.telegramUserId,
      data: { ...userMessage, conversationTitle: updatedTitle },
    });

    // Check for in-chat name update phrases ("call me Femi", "my name is Lekan")
    const inChatNameCheck = await userIdentityResolverService.checkAndHandleInChatNameUpdate(partitionId, content, false);
    if (inChatNameCheck.handled && inChatNameCheck.replyText) {
      const nameReplyRes = await pool.query(
        `INSERT INTO messages (conversation_id, role, content, media_type, source, created_at)
         VALUES ($1, 'model', $2, 'text', 'web', NOW())
         RETURNING id, created_at;`,
        [conversationId, inChatNameCheck.replyText]
      );
      const assistantMessage = {
        id: nameReplyRes.rows[0].id,
        conversationId,
        role: "assistant" as const,
        content: inChatNameCheck.replyText,
        mediaType: "text",
        source: "web",
        createdAt: nameReplyRes.rows[0].created_at,
      };
      eventBusService.emitUserEvent({
        type: "chat_message",
        userId: user.id,
        telegramUserId: user.telegramUserId,
        data: assistantMessage,
      });
      return { userMessage, assistantMessage };
    }

    // 4. Retrieve relevant contextual memories
    let contextualMemories = "";
    try {
      const memories = await memoryService.getUserMemories(partitionId);
      if (memories && memories.length > 0) {
        contextualMemories = memoryService.formatMemoriesForPrompt(memories);
      }
    } catch (memErr) {
      logger.warn({ error: memErr }, "Failed fetching user memories for web chat context");
    }

    // 5. Retrieve past dialogue history for context in this specific conversation
    const historyRes = await pool.query(
      `SELECT id, role, content FROM messages WHERE conversation_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 12;`,
      [conversationId, userMessage.id]
    );
    const historyPayload = historyRes.rows.reverse().map((m) => ({
      role: (m.role === "model" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    }));

    // Construct system instructions
    const personaResult = await personaService.getPersona(partitionId).catch(() => null);
    const persona = personaResult?.persona;
    const primaryModelRecord = unifiedModelRegistryService.getModelForRole("primary_chat");
    const activeAdminConfigInfo = primaryModelRecord ? `Admin Configured Primary Model: ${primaryModelRecord.name || primaryModelRecord.modelId} (Provider: ${primaryModelRecord.provider}, Model ID: ${primaryModelRecord.modelId}).` : "";

    const liveUserIdentityRes = await pool.query(
      `SELECT u.preferred_name, u.name_source, u.first_name, w.given_name, w.name, tz.content as user_tz
       FROM users u
       LEFT JOIN web_users w ON w.telegram_user_id = u.telegram_user_id
       LEFT JOIN user_memories tz ON tz.telegram_user_id = u.telegram_user_id AND tz.key = 'user_timezone' AND tz.status != 'deleted'
       WHERE u.telegram_user_id = $1 LIMIT 1;`,
      [partitionId]
    );
    const liveUserRow = liveUserIdentityRes.rows[0];
    const identityBlock = buildUserPromptIdentityBlock({
      preferred_name: liveUserRow?.preferred_name,
      name_source: liveUserRow?.name_source,
      first_name: liveUserRow?.first_name,
      given_name: liveUserRow?.given_name,
      name: liveUserRow?.name,
      timezone: liveUserRow?.user_tz || "UTC",
    });

    const systemPrompt = [
      "You are the Wingbuddy AI Assistant operating inside the unified Web Workspace & Telegram ecosystem.",
      identityBlock,
      activeAdminConfigInfo ? `[Authoritative System Configuration]:\n${activeAdminConfigInfo}` : "",
      persona?.systemPrompt ? `Active Persona (${persona.name}): ${persona.systemPrompt}` : "",
      contextualMemories ? `[User Memory & Preferences Vault]:\n${contextualMemories}` : "",
      "Strict Zero-Fallback Policy: Answer authoritatively with real, accurate information. If asked about your model or system configuration, cite the authoritative Admin Configured Primary Model above. If live web research or search results are needed, be precise and cite facts with Markdown links. Never use mock data, hardcoded placeholder values, static fallbacks, or simulated responses. All outputs and features must rely exclusively on live, dynamic, adaptive data and verified system capabilities.",
      "Format code snippets with full syntax highlighting markdown.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const routerMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...historyPayload,
      { role: "user", content },
    ];

    // 6. Generate AI reply via Adaptive AI Router
    let assistantReplyText = "";
    try {
      const routeResult = await adaptiveAIRouterService.route(
        {
          messages: routerMessages,
          systemInstruction: systemPrompt,
        },
        {
          mode: options?.mode || userRecord?.mode || "general",
          isDeepReasoning: content.length > 150 || content.toLowerCase().includes("plan") || content.toLowerCase().includes("research"),
          enableSearch: options?.searchEnabled ?? true,
          userTier,
          userCustomModelOverride: options?.modelOverride || userRecord?.customModelOverride,
          personaPreferredModel: persona?.preferredModel,
        }
      );
      assistantReplyText = routeResult.response.text || "I have processed your request.";
    } catch (aiErr: any) {
      logger.error({ error: aiErr }, "Web chat AI routing failure");
      assistantReplyText = `Execution error: ${aiErr?.message || "Failed to generate response across configured AI models."}`;
    }

    // 7. Save assistant message
    const insertAssistantMsgQuery = `
      INSERT INTO messages (conversation_id, role, content, media_type, source, created_at)
      VALUES ($1, 'model', $2, 'text', 'web', NOW())
      RETURNING id, role, content, media_type, source, created_at, conversation_id;
    `;
    const asstRes = await pool.query(insertAssistantMsgQuery, [conversationId, assistantReplyText]);
    const assistantMessage = {
      id: asstRes.rows[0].id,
      conversationId: asstRes.rows[0].conversation_id,
      role: "model",
      content: asstRes.rows[0].content,
      mediaType: asstRes.rows[0].media_type,
      source: "web",
      createdAt: asstRes.rows[0].created_at,
    };

    // Update conversation timestamp
    await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1;`, [conversationId]);

    // Emit assistant message to SSE
    eventBusService.emitUserEvent({
      type: "chat_message",
      userId: user.id,
      telegramUserId: user.telegramUserId,
      data: assistantMessage,
    });

    // 8. Extract memory asynchronously if noteworthy
    memoryService.extractAndSaveMemories(partitionId, content, assistantReplyText).catch((err) => {
      logger.warn({ error: err }, "Background memory extraction note");
    });

    // 9. Cross-sync to Telegram if user has active Telegram linking and notificationPreference === 'full'
    if (user.telegramUserId && user.notificationPreference === "full" && telegramRuntime.bot) {
      try {
        const tgMessage = `💬 <b>Web Workspace Activity</b>\n\n<i>${escapeHtml(content.slice(0, 100))}${content.length > 100 ? "..." : ""}</i>\n\n${assistantReplyText.slice(0, 1200)}${assistantReplyText.length > 1200 ? "\n\n<i>[Truncated on Telegram. View full conversation in Web Dashboard]</i>" : ""}`;
        await telegramRuntime.bot.api.sendMessage(user.telegramUserId, tgMessage, { parse_mode: "HTML" }).catch(() => {});
      } catch (tgSyncErr) {
        logger.warn({ error: tgSyncErr }, "Failed sending cross-sync ping to Telegram");
      }
    }

    return { userMessage, assistantMessage, conversationId, conversationTitle: updatedTitle };
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const webChatService = new WebChatService();
