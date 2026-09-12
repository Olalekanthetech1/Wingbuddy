import { userTierService } from "../user-tier.service";
import { cloudinaryMediaStorageService } from "../cloudinary-media-storage.service";
import { universalArtifactService } from "../universal-artifact.service";
import { mediaArtifactContextService } from "../media-artifact-context.service";
import { logger } from "../../lib/logger";
import { asyncMediaJobManager } from "./async-media-job-manager.service";
import { ImageExecutor } from "./image-executor.service";
import { VideoExecutor } from "./video-executor.service";
import type {
  MediaExecutionRequest,
  MediaExecutionResult,
  MediaJob,
  MediaModality,
  VideoGenerationTechnique,
} from "./media-types";

export class UnifiedMediaEngine {
  /**
   * Plans and evaluates routing, prompt enhancement, and quota limits without consuming resources.
   * Marked as PLANNED / PREDICTED.
   */
  static async plan(request: MediaExecutionRequest): Promise<MediaExecutionResult> {
    const startTime = Date.now();
    const modality: MediaModality = request.modality;
    const userIdNum = typeof request.userId === "number" ? request.userId : Number(request.userId) || 999999;
    const userTier = request.userTier || "free";

    // 1. Quota check simulation
    let quotaCheck = { allowed: true, remaining: 5, message: undefined as string | undefined };
    try {
      if (request.userId) {
        quotaCheck = await userTierService.checkToolQuota(userIdNum, modality === "video" ? "video" : "image");
      }
    } catch {
      quotaCheck = { allowed: true, remaining: 5, message: undefined };
    }

    let plannedProvider = "huggingface";
    let plannedModel = "";
    let enhancedPrompt = request.prompt;
    let routingReason = "";
    let videoTechnique: VideoGenerationTechnique | undefined;

    if (modality === "image") {
      const plan = await ImageExecutor.plan(request);
      plannedProvider = plan.plannedProvider;
      plannedModel = plan.plannedModel;
      enhancedPrompt = plan.enhancedPrompt;
      routingReason = plan.routingReason;
    } else {
      const plan = await VideoExecutor.plan(request);
      plannedProvider = plan.plannedProvider;
      plannedModel = plan.plannedModel;
      enhancedPrompt = plan.enhancedPrompt;
      routingReason = plan.routingReason;
      videoTechnique = plan.videoTechnique;
    }

    const latencyMs = Date.now() - startTime;

    const job = asyncMediaJobManager.createJob({
      modality,
      executionMode: "dry_run",
      originalPrompt: request.prompt,
      enhancedPrompt,
      actualProvider: plannedProvider,
      actualModel: plannedModel,
      requestedProvider: request.providerOverride,
      requestedModel: request.modelOverride,
      userId: request.userId,
      userTier,
      mimeType: modality === "video" ? "video/mp4" : "image/png",
      videoTechnique,
      isPlannedPrediction: true,
    });

    job.latencyMs = latencyMs;
    job.quotaDecision = {
      allowed: quotaCheck.allowed,
      remaining: quotaCheck.remaining,
      dailyLimit: userTier === "vip" ? 999 : userTier === "pro" ? 50 : 5,
      tier: userTier.toUpperCase(),
    };

    return {
      success: true,
      job,
      transparency: {
        executionMode: "dry_run",
        isPlannedPrediction: true,
        detectedModality: modality,
        selectedProvider: plannedProvider,
        selectedModel: plannedModel,
        routingReason,
        videoTechnique,
        quotaDecision: {
          allowed: quotaCheck.allowed,
          remaining: quotaCheck.remaining,
          tier: userTier.toUpperCase(),
        },
        latencyMs,
        jobId: job.jobId,
        jobState: "completed",
        failovers: [],
        storageProvider: "none (dry-run simulation)",
      },
    };
  }

