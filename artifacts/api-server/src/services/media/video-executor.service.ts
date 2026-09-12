import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { unifiedModelRegistryService } from "../unified-model-registry.service";
import { huggingFaceCapabilityService } from "../huggingface-capability.service";
import { aiProviderGatewayService } from "../ai-provider-gateway.service";
import { adaptiveAIRouterService } from "../adaptive-ai-router.service";
import { logger } from "../../lib/logger";
import type { FailoverRecord, MediaExecutionRequest, VideoGenerationTechnique } from "./media-types";

const execFileAsync = promisify(execFile);

export interface VideoExecutionOutput {
  buffer: Buffer;
  enhancedPrompt: string;
  enhancerModel?: string;
  actualProvider: string;
  actualModel: string;
  videoTechnique: VideoGenerationTechnique;
  width: number;
  height: number;
  durationSeconds: number;
  mimeType: string;
  failovers: FailoverRecord[];
}

export class VideoExecutor {
  static async enhanceDirectorPrompt(rawPrompt: string): Promise<{ prompt: string; enhancerModel?: string }> {
    const cleaned = rawPrompt.trim();
    if (cleaned.length > 250) {
      return { prompt: cleaned };
    }

    try {
      const routed = await adaptiveAIRouterService.route({
        systemInstruction:
          "You are a cinematic director. Expand this user video concept into a descriptive prompt specifying camera motion (e.g. slow pan, drone flyover), lighting, motion physics, and cinematic mood. Output ONLY the single-paragraph prompt in English. Maximum 45 words. No quotes, no markdown.",
        messages: [{ role: "user", content: `Expand into a cinematic video prompt: "${cleaned}"` }],
        temperature: 0.7,
      });

      const expanded = routed.response?.text?.trim();
      if (expanded && expanded.length > 10 && !expanded.includes("I cannot")) {
        return {
          prompt: expanded,
          enhancerModel: `${routed.candidate.model.provider}:${routed.candidate.model.modelId}`,
        };
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Director prompt expansion failed; using original prompt");
    }

    return { prompt: cleaned };
  }

  static async plan(request: MediaExecutionRequest): Promise<{
    plannedProvider: string;
    plannedModel: string;
    enhancedPrompt: string;
    videoTechnique: VideoGenerationTechnique;
    width: number;
    height: number;
    durationSeconds: number;
    routingReason: string;
  }> {
    const width = request.width || (request.aspectRatio === "9:16" ? 576 : request.aspectRatio === "1:1" ? 768 : 1024);
    const height = request.height || (request.aspectRatio === "9:16" ? 1024 : request.aspectRatio === "1:1" ? 768 : 576);
    const durationSeconds = request.durationSeconds || 4;

    const enhancement = await this.enhanceDirectorPrompt(request.prompt);

    const allModels = await unifiedModelRegistryService.list();
    const primaryVideo = allModels.find((m) => m.enabled && m.roles.includes("primary_video"));

    let plannedProvider = "huggingface";
    let plannedModel = "";
    let routingReason = "";
    let videoTechnique: VideoGenerationTechnique = "video_diffusion";

    if (request.providerOverride && request.providerOverride !== "auto") {
      plannedProvider = request.providerOverride;
      plannedModel = request.modelOverride || "default";
      routingReason = `Explicit user override for provider ${request.providerOverride}`;
    } else if (primaryVideo) {
      plannedProvider = primaryVideo.provider;
      plannedModel = primaryVideo.modelId;
      routingReason = `Primary video role model configured in unified registry (${primaryVideo.name})`;
    } else {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-video");
      plannedModel = capability.model;
      plannedProvider = "huggingface";
      routingReason = capability.discovered
        ? `Dynamic Hugging Face Hub capability discovery (live text-to-video pipeline: ${capability.model})`
        : `Verified text-to-video model pipeline (${capability.model})`;
    }

    return {
      plannedProvider,
      plannedModel,
      enhancedPrompt: enhancement.prompt,
      videoTechnique,
      width,
      height,
      durationSeconds,
      routingReason,
    };
  }

  static async execute(request: MediaExecutionRequest): Promise<VideoExecutionOutput> {
    const planned = await this.plan(request);
    const failovers: FailoverRecord[] = [];

    const width = planned.width;
    const height = planned.height;
    const durationSeconds = planned.durationSeconds;
    const enhancedPrompt = planned.enhancedPrompt;

    let targetProvider = planned.plannedProvider;
    let targetModel = planned.plannedModel;

    // Try direct diffusion or serverless API
    try {
      logger.info({ provider: targetProvider, model: targetModel, prompt: enhancedPrompt }, "Attempting video diffusion execution");
      const videoRes = await aiProviderGatewayService.generateVideo?.(targetProvider as any, {
        model: targetModel,
        prompt: enhancedPrompt,
        width,
        height,
        durationSeconds,
      });

      if (videoRes && videoRes.result?.buffer && videoRes.result.buffer.length > 1024) {
        return {
          buffer: videoRes.result.buffer,
          enhancedPrompt,
          actualProvider: targetProvider,
          actualModel: targetModel,
          videoTechnique: "video_diffusion",
          width,
          height,
          durationSeconds,
          mimeType: "video/mp4",
          failovers,
        };
      }
    } catch (primaryErr: any) {
      const errMsg = primaryErr?.message || String(primaryErr);
      const httpStatus = primaryErr?.status || primaryErr?.statusCode;
      logger.warn({ error: errMsg, provider: targetProvider, model: targetModel }, "Direct video diffusion endpoint unavailable; engaging synthetic motion engine");

      failovers.push({
        primaryProvider: targetProvider,
        primaryModel: targetModel,
        errorCategory: errMsg.includes("401") ? "auth_error" : errMsg.includes("404") ? "model_unavailable" : "timeout",
        errorMessage: errMsg,
        httpStatus,
        retryAttempt: 1,
        fallbackProvider: "local_ffmpeg_engine",
        fallbackModel: "synthetic_motion_renderer",
        fallbackType: "synthetic_motion",
        timestamp: new Date().toISOString(),
      });
    }

    // Step 2: Render high-fidelity keyframe visual asset
    logger.info({ prompt: enhancedPrompt }, "Generating high-definition keyframe for synthetic motion synthesis");
    const imageExecution = await aiProviderGatewayService.generateImage("huggingface" as any, {
      model: "flux-realism-community",
      prompt: `${enhancedPrompt}, cinematic lighting, photorealistic 8k, master composition`,
      width,
      height,
    });

    const frameBuffer = imageExecution.result.buffer;

    // Step 3: Render cinematic dynamic camera movement (synthetic motion) via FFmpeg
    try {
      const videoBuffer = await this.renderCinematicMotion(frameBuffer, durationSeconds, width, height);
      return {
        buffer: videoBuffer,
        enhancedPrompt,
        actualProvider: "local_ffmpeg_engine",
        actualModel: "synthetic_motion_renderer",
        videoTechnique: "synthetic_motion",
        width,
        height,
        durationSeconds,
        mimeType: "video/mp4",
        failovers,
      };
    } catch (ffmpegErr: any) {
      logger.error({ error: String(ffmpegErr) }, "Synthetic motion rendering failed; returning raw fallback video sequence");
      failovers.push({
        primaryProvider: "local_ffmpeg_engine",
        primaryModel: "synthetic_motion_renderer",
        errorCategory: "unknown",
        errorMessage: ffmpegErr?.message || String(ffmpegErr),
        retryAttempt: 2,
        fallbackProvider: "raw_fallback",
        fallbackModel: "fallback_frame_carrier",
        fallbackType: "cached_asset",
        timestamp: new Date().toISOString(),
      });

      return {
        buffer: frameBuffer,
        enhancedPrompt,
        actualProvider: "raw_fallback",
        actualModel: "fallback_frame_carrier",
        videoTechnique: "fallback",
        width,
        height,
        durationSeconds: 1,
        mimeType: "image/jpeg",
        failovers,
      };
    }
  }

  private static async renderCinematicMotion(
    imageBuffer: Buffer,
    durationSeconds: number,
    width: number,
    height: number
  ): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-video-motion-"));
    const inputPath = path.join(tmpDir, "input_keyframe.png");
    const outputPath = path.join(tmpDir, "output_motion.mp4");

    try {
      await fs.writeFile(inputPath, imageBuffer);
      const fps = 24;
      const totalFrames = durationSeconds * fps;

      // Smooth cinematic zoom and pan with motion interpolation
      const filterGraph = `zoompan=z='min(zoom+0.0015,1.15)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},format=yuv420p`;

      await execFileAsync("ffmpeg", [
        "-y",
        "-loop", "1",
        "-i", inputPath,
        "-vf", filterGraph,
        "-t", `${durationSeconds}`,
        "-c:v", "libx264",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outputPath,
      ]);

      const videoBuffer = await fs.readFile(outputPath);
      return videoBuffer;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
