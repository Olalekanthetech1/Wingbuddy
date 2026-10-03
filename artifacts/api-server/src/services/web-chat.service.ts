import { getPool } from "@workspace/db";
import type { Request, Response } from "express";
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
import { PromptBuilderService } from "./prompt-builder.service";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { MODES } from "../config/mode";
import { categorizeAndLogError } from "../utils/error-taxonomy";
import { mediaJobOrchestratorService } from "./media/media-job-orchestrator.service";
import { semanticInteractionResolverService } from "./semantic-interaction-resolver.service";
import { OutputGuardService } from "./output-guard.service";

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
  public getPartitionUserId(user: AuthenticatedUser): number | bigint {
    return user.telegramUserId || BigInt(9000000000 + user.id);
  }

  /**
   * Ensures the partition user exists in the authoritative users table to satisfy foreign keys.
   */
  public async ensurePartitionUser(user: AuthenticatedUser): Promise<number> {
    const partitionId = this.getPartitionUserId(user);
    const pool = getPool();
    const isAdmin = user.role === "admin";
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
      SELECT 
        m.id, m.role, m.content, m.media_type, m.source, m.audio_url, m.created_at, m.conversation_id,
        m.asset_id, m.job_id, m.metadata_json,
        a.type as a_type, a.mime_type as a_mime, a.width as a_width, a.height as a_height,
        a.duration_seconds as a_duration, a.engine as a_engine, a.prompt as a_prompt,
        a.params_json as a_params, a.url as a_url, a.storage_provider as a_storage,
        j.status as j_status, j.failure_reason as j_failure_reason, j.error_message as j_error_message,
        j.started_at as j_started_at, j.completed_at as j_completed_at
      FROM messages m
      LEFT JOIN media_assets a ON m.asset_id = a.id
      LEFT JOIN media_jobs j ON m.job_id = j.job_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2;
    `;
    const res = await pool.query(query, [targetConvId, limit]);
    const messages = res.rows.map((r) => {
      let asset: any = undefined;
      if (r.asset_id && r.a_url) {
        asset = {
          id: r.asset_id,
          conversationId: r.conversation_id,
          type: r.a_type || (r.media_type === "video" ? "video" : "image"),
          mimeType: r.a_mime || (r.media_type === "video" ? "video/mp4" : "image/png"),
          width: r.a_width || 1024,
          height: r.a_height || 1024,
          durationSeconds: r.a_duration ? Number(r.a_duration) : undefined,
          engine: r.a_engine || "",
          prompt: r.a_prompt || r.content,
          params: r.a_params || {},
          url: r.a_url,
          storageProvider: r.a_storage || "cloudinary",
          status: "ready",
        };
      }

      let job: any = undefined;
      if (r.job_id) {
        job = {
          jobId: r.job_id,
          status: r.j_status || "queued",
          failureReason: r.j_failure_reason,
          errorMessage: r.j_error_message,
          startedAt: r.j_started_at,
          completedAt: r.j_completed_at,
        };
      }

      if (r.metadata_json) {
        try {
          const meta = typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json;
          if (meta.jobId && !job) {
            job = {
              jobId: meta.jobId,
              status: meta.status || "queued",
              failureReason: meta.failureReason,
              errorMessage: meta.errorMessage,
              startedAt: meta.startedAt,
            };
          }
          if (meta.asset && !asset) {
            asset = meta.asset;
          }
        } catch {}
      }

      return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        mediaType: r.media_type || (asset ? asset.type : "text"),
        source: r.source || "web",
        audioUrl: r.audio_url || undefined,
        jobId: r.job_id || job?.jobId || undefined,
        assetId: r.asset_id || asset?.id || undefined,
        job,
        asset,
        createdAt: r.created_at,
      };
    });

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

    // 3.5 Check for explicit media shortcuts (/image, /video, /img, /clip, /draw) or semantic intent
    const trimmedInput = content.trim();
    const isImageCmd = /^\/(image|img|draw|paint)\b/i.test(trimmedInput);
    const isVideoCmd = /^\/(video|vid|clip)\b/i.test(trimmedInput);

    let mediaModality: "image" | "video" | null = null;
    let mediaPrompt = "";

    if (isImageCmd) {
      mediaModality = "image";
      mediaPrompt = trimmedInput.replace(/^\/(image|img|draw|paint)\s*/i, "").trim();
    } else if (isVideoCmd) {
      mediaModality = "video";
      mediaPrompt = trimmedInput.replace(/^\/(video|vid|clip)\s*/i, "").trim();
    } else {
      // Orchestrator intent detection via semantic interaction resolver
      try {
        const histQuick = await pool.query(
          `SELECT role, content FROM messages WHERE conversation_id = $1 AND id != $2 AND status = 'completed' AND kind = 'conversational' ORDER BY created_at DESC LIMIT 6;`,
          [conversationId, userMessage.id]
        );
        const histPayload = histQuick.rows.reverse().map((m) => ({
          role: (m.role === "model" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        }));

        const semanticDecision = await semanticInteractionResolverService.resolve({
          text: content,
          persistentMode: userRecord?.mode || "general",
          history: histPayload,
        });

        if (semanticDecision.intent === "image_generation") {
          mediaModality = "image";
          mediaPrompt = semanticDecision.cleanedPrompt || content;
        } else if (semanticDecision.intent === "video_generation") {
          mediaModality = "video";
          mediaPrompt = semanticDecision.cleanedPrompt || content;
        }
      } catch (intentErr) {
        logger.warn({ intentErr }, "Failed evaluating semantic intent for media");
      }
    }

    if (mediaModality && mediaPrompt) {
      // Enqueue async media job immediately (non-blocking)
      const { job, messageId: placeholderMsgId } = await mediaJobOrchestratorService.enqueueJob({
        ownerUserId: partitionId,
        conversationId,
        modality: mediaModality,
        prompt: mediaPrompt,
        sourceInterface: "web",
        clientMsgId: options?.clientMsgId,
      });

      const initialPlaceholderText = mediaModality === "video"
        ? `🎬 Generating video for: "${mediaPrompt}"`
        : `🎨 Generating image for: "${mediaPrompt}"`;

      const assistantMessage = {
        id: placeholderMsgId,
        conversationId,
        role: "model",
        content: initialPlaceholderText,
        mediaType: mediaModality,
        source: "web",
        jobId: job.jobId,
        job,
        createdAt: job.createdAt,
      };

      // Emit assistant placeholder message to SSE
      eventBusService.emitUserEvent({
        type: "chat_message",
        userId: user.id,
        telegramUserId: user.telegramUserId,
        data: assistantMessage,
      });

      return { userMessage, assistantMessage, conversationId, conversationTitle: updatedTitle };
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
      `SELECT id, role, content FROM messages WHERE conversation_id = $1 AND id != $2 AND status = 'completed' AND kind = 'conversational' ORDER BY created_at DESC LIMIT 12;`,
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

    // Context Continuity: Short record of recently generated media artifacts
    let mediaArtifactsContext = "";
    try {
      const recentMediaRes = await pool.query(
        `SELECT id, type, prompt, engine, url FROM media_assets WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 3;`,
        [conversationId]
      );
      if (recentMediaRes.rows.length > 0) {
        mediaArtifactsContext = [
          "[Recent Generated Media Artifacts in this Conversation Thread]:",
          ...recentMediaRes.rows.map(
            (r) => `- ${r.type.toUpperCase()} #${r.id} (Engine: ${r.engine}): Prompt "${r.prompt}". URL: ${r.url}`
          ),
          "If the user asks follow-up changes (e.g. 'make it darker', 'vary that image', 'turn that into a video'), refer to the most recent artifact above."
        ].join("\n");
      }
    } catch (mediaContextErr) {
      logger.warn({ mediaContextErr }, "Failed fetching media context for prompt");
    }

    const manifest = await PromptBuilderService.buildLiveManifest({
      userId: Number(partitionId),
      telegramUserId: user.telegramUserId,
    });

    const memoryInstruction = [
      contextualMemories ? `[User Memory & Preferences Vault]:\n${contextualMemories}` : "",
      mediaArtifactsContext,
    ].filter(Boolean).join("\n\n");

    const systemPrompt = PromptBuilderService.buildSystemPrompt({
      userName: liveUserRow?.preferred_name || liveUserRow?.first_name || liveUserRow?.given_name || undefined,
      personalityInstruction: userRecord?.personality ? PERSONALITIES[userRecord.personality as PersonalityKey]?.instruction : PERSONALITIES.playful.instruction,
      modeInstruction: MODES[options?.mode || userRecord?.mode || "general"]?.instruction || MODES.general.instruction,
      memoryInstruction,
      manifest,
      personaInstruction: persona?.systemPrompt,
      personaName: persona?.name,
      personaEmoji: persona?.emoji,
    });

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
      const sanitized = categorizeAndLogError(aiErr);
      assistantReplyText = sanitized.userMessage;
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

  private static activeStreams = new Map<number, { abort: () => void }>();

  public stopStream(conversationId: number): boolean {
    const stream = WebChatService.activeStreams.get(conversationId);
    if (stream) {
      stream.abort();
      WebChatService.activeStreams.delete(conversationId);
      return true;
    }
    return false;
  }

  /**
   * Streams a new user prompt from the Web Workspace via Server-Sent Events.
   */
  public async streamMessage(
    user: AuthenticatedUser,
    content: string,
    res: Response,
    req: Request,
    options?: { mode?: string; modelOverride?: string; searchEnabled?: boolean; clientMsgId?: string; conversationId?: number }
  ): Promise<void> {
    const t_start = Date.now();
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
        `SELECT id FROM conversations WHERE id = $1 AND telegram_user_id = $2;`,
        [conversationId, partitionId]
      );
      if (checkRes.rows.length === 0) {
        const created = await this.createConversation(user, "New Chat");
        conversationId = created.id;
      }
    }

    // 2. Enforce one active stream per conversation
    if (WebChatService.activeStreams.has(conversationId)) {
      res.status(409).json({ error: "Another streaming session is active for this conversation thread." });
      return;
    }

    let isAborted = false;
    let isFinished = false;

    WebChatService.activeStreams.set(conversationId, {
      abort: () => {
        isAborted = true;
      }
    });

    // 3. Fetch authoritative user preferences and admin overrides
    const [userRecord, userTier] = await Promise.all([
      userTierService.getUser(partitionId).catch(() => null),
      userTierService.getUserTier(partitionId).catch(() => "free" as const),
    ]);

    // 4. Insert user message
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

    // Set headers for EventStream with unbuffered transmission
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    // Periodic heartbeat to prevent proxy timeout on Render or intermediate gateways
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
        if (typeof (res as any).flush === "function") {
          (res as any).flush();
        }
      }
    }, 15000);

    const sendEvent = (event: string, data: any) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === "function") {
          (res as any).flush();
        }
      }
    };

    // Check for in-chat name update phrases
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

      sendEvent("start", { messageId: nameReplyRes.rows[0].id, conversationId, conversationTitle: updatedTitle });
      sendEvent("delta", { delta: inChatNameCheck.replyText });
      sendEvent("done", { text: inChatNameCheck.replyText, conversationId });

      eventBusService.emitUserEvent({
        type: "chat_message",
        userId: user.id,
        telegramUserId: user.telegramUserId,
        data: assistantMessage,
      });

      WebChatService.activeStreams.delete(conversationId);
      isFinished = true;
      res.end();
      return;
    }

    // Check for explicit media shortcuts (/image, /video, etc.)
    const trimmedInput = content.trim();
    const isImageCmd = /^\/(image|img|draw|paint)\b/i.test(trimmedInput);
    const isVideoCmd = /^\/(video|vid|clip)\b/i.test(trimmedInput);

    let mediaModality: "image" | "video" | null = null;
    let mediaPrompt = "";

    if (isImageCmd) {
      mediaModality = "image";
      mediaPrompt = trimmedInput.replace(/^\/(image|img|draw|paint)\s*/i, "").trim();
    } else if (isVideoCmd) {
      mediaModality = "video";
      mediaPrompt = trimmedInput.replace(/^\/(video|vid|clip)\s*/i, "").trim();
    } else if (/\b(image|picture|photo|illustration|drawing|paint|video|animation|clip|movie|generate|draw|create|render)\b/i.test(trimmedInput)) {
      try {
        const histQuick = await pool.query(
          `SELECT role, content FROM messages WHERE conversation_id = $1 AND id != $2 AND status = 'completed' AND kind = 'conversational' ORDER BY created_at DESC LIMIT 6;`,
          [conversationId, userMessage.id]
        );
        const histPayload = histQuick.rows.reverse().map((m) => ({
          role: (m.role === "model" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        }));

        const semanticDecision = await semanticInteractionResolverService.resolve({
          text: content,
          persistentMode: userRecord?.mode || "general",
          history: histPayload,
        });

        if (semanticDecision.intent === "image_generation") {
          mediaModality = "image";
          mediaPrompt = semanticDecision.cleanedPrompt || content;
        } else if (semanticDecision.intent === "video_generation") {
          mediaModality = "video";
          mediaPrompt = semanticDecision.cleanedPrompt || content;
        }
      } catch (intentErr) {
        logger.warn({ intentErr }, "Failed evaluating semantic intent for media");
      }
    }

    if (mediaModality && mediaPrompt) {
      const { job, messageId: placeholderMsgId } = await mediaJobOrchestratorService.enqueueJob({
        ownerUserId: partitionId,
        conversationId,
        modality: mediaModality,
        prompt: mediaPrompt,
        sourceInterface: "web",
        clientMsgId: options?.clientMsgId,
      });

      const initialPlaceholderText = mediaModality === "video"
        ? `🎬 Generating video for: "${mediaPrompt}"`
        : `🎨 Generating image for: "${mediaPrompt}"`;

      const assistantMessage = {
        id: placeholderMsgId,
        conversationId,
        role: "model",
        content: initialPlaceholderText,
        mediaType: mediaModality,
        source: "web",
        jobId: job.jobId,
        job,
        createdAt: job.createdAt,
      };

      sendEvent("start", { messageId: placeholderMsgId, conversationId, conversationTitle: updatedTitle });
      sendEvent("delta", { delta: initialPlaceholderText });
      sendEvent("done", { text: initialPlaceholderText, conversationId });

      eventBusService.emitUserEvent({
        type: "chat_message",
        userId: user.id,
        telegramUserId: user.telegramUserId,
        data: assistantMessage,
      });

      WebChatService.activeStreams.delete(conversationId);
      isFinished = true;
      res.end();
      return;
    }

    // Context memories & history
    let contextualMemories = "";
    try {
      const memories = await memoryService.getUserMemories(partitionId);
      if (memories && memories.length > 0) {
        contextualMemories = memoryService.formatMemoriesForPrompt(memories);
      }
    } catch (memErr) {
      logger.warn({ error: memErr }, "Failed fetching user memories for web chat context");
    }

    const historyRes = await pool.query(
      `SELECT id, role, content FROM messages WHERE conversation_id = $1 AND id != $2 AND status = 'completed' AND kind = 'conversational' ORDER BY created_at DESC LIMIT 12;`,
      [conversationId, userMessage.id]
    );
    const historyPayload = historyRes.rows.reverse().map((m) => ({
      role: (m.role === "model" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    }));

    const personaResult = await personaService.getPersona(partitionId).catch(() => null);
    const persona = personaResult?.persona;

    const liveUserIdentityRes = await pool.query(
      `SELECT u.preferred_name, u.name_source, u.first_name, w.given_name, w.name, tz.content as user_tz
       FROM users u
       LEFT JOIN web_users w ON w.telegram_user_id = u.telegram_user_id
       LEFT JOIN user_memories tz ON tz.telegram_user_id = u.telegram_user_id AND tz.key = 'user_timezone' AND tz.status != 'deleted'
       WHERE u.telegram_user_id = $1 LIMIT 1;`,
      [partitionId]
    );
    const liveUserRow = liveUserIdentityRes.rows[0];

    let mediaArtifactsContext = "";
    try {
      const recentMediaRes = await pool.query(
        `SELECT id, type, prompt, engine, url FROM media_assets WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 3;`,
        [conversationId]
      );
      if (recentMediaRes.rows.length > 0) {
        mediaArtifactsContext = [
          "[Recent Generated Media Artifacts in this Conversation Thread]:",
          ...recentMediaRes.rows.map(
            (r) => `- ${r.type.toUpperCase()} #${r.id} (Engine: ${r.engine}): Prompt "${r.prompt}". URL: ${r.url}`
          ),
          "If the user asks follow-up changes (e.g. 'make it darker', 'vary that image', 'turn that into a video'), refer to the most recent artifact above."
        ].join("\n");
      }
    } catch (mediaContextErr) {
      logger.warn({ mediaContextErr }, "Failed fetching media context for prompt");
    }

    const manifest = await PromptBuilderService.buildLiveManifest({
      userId: Number(partitionId),
      telegramUserId: user.telegramUserId,
    });

    const memoryInstruction = [
      contextualMemories ? `[User Memory & Preferences Vault]:\n${contextualMemories}` : "",
      mediaArtifactsContext,
    ].filter(Boolean).join("\n\n");

    const systemPrompt = PromptBuilderService.buildSystemPrompt({
      userName: liveUserRow?.preferred_name || liveUserRow?.first_name || liveUserRow?.given_name || undefined,
      personalityInstruction: userRecord?.personality ? PERSONALITIES[userRecord.personality as PersonalityKey]?.instruction : PERSONALITIES.playful.instruction,
      modeInstruction: MODES[options?.mode || userRecord?.mode || "general"]?.instruction || MODES.general.instruction,
      memoryInstruction,
      manifest,
      personaInstruction: persona?.systemPrompt,
      personaName: persona?.name,
      personaEmoji: persona?.emoji,
    });

    const routerMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...historyPayload,
      { role: "user", content },
    ];

    // Create assistant streaming placeholder message in database
    const insertAssistantMsgQuery = `
      INSERT INTO messages (conversation_id, role, content, media_type, source, metadata_json, created_at)
      VALUES ($1, 'model', '', 'text', 'web', $2, NOW())
      RETURNING id, role, content, media_type, source, created_at, conversation_id;
    `;
    const asstRes = await pool.query(insertAssistantMsgQuery, [conversationId, JSON.stringify({ status: "streaming", text: "" })]);
    const assistantMessageId = asstRes.rows[0].id;

    // Send the start event
    sendEvent("start", { messageId: assistantMessageId, conversationId, conversationTitle: updatedTitle });

    // Handle Client Abort
    req.on("close", async () => {
      if (!isFinished) {
        isAborted = true;
        logger.info({ conversationId }, "SSE client closed connection or aborted streaming. Finalizing state as stopped.");
        WebChatService.activeStreams.delete(conversationId);
      }
    });

    const t_context_ready = Date.now();
    let t_first_token: number | null = null;
    let t_first_delta: number | null = null;

    let fullText = "";
    let releasedText = "";
    let lastDbUpdate = Date.now();
    let isLeaking = false;

    // Word-boundary hold-back buffer for secret scanning
    const HOLD_BACK_TARGET = OutputGuardService.HOLD_BACK_TARGET;

    try {
      const stream = adaptiveAIRouterService.routeStream(
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

      for await (const chunk of stream) {
        if (isAborted) {
          logger.info("Aborting generator stream processing per client abort flag.");
          break;
        }

        if (chunk.delta) {
          if (!t_first_token) {
            t_first_token = Date.now();
          }
          fullText += chunk.delta;

          // Run output guard check on accumulated text
          const leakCheck = OutputGuardService.detectLeak({
            response: fullText,
            userQuery: content,
          });

          if (leakCheck.isHardBlock) {
            logger.warn({ reason: leakCheck.reason, ruleId: leakCheck.ruleId }, "Prompt leak hard block detected in web streaming buffer. Stopping stream.");
            isLeaking = true;
            break;
          }

          // Release safe text up to word boundary leaving ~HOLD_BACK_TARGET chars in window
          if (fullText.length - releasedText.length > HOLD_BACK_TARGET) {
            const candidateEnd = fullText.length - HOLD_BACK_TARGET;
            const lastSpace = fullText.lastIndexOf(" ", candidateEnd);
            const lastNewline = fullText.lastIndexOf("\n", candidateEnd);
            const boundary = Math.max(lastSpace, lastNewline);
            const releaseUpTo = boundary > releasedText.length ? boundary + 1 : candidateEnd;

            if (releaseUpTo > releasedText.length) {
              const delta = fullText.slice(releasedText.length, releaseUpTo);
              releasedText += delta;
              if (!t_first_delta) {
                t_first_delta = Date.now();
              }
              sendEvent("delta", { delta });
            }
          }
        }

        // Throttled database update (once every 1 second)
        if (Date.now() - lastDbUpdate > 1000) {
          await pool.query(
            `UPDATE messages SET content = $1, metadata_json = $2 WHERE id = $3;`,
            [releasedText, JSON.stringify({ status: "streaming", text: releasedText }), assistantMessageId]
          );

          eventBusService.emitUserEvent({
            type: "chat_message",
            userId: user.id,
            telegramUserId: user.telegramUserId,
            data: {
              id: assistantMessageId,
              conversationId,
              role: "model",
              content: releasedText,
              mediaType: "text",
              source: "web",
              createdAt: asstRes.rows[0].created_at,
            },
          });

          lastDbUpdate = Date.now();
        }
      }

      if (isAborted) {
        // Finalize DB row as stopped
        await pool.query(
          `UPDATE messages SET content = $1, kind = 'system_notice', status = 'interrupted', metadata_json = $2 WHERE id = $3;`,
          [releasedText, JSON.stringify({ status: "stopped", text: releasedText }), assistantMessageId]
        );
        isFinished = true;
        res.end();
        return;
      }

      if (isLeaking) {
        const neutralNotice = "That reply was interrupted. Would you like to retry?";
        releasedText = neutralNotice;
        sendEvent("interrupted", { message: neutralNotice, messageId: assistantMessageId });

        await pool.query(
          `UPDATE messages SET content = $1, kind = 'system_notice', status = 'interrupted', metadata_json = $2 WHERE id = $3;`,
          [neutralNotice, JSON.stringify({ status: "interrupted", reason: "guard_block" }), assistantMessageId]
        );

        eventBusService.emitUserEvent({
          type: "chat_message",
          userId: user.id,
          telegramUserId: user.telegramUserId,
          data: {
            id: assistantMessageId,
            conversationId,
            role: "model",
            content: neutralNotice,
            mediaType: "text",
            source: "web",
            createdAt: asstRes.rows[0].created_at,
          },
        });

        sendEvent("done", { text: neutralNotice, conversationId });
        isFinished = true;
        res.end();
        return;
      }

      // Stream completed successfully - flush all remaining held text immediately
      if (fullText.length > releasedText.length) {
        const remaining = fullText.slice(releasedText.length);
        releasedText += remaining;
        if (!t_first_delta) {
          t_first_delta = Date.now();
        }
        sendEvent("delta", { delta: remaining });
      }

      await pool.query(
        `UPDATE messages SET content = $1, kind = 'conversational', status = 'completed', metadata_json = $2 WHERE id = $3;`,
        [fullText, JSON.stringify({ status: "completed", tokenCount: fullText.length / 4 }), assistantMessageId]
      );

      const t_done = Date.now();
      logger.info({
        conversationId,
        metrics: {
          totalDurationMs: t_done - t_start,
          contextPrepMs: t_context_ready - t_start,
          timeToFirstTokenMs: t_first_token ? t_first_token - t_start : null,
          timeToFirstDeltaMs: t_first_delta ? t_first_delta - t_start : null,
          streamDurationMs: t_first_token ? t_done - t_first_token : null,
          totalChars: fullText.length,
        }
      }, "CHAT_STREAM_COMPLETION_METRICS");

      // Save complete message to database
      await pool.query(
        `UPDATE messages SET content = $1, metadata_json = $2 WHERE id = $3;`,
        [releasedText, JSON.stringify({ status: "complete", text: releasedText }), assistantMessageId]
      );
      await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1;`, [conversationId]);

      eventBusService.emitUserEvent({
        type: "chat_message",
        userId: user.id,
        telegramUserId: user.telegramUserId,
        data: {
          id: assistantMessageId,
          conversationId,
          role: "model",
          content: releasedText,
          mediaType: "text",
          source: "web",
          createdAt: asstRes.rows[0].created_at,
        },
      });

      sendEvent("done", { text: releasedText, conversationId });

      // Trigger memory extraction in background
      memoryService.extractAndSaveMemories(partitionId, content, releasedText).catch((err) => {
        logger.warn({ error: err }, "Background memory extraction note");
      });

      // Cross-sync to Telegram if preference is set
      if (user.telegramUserId && user.notificationPreference === "full" && telegramRuntime.bot) {
        try {
          const tgMessage = `💬 <b>Web Workspace Activity</b>\n\n<i>${escapeHtml(content.slice(0, 100))}${content.length > 100 ? "..." : ""}</i>\n\n${releasedText.slice(0, 1200)}${releasedText.length > 1200 ? "\n\n<i>[Truncated on Telegram. View full conversation in Web Dashboard]</i>" : ""}`;
          await telegramRuntime.bot.api.sendMessage(user.telegramUserId, tgMessage, { parse_mode: "HTML" }).catch(() => {});
        } catch (tgSyncErr) {
          logger.warn({ error: tgSyncErr }, "Failed sending cross-sync ping to Telegram");
        }
      }

    } catch (aiErr: any) {
      const sanitized = categorizeAndLogError(aiErr);
      sendEvent("error", {
        error: sanitized.category,
        referenceId: sanitized.referenceId,
        message: sanitized.userMessage,
      });

      await pool.query(
        `UPDATE messages SET content = $1, metadata_json = $2 WHERE id = $3;`,
        [sanitized.userMessage, JSON.stringify({ status: "failed", error: sanitized.category, referenceId: sanitized.referenceId }), assistantMessageId]
      );
    } finally {
      clearInterval(heartbeatTimer);
      WebChatService.activeStreams.delete(conversationId);
      isFinished = true;
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const webChatService = new WebChatService();
