import { randomUUID } from "node:crypto";
import { getPool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { userTierService } from "../user-tier.service";
import { unifiedModelRegistryService } from "../unified-model-registry.service";
import { huggingFaceCapabilityService } from "../huggingface-capability.service";
import { cloudinaryMediaStorageService } from "../cloudinary-media-storage.service";
import { eventBusService } from "../event-bus.service";
import { memoryService } from "../memory.service";
import { UnifiedMediaEngine } from "./unified-media-engine.service";
import type { MediaModality } from "./media-types";

export interface MediaJobDTO {
  jobId: string;
  idempotencyKey?: string;
  ownerUserId: number;
  conversationId?: number;
  messageId?: number;
  modality: MediaModality;
  prompt: string;
  enhancedPrompt?: string;
  params: Record<string, any>;
  status: "queued" | "running" | "succeeded" | "failed";
  failureReason?: "quota" | "capacity" | "content_policy" | "timeout" | "error";
  errorMessage?: string;
  assetId?: number;
  engine?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  asset?: MediaAssetDTO;
}

export interface MediaAssetDTO {
  id: number;
  ownerUserId: number;
  conversationId?: number;
  type: "image" | "video";
  mimeType: string;
  width: number;
  height: number;
  durationSeconds?: number;
  engine: string;
  prompt: string;
  enhancedPrompt?: string;
  params: Record<string, any>;
  url: string;
  storageProvider: string;
  storagePublicId?: string;
  status: string;
  createdAt: string;
}

export interface MediaEngineHealth {
  configured: boolean;
  image: {
    available: boolean;
    provider: string;
    model: string;
    reason?: string;
  };
  video: {
    available: boolean;
    provider: string;
    model: string;
    reason?: string;
  };
  storage: {
    configured: boolean;
    provider: string;
  };
}

class MediaJobOrchestratorService {
  /**
   * Evaluates live capability and health of image and video diffusion engines without assumptions.
   */
  public async getEngineHealth(): Promise<MediaEngineHealth> {
    const allModels = await unifiedModelRegistryService.list().catch(() => []);
    const primaryImage = allModels.find((m) => m.enabled && m.roles.includes("primary_image"));
    const primaryVideo = allModels.find(
      (m) =>
        m.enabled &&
        (m.roles.includes("primary_video") ||
          (m.capabilities.includes("video_generation") && m.provider !== "huggingface") ||
          m.modelId.toLowerCase().includes("veo"))
    );

    let imageAvail = Boolean(primaryImage);
    let imageProvider = primaryImage?.provider || "huggingface";
    let imageModel = primaryImage?.modelId || "";

    if (!imageAvail) {
      try {
        const cap = await huggingFaceCapabilityService.resolveModel("text-to-image");
        imageAvail = Boolean(cap.model);
        imageModel = cap.model || "";
        imageProvider = "huggingface";
      } catch (err: any) {
        imageAvail = false;
      }
    }

    let videoAvail = Boolean(primaryVideo);
    let videoProvider = primaryVideo?.provider || "huggingface";
    let videoModel = primaryVideo?.modelId || "";

    if (!videoAvail) {
      try {
        const cap = await huggingFaceCapabilityService.resolveModel("text-to-video");
        videoAvail = Boolean(cap.model || (cap.candidates && cap.candidates.length > 0));
        videoModel = cap.model || cap.candidates?.[0]?.id || "";
        videoProvider = "huggingface";
      } catch {
        videoAvail = false;
      }
    }

    const storageConfigured = cloudinaryMediaStorageService.isConfigured();

    return {
      configured: imageAvail || videoAvail,
      image: {
        available: imageAvail,
        provider: imageProvider,
        model: imageModel,
        reason: imageAvail ? undefined : "No active text-to-image diffusion model registered.",
      },
      video: {
        available: videoAvail,
        provider: videoProvider,
        model: videoModel,
        reason: videoAvail ? undefined : "No active text-to-video diffusion model registered.",
      },
      storage: {
        configured: storageConfigured,
        provider: storageConfigured ? "cloudinary" : "persistent_artifact_vault",
      },
    };
  }

  /**
   * Validates prompts against disallowed safety patterns before invoking models or charging quota.
   */
  public moderatePrompt(prompt: string): { pass: boolean; reason?: string } {
    const text = prompt.toLowerCase();
    const disallowedPatterns = [
      /\b(csam|child\s*porn|exploitative)\b/i,
      /\b(gore|dismemberment|extreme\s*violence)\b/i,
      /\b(weaponize\s*bioweapon|chemical\s*warfare)\b/i,
    ];

    for (const pattern of disallowedPatterns) {
      if (pattern.test(text)) {
        return { pass: false, reason: "Content policy: Prompt contains prohibited keywords or safety violations." };
      }
    }
    return { pass: true };
  }

  /**
   * Classifies raw runtime errors into typed, transparent failure categories.
   */
  public classifyFailure(error: any): { reason: "quota" | "capacity" | "content_policy" | "timeout" | "error"; message: string } {
    const rawMsg = error instanceof Error ? error.message : String(error || "");
    const lower = rawMsg.toLowerCase();

    if (lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("tier")) {
      return { reason: "quota", message: rawMsg || "Daily generation quota exceeded for your current tier." };
    }
    if (
      lower.includes("capacity") ||
      lower.includes("overloaded") ||
      lower.includes("busy") ||
      lower.includes("503") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      lower.includes("429")
    ) {
      return { reason: "capacity", message: "Diffusion engine currently at peak capacity. Please click Retry in a moment." };
    }
    if (lower.includes("content") || lower.includes("policy") || lower.includes("safety") || lower.includes("nsfw") || lower.includes("blocked")) {
      return { reason: "content_policy", message: "Generation declined by provider content safety filters." };
    }
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
      return { reason: "timeout", message: "Generation timed out before model completed diffusion synthesis." };
    }
    return { reason: "error", message: rawMsg || "Unexpected error during media diffusion synthesis." };
  }

  /**
   * Enqueues an asynchronous media generation job and persists initial message and job ticket immediately.
   */
  public async enqueueJob(params: {
    ownerUserId: number;
    conversationId: number;
    modality: MediaModality;
    prompt: string;
    params?: Record<string, any>;
    idempotencyKey?: string;
    sourceInterface?: "web" | "telegram";
    telegramChatId?: number;
    clientMsgId?: string;
    replyToMessageId?: number;
  }): Promise<{ job: MediaJobDTO; messageId: number }> {
    const pool = getPool();
    const { ownerUserId, conversationId, modality, prompt, sourceInterface = "web", telegramChatId } = params;
    const cleanPrompt = prompt.trim();
    const mediaParams = params.params || {};

    // Audit log request
    logger.info(
      { ownerUserId, modality, prompt: cleanPrompt, sourceInterface, telegramChatId },
      "AUDIT: Media generation request received for evaluation"
    );

    // 1. Check idempotency
    const idempotencyKey = params.idempotencyKey || `idem_${ownerUserId}_${modality}_${Buffer.from(cleanPrompt).toString("base64").slice(0, 32)}_${Math.floor(Date.now() / 60000)}`;
    const existingJobRes = await pool.query(
      `SELECT * FROM media_jobs WHERE idempotency_key = $1 LIMIT 1;`,
      [idempotencyKey]
    );
    if (existingJobRes.rows.length > 0) {
      const existingRow = existingJobRes.rows[0];
      return {
        job: this.formatJobRow(existingRow),
        messageId: existingRow.message_id,
      };
    }

    // 2. Content Moderation
    const moderation = this.moderatePrompt(cleanPrompt);
    if (!moderation.pass) {
      throw new Error(moderation.reason || "Prompt flagged by content moderation filter");
    }

    // 3. Quota Pre-Check (without charging ledger yet)
    const userTier = await userTierService.getUserTier(ownerUserId).catch(() => "free" as const);
    const quotaCheck = await userTierService.checkToolQuota(ownerUserId, modality === "video" ? "video" : "image", userTier);
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.message || `Daily ${modality} generation quota exceeded for your tier.`);
    }

    // 4. Generate unique Job ID
    const jobId = `job_${modality}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    // 5. Create initial placeholder message in conversations thread
    const initialPlaceholderText = modality === "video"
      ? `🎬 Generating video for: "${cleanPrompt}"`
      : `🎨 Generating image for: "${cleanPrompt}"`;

    const initialMetadata = {
      jobId,
      modality,
      prompt: cleanPrompt,
      params: mediaParams,
      status: "queued",
      startedAt: new Date().toISOString(),
    };

    const insertMsgRes = await pool.query(
      `INSERT INTO messages (conversation_id, role, content, media_type, source, job_id, metadata_json, created_at)
       VALUES ($1, 'model', $2, $3, $4, $5, $6, NOW())
       RETURNING id;`,
      [conversationId, initialPlaceholderText, modality, sourceInterface, jobId, JSON.stringify(initialMetadata)]
    );
    const messageId = insertMsgRes.rows[0].id;

    // 6. Insert into media_jobs table with status 'queued'
    const insertJobRes = await pool.query(
      `INSERT INTO media_jobs (
        job_id, idempotency_key, owner_user_id, conversation_id, message_id,
        modality, prompt, params_json, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', NOW(), NOW())
      RETURNING *;`,
      [jobId, idempotencyKey, ownerUserId, conversationId, messageId, modality, cleanPrompt, JSON.stringify(mediaParams)]
    );

    const job = this.formatJobRow(insertJobRes.rows[0]);

    // 7. Emit initial SSE event to Web Client
    eventBusService.emitUserEvent({
      type: "media_job_update",
      telegramUserId: ownerUserId,
      data: {
        jobId,
        messageId,
        conversationId,
        modality,
        prompt: cleanPrompt,
        status: "queued",
        createdAt: job.createdAt,
      },
    });

    // 8. Trigger asynchronous worker immediately (non-blocking)
    setImmediate(() => {
      this.executeJob(jobId, ownerUserId, cleanPrompt, modality, mediaParams, userTier, sourceInterface, telegramChatId).catch((err) => {
        logger.error({ err, jobId }, "Unhandled error in async media worker execution");
      });
    });

    return { job, messageId };
  }

  /**
   * Background execution worker: updates DB status, calls UnifiedMediaEngine, stores asset, and charges quota on success.
   */
  private async executeJob(
    jobId: string,
    ownerUserId: number,
    prompt: string,
    modality: MediaModality,
    params: Record<string, any>,
    userTier: "free" | "pro" | "vip",
    sourceInterface: "web" | "telegram",
    telegramChatId?: number
  ): Promise<void> {
    const pool = getPool();
    const startTime = Date.now();

    // Set job to running
    await pool.query(
      `UPDATE media_jobs SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE job_id = $1;`,
      [jobId]
    );

    eventBusService.emitUserEvent({
      type: "media_job_update",
      telegramUserId: ownerUserId,
      data: {
        jobId,
        status: "running",
        startedAt: new Date().toISOString(),
      },
    });

    try {
      // 1. Invoke Real Engine
      const mediaResult = await UnifiedMediaEngine.execute({
        modality,
        prompt,
        userId: ownerUserId,
        userTier,
        sourceInterface,
        width: params.width || (modality === "video" ? 576 : 1024),
        height: params.height || (modality === "video" ? 320 : 1024),
        durationSeconds: params.durationSeconds || (modality === "video" ? 4 : undefined),
        providerOverride: params.provider,
        modelOverride: params.model,
      });

      if (!mediaResult.success || !mediaResult.job.artifactUrl) {
        throw new Error(mediaResult.job.errorMessage || `Failed generating ${modality} artifact`);
      }

      const generatedJob = mediaResult.job;
      const actualWidth = generatedJob.width || (modality === "video" ? 576 : 1024);
      const actualHeight = generatedJob.height || (modality === "video" ? 320 : 1024);
      const actualDuration = generatedJob.durationSeconds || (modality === "video" ? 4 : null);
      const actualEngine = `${generatedJob.actualProvider}:${generatedJob.actualModel}`;
      const deliveryUrl = generatedJob.artifactUrl;
      const storageProvider = generatedJob.storageProvider || "cloudinary";
      const storagePublicId = generatedJob.storagePublicId;
      const mimeType = generatedJob.mimeType || (modality === "video" ? "video/mp4" : "image/png");

      // 2. Fetch Conversation ID and Message ID for this job
      const jobRowRes = await pool.query(`SELECT conversation_id, message_id FROM media_jobs WHERE job_id = $1;`, [jobId]);
      const convId = jobRowRes.rows[0]?.conversation_id;
      const msgId = jobRowRes.rows[0]?.message_id;

      // 3. Persist into media_assets table
      const insertAssetRes = await pool.query(
        `INSERT INTO media_assets (
          owner_user_id, conversation_id, type, mime_type, width, height,
          duration_seconds, engine, prompt, enhanced_prompt, params_json,
          url, storage_provider, storage_public_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ready', NOW(), NOW())
        RETURNING *;`,
        [
          ownerUserId,
          convId,
          modality,
          mimeType,
          actualWidth,
          actualHeight,
          actualDuration,
          actualEngine,
          prompt,
          generatedJob.enhancedPrompt,
          JSON.stringify(params),
          deliveryUrl,
          storageProvider,
          storagePublicId,
        ]
      );
      const assetRow = insertAssetRes.rows[0];
      const assetId = assetRow.id;

      // 4. Charge Quota upon verified success
      await userTierService.recordToolUsage(ownerUserId, modality === "video" ? "video" : "image");

      // 5. Update media_jobs state to 'succeeded'
      await pool.query(
        `UPDATE media_jobs 
         SET status = 'succeeded', asset_id = $1, engine = $2, completed_at = NOW(), updated_at = NOW() 
         WHERE job_id = $3;`,
        [assetId, actualEngine, jobId]
      );

      // 6. Update message record with structured attachment data
      const assetPayload: MediaAssetDTO = {
        id: assetId,
        ownerUserId,
        conversationId: convId,
        type: modality,
        mimeType,
        width: actualWidth,
        height: actualHeight,
        durationSeconds: actualDuration ? Number(actualDuration) : undefined,
        engine: actualEngine,
        prompt,
        enhancedPrompt: generatedJob.enhancedPrompt,
        params,
        url: deliveryUrl,
        storageProvider,
        storagePublicId,
        status: "ready",
        createdAt: assetRow.created_at,
      };

      const finalContent = modality === "video"
        ? `🎬 Generated video for: "${prompt}"`
        : `🎨 Generated image for: "${prompt}"`;

      if (msgId) {
        await pool.query(
          `UPDATE messages 
           SET content = $1, asset_id = $2, metadata_json = $3 
           WHERE id = $4;`,
          [
            finalContent,
            assetId,
            JSON.stringify({
              jobId,
              status: "succeeded",
              modality,
              asset: assetPayload,
              latencyMs: Date.now() - startTime,
            }),
            msgId,
          ]
        );
      }

      // 7. Context Continuity: Store short memory of generated asset for follow-up prompts
      try {
        await memoryService.saveMemory(
          ownerUserId,
          `recent_${modality}_artifact`,
          `Generated ${modality} (ID #${assetId}) using ${actualEngine} with prompt: "${prompt}". URL: ${deliveryUrl}`,
          "media_artifact"
        );
      } catch (memErr) {
        logger.warn({ memErr }, "Failed saving media artifact context memory");
      }

      // 8. Emit SSE Success Event
      eventBusService.emitUserEvent({
        type: "media_job_update",
        telegramUserId: ownerUserId,
        data: {
          jobId,
          messageId: msgId,
          conversationId: convId,
          status: "succeeded",
          asset: assetPayload,
          latencyMs: Date.now() - startTime,
        },
      });

      // 9. Telegram Parity Delivery (if job originated from or is linked to Telegram)
      if (telegramChatId) {
        try {
          const { telegramRuntime } = await import("../../app");
          if (telegramRuntime?.bot) {
            const isUserAdmin = await userTierService.isAdmin(ownerUserId);
            let badge: string;

            if (isUserAdmin) {
              const allModels = await unifiedModelRegistryService.list().catch(() => []);
              const record = allModels.find(m => m.modelId === actualEngine || m.id === actualEngine);
              let engineDisplay = record?.name || actualEngine;
              if (engineDisplay === actualEngine) {
                // Clean fallback if not in registry
                let name = actualEngine.includes(':') ? actualEngine.split(':').pop()! : actualEngine;
                name = name.includes('/') ? name.split('/').pop()! : name;
                engineDisplay = name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              }
              badge = `🧠 <b>Engine:</b> <code>${escapeHtml(engineDisplay)}</code>`;
            } else {
              badge = `⚡ <i>Powered by Wingbuddy AI</i>`;
            }

            const caption = [
              `<b>${modality === "video" ? "🎬 Video" : "🎨 Image"} Ready!</b>`,
              `<b>Prompt:</b> ${escapeHtml(prompt)}`,
              badge,
            ].join("\n\n");

            if (modality === "video") {
              await telegramRuntime.bot.api.sendVideo(telegramChatId, deliveryUrl, {
                caption,
                parse_mode: "HTML",
              }).catch(async () => {
                await telegramRuntime.bot?.api.sendMessage(
                  telegramChatId,
                  `🎬 <b>Your video is ready:</b>\n<a href="${escapeHtml(deliveryUrl)}">${escapeHtml(prompt)}</a>\n\n${badge}`,
                  { parse_mode: "HTML" }
                );
              });
            } else {
              await telegramRuntime.bot.api.sendPhoto(telegramChatId, deliveryUrl, {
                caption,
                parse_mode: "HTML",
              }).catch(async () => {
                await telegramRuntime.bot?.api.sendMessage(
                  telegramChatId,
                  `🎨 <b>Your image is ready:</b>\n<a href="${escapeHtml(deliveryUrl)}">${escapeHtml(prompt)}</a>\n\n${badge}`,
                  { parse_mode: "HTML" }
                );
              });
            }
          }
        } catch (tgErr) {
          logger.warn({ tgErr, jobId }, "Failed delivering media result to Telegram chat");
        }
      }

      logger.info({ jobId, assetId, modality, engine: actualEngine, latencyMs: Date.now() - startTime }, "Async media generation succeeded");
    } catch (err: any) {
      const classified = this.classifyFailure(err);
      logger.error({ err, jobId, classified }, "Async media generation job failed");

      // Update media_jobs to 'failed'
      await pool.query(
        `UPDATE media_jobs 
         SET status = 'failed', failure_reason = $1, error_message = $2, completed_at = NOW(), updated_at = NOW() 
         WHERE job_id = $3;`,
        [classified.reason, classified.message, jobId]
      );

      // Update message row
      const jobRowRes = await pool.query(`SELECT message_id, conversation_id FROM media_jobs WHERE job_id = $1;`, [jobId]);
      const msgId = jobRowRes.rows[0]?.message_id;
      const convId = jobRowRes.rows[0]?.conversation_id;

      if (msgId) {
        await pool.query(
          `UPDATE messages 
           SET content = $1, metadata_json = $2 
           WHERE id = $3;`,
          [
            `⚠️ Failed generating ${modality}: ${classified.message}`,
            JSON.stringify({
              jobId,
              status: "failed",
              failureReason: classified.reason,
              errorMessage: classified.message,
              prompt,
            }),
            msgId,
          ]
        );
      }

      // Emit SSE Failure Event
      eventBusService.emitUserEvent({
        type: "media_job_update",
        telegramUserId: ownerUserId,
        data: {
          jobId,
          messageId: msgId,
          conversationId: convId,
          status: "failed",
          failureReason: classified.reason,
          errorMessage: classified.message,
          prompt,
        },
      });

      // Deliver Telegram failure notice if applicable
      if (telegramChatId) {
        try {
          const { telegramRuntime } = await import("../../app");
          if (telegramRuntime?.bot) {
            await telegramRuntime.bot.api.sendMessage(
              telegramChatId,
              `⚠️ <b>${modality === "video" ? "Video" : "Image"} Generation Notice</b>\n\n${escapeHtml(classified.message)}\n\n<i>🛡️ Quota was not consumed. You can retry with /${modality === "video" ? "video" : "image"}.</i>`,
              { parse_mode: "HTML" }
            ).catch(() => {});
          }
        } catch (tgErr) {
          logger.warn({ tgErr, jobId }, "Failed delivering media failure notice to Telegram");
        }
      }
    }
  }

  /**
   * Retrieves full job status along with its asset from PostgreSQL.
   */
  public async getJob(jobId: string, ownerUserId?: number): Promise<MediaJobDTO | null> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT j.*, 
         a.id as asset_id_val, a.type as a_type, a.mime_type as a_mime,
         a.width as a_width, a.height as a_height, a.duration_seconds as a_duration,
         a.engine as a_engine, a.url as a_url, a.storage_provider as a_storage,
         a.created_at as a_created_at
       FROM media_jobs j
       LEFT JOIN media_assets a ON j.asset_id = a.id
       WHERE j.job_id = $1 ${ownerUserId ? "AND j.owner_user_id = $2" : ""}
       LIMIT 1;`,
      ownerUserId ? [jobId, ownerUserId] : [jobId]
    );

    if (res.rows.length === 0) return null;
    return this.formatJobRow(res.rows[0]);
  }

  /**
   * Retries a previously failed media job.
   */
  public async retryJob(jobId: string, ownerUserId: number): Promise<{ job: MediaJobDTO; messageId: number }> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM media_jobs WHERE job_id = $1 AND owner_user_id = $2;`,
      [jobId, ownerUserId]
    );
    if (res.rows.length === 0) throw new Error("Job not found");

    const row = res.rows[0];
    return this.enqueueJob({
      ownerUserId,
      conversationId: row.conversation_id,
      modality: row.modality,
      prompt: row.prompt,
      params: row.params_json || {},
      idempotencyKey: `retry_${jobId}_${Date.now()}`,
    });
  }

  /**
   * Regenerates a media asset with identical parameters.
   */
  public async regenerateAsset(assetId: number, ownerUserId: number): Promise<{ job: MediaJobDTO; messageId: number }> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM media_assets WHERE id = $1 AND owner_user_id = $2;`,
      [assetId, ownerUserId]
    );
    if (res.rows.length === 0) throw new Error("Asset not found");

    const row = res.rows[0];
    return this.enqueueJob({
      ownerUserId,
      conversationId: row.conversation_id,
      modality: row.type,
      prompt: row.prompt,
      params: row.params_json || {},
      idempotencyKey: `regen_${assetId}_${Date.now()}`,
    });
  }

  /**
   * Generates a variation of an existing media asset using stored params.
   */
  public async varyAsset(
    assetId: number,
    ownerUserId: number,
    variationPrompt?: string
  ): Promise<{ job: MediaJobDTO; messageId: number }> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM media_assets WHERE id = $1 AND owner_user_id = $2;`,
      [assetId, ownerUserId]
    );
    if (res.rows.length === 0) throw new Error("Asset not found");

    const row = res.rows[0];
    const newPrompt = variationPrompt && variationPrompt.trim()
      ? `${row.prompt}, ${variationPrompt.trim()}`
      : `${row.prompt}, variation with enhanced atmospheric nuance`;
    const newParams = { ...(row.params_json || {}), seed: Math.floor(Math.random() * 10000000) };

    return this.enqueueJob({
      ownerUserId,
      conversationId: row.conversation_id,
      modality: row.type,
      prompt: newPrompt,
      params: newParams,
      idempotencyKey: `vary_${assetId}_${Date.now()}`,
    });
  }

  /**
   * Retrieves single asset record.
   */
  public async getAsset(assetId: number, ownerUserId?: number): Promise<MediaAssetDTO | null> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM media_assets WHERE id = $1 ${ownerUserId ? "AND owner_user_id = $2" : ""} LIMIT 1;`,
      ownerUserId ? [assetId, ownerUserId] : [assetId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      ownerUserId: Number(row.owner_user_id),
      conversationId: row.conversation_id,
      type: row.type,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
      engine: row.engine,
      prompt: row.prompt,
      enhancedPrompt: row.enhanced_prompt,
      params: row.params_json || {},
      url: row.url,
      storageProvider: row.storage_provider,
      storagePublicId: row.storage_public_id,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private formatJobRow(row: any): MediaJobDTO {
    let asset: MediaAssetDTO | undefined;
    if (row.asset_id && row.a_url) {
      asset = {
        id: row.asset_id,
        ownerUserId: Number(row.owner_user_id),
        conversationId: row.conversation_id,
        type: row.a_type || row.modality,
        mimeType: row.a_mime || "image/png",
        width: row.a_width || 1024,
        height: row.a_height || 1024,
        durationSeconds: row.a_duration ? Number(row.a_duration) : undefined,
        engine: row.a_engine || row.engine || "",
        prompt: row.prompt,
        params: row.params_json || {},
        url: row.a_url,
        storageProvider: row.a_storage || "cloudinary",
        status: "ready",
        createdAt: row.a_created_at,
      };
    }

    return {
      jobId: row.job_id,
      idempotencyKey: row.idempotency_key,
      ownerUserId: Number(row.owner_user_id),
      conversationId: row.conversation_id,
      messageId: row.message_id,
      modality: row.modality,
      prompt: row.prompt,
      enhancedPrompt: row.enhanced_prompt,
      params: row.params_json || {},
      status: row.status,
      failureReason: row.failure_reason,
      errorMessage: row.error_message,
      assetId: row.asset_id,
      engine: row.engine,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      asset,
    };
  }
}

export const mediaJobOrchestratorService = new MediaJobOrchestratorService();

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