  /**
   * Executes real media generation pipeline, stores the artifact, tracks async job state, and returns actual runtime metadata.
   */
  static async execute(request: MediaExecutionRequest): Promise<MediaExecutionResult> {
    const startTime = Date.now();
    const modality: MediaModality = request.modality;
    const userIdNum = typeof request.userId === "number" ? request.userId : Number(request.userId) || 999999;
    const userTier = request.userTier || "free";

    // 1. Quota Enforcement
    let quotaCheck = { allowed: true, remaining: 5, message: undefined as string | undefined };
    if (request.userId) {
      try {
        quotaCheck = await userTierService.checkToolQuota(userIdNum, modality === "video" ? "video" : "image");
      } catch {
        quotaCheck = { allowed: true, remaining: 5, message: undefined };
      }

      if (!quotaCheck.allowed) {
        const failedJob = asyncMediaJobManager.createJob({
          modality,
          executionMode: "live",
          originalPrompt: request.prompt,
          enhancedPrompt: request.prompt,
          actualProvider: "none",
          actualModel: "none",
          userId: request.userId,
          userTier,
          mimeType: modality === "video" ? "video/mp4" : "image/png",
          isPlannedPrediction: false,
        });

        asyncMediaJobManager.updateJobState(failedJob.jobId, "failed", {
          errorMessage: quotaCheck.message || `Daily ${modality} generation quota exceeded for tier ${userTier.toUpperCase()}`,
        });

        return {
          success: false,
          job: failedJob,
          transparency: {
            executionMode: "live",
            isPlannedPrediction: false,
            detectedModality: modality,
            selectedProvider: "none",
            selectedModel: "none",
            routingReason: "Execution halted by user quota enforcement layer",
            quotaDecision: {
              allowed: false,
              remaining: 0,
              tier: userTier.toUpperCase(),
            },
            latencyMs: Date.now() - startTime,
            jobId: failedJob.jobId,
            jobState: "failed",
            failovers: [],
            error: quotaCheck.message || "Quota exceeded",
          },
        };
      }
    }

    // 2. Initialize Async Job in State Machine
    const job = asyncMediaJobManager.createJob({
      modality,
      executionMode: "live",
      originalPrompt: request.prompt,
      enhancedPrompt: request.prompt,
      actualProvider: request.providerOverride || "huggingface",
      actualModel: request.modelOverride || "resolving...",
      requestedProvider: request.providerOverride,
      requestedModel: request.modelOverride,
      userId: request.userId,
      userTier,
      mimeType: modality === "video" ? "video/mp4" : "image/png",
      isPlannedPrediction: false,
    });

    asyncMediaJobManager.updateJobState(job.jobId, "submitted", { progress: 15 });

    try {
      asyncMediaJobManager.updateJobState(job.jobId, "processing", { progress: 35 });

      let artifactBuffer: Buffer;
      let mimeType: string;
      let actualProvider: string;
      let actualModel: string;
      let enhancedPrompt: string;
      let videoTechnique: VideoGenerationTechnique | undefined;
      let failovers: any[] = [];
      let width = request.width || 1024;
      let height = request.height || 1024;
      let durationSeconds = request.durationSeconds;

      if (modality === "image") {
        const result = await ImageExecutor.execute(request);
        artifactBuffer = result.buffer;
        mimeType = result.mimeType;
        actualProvider = result.actualProvider;
        actualModel = result.actualModel;
        enhancedPrompt = result.enhancedPrompt;
        failovers = result.failovers;
        width = result.width;
        height = result.height;
      } else {
        const result = await VideoExecutor.execute(request);
        artifactBuffer = result.buffer;
        mimeType = result.mimeType;
        actualProvider = result.actualProvider;
        actualModel = result.actualModel;
        enhancedPrompt = result.enhancedPrompt;
        videoTechnique = result.videoTechnique;
        failovers = result.failovers;
        width = result.width;
        height = result.height;
        durationSeconds = result.durationSeconds;
      }

      asyncMediaJobManager.updateJobState(job.jobId, "processing", { progress: 75 });

      // 3. Store Artifact via Cloudinary or Universal Artifact Service
      let storageProvider: "cloudinary" | "local_buffer" | "external_cdn" = "local_buffer";
      let deliveryUrl = "";
      let storagePublicId: string | undefined;

      if (cloudinaryMediaStorageService.isConfigured()) {
        try {
          const uploaded = await cloudinaryMediaStorageService.uploadGeneratedMedia(artifactBuffer, {
            resourceType: modality === "video" ? "video" : "image",
            mimeType,
          });
          deliveryUrl = uploaded.secureUrl;
          storageProvider = "cloudinary";
          storagePublicId = uploaded.publicId;
        } catch (storageErr) {
          logger.warn({ err: String(storageErr) }, "Cloudinary upload failed; persisting via universal artifact service");
        }
      }

      if (!deliveryUrl) {
        try {
          const stored = await universalArtifactService.saveArtifact({
            data: artifactBuffer,
            mimeType,
            filename: `generated_${modality}_${Date.now()}.${mimeType.includes("video") ? "mp4" : "png"}`,
            title: `Generated ${modality}: ${request.prompt.slice(0, 30)}`,
            source: request.sourceInterface || "media_engine",
          });
          deliveryUrl = stored.url;
          storageProvider = "local_buffer";
          storagePublicId = stored.id;
        } catch {
          deliveryUrl = `data:${mimeType};base64,${artifactBuffer.toString("base64")}`;
          storageProvider = "local_buffer";
        }
      }

      // 4. Remember in Media Artifact Context
      mediaArtifactContextService.remember({
        type: modality === "video" ? "video" : "image",
        prompt: request.prompt,
        publicUrl: deliveryUrl,
        provider: actualProvider,
        model: actualModel,
        cloudinaryPublicId: storagePublicId,
      });

      // 5. Deduct Quota on successful live run
      if (request.userId) {
        await userTierService.consumeToolQuota(userIdNum, modality === "video" ? "video" : "image").catch(() => {});
      }

      const totalLatency = Date.now() - startTime;

      // 6. Complete Job in State Machine
      const updatedJob = asyncMediaJobManager.updateJobState(job.jobId, "completed", {
        progress: 100,
        actualProvider,
        actualModel,
        videoTechnique,
        enhancedPrompt,
        artifactUrl: deliveryUrl,
        storageProvider,
        storagePublicId,
        width,
        height,
        durationSeconds,
        latencyMs: totalLatency,
        failovers,
      })!;

      updatedJob.quotaDecision = {
        allowed: true,
        remaining: Math.max(0, quotaCheck.remaining - 1),
        dailyLimit: userTier === "vip" ? 999 : userTier === "pro" ? 50 : 5,
        tier: userTier.toUpperCase(),
      };

      return {
        success: true,
        job: updatedJob,
        artifact: {
          buffer: artifactBuffer,
          url: deliveryUrl,
          mimeType,
          width,
          height,
          durationSeconds,
          technique: videoTechnique,
          storageProvider,
        },
        transparency: {
          executionMode: "live",
          isPlannedPrediction: false,
          detectedModality: modality,
          selectedProvider: actualProvider,
          selectedModel: actualModel,
          routingReason: failovers.length > 0 
            ? `Executed via fallback provider (${actualProvider}) after primary failure` 
            : `Executed via dynamically resolved capability (${actualProvider}:${actualModel})`,
          videoTechnique,
          quotaDecision: {
            allowed: true,
            remaining: Math.max(0, quotaCheck.remaining - 1),
            tier: userTier.toUpperCase(),
          },
          latencyMs: totalLatency,
          jobId: updatedJob.jobId,
          jobState: "completed",
          failovers,
          artifactUrl: deliveryUrl,
          storageProvider,
        },
      };
    } catch (execErr: any) {
      const errMsg = execErr?.message || String(execErr);
      logger.error({ error: errMsg, jobId: job.jobId }, "Unified media engine live execution failed");

      const failedJob = asyncMediaJobManager.updateJobState(job.jobId, "failed", {
        errorMessage: errMsg,
        latencyMs: Date.now() - startTime,
      })!;

      return {
        success: false,
        job: failedJob,
        transparency: {
          executionMode: "live",
          isPlannedPrediction: false,
          detectedModality: modality,
          selectedProvider: job.actualProvider || "unknown",
          selectedModel: job.actualModel || "unknown",
          routingReason: "Execution terminated due to fatal provider error",
          quotaDecision: {
            allowed: true,
            remaining: quotaCheck.remaining,
            tier: userTier.toUpperCase(),
          },
          latencyMs: Date.now() - startTime,
          jobId: failedJob.jobId,
          jobState: "failed",
          failovers: failedJob.failovers,
          error: errMsg,
        },
      };
    }
  }
}
