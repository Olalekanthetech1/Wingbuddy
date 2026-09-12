import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import type { MediaJob, MediaJobState, MediaModality, VideoGenerationTechnique, FailoverRecord } from "./media-types";

class AsyncMediaJobManagerService {
  private jobs = new Map<string, MediaJob>();
  private readonly maxRetainedJobs = 200;

  createJob(params: {
    modality: MediaModality;
    executionMode: "dry_run" | "live";
    originalPrompt: string;
    enhancedPrompt: string;
    actualProvider: string;
    actualModel: string;
    requestedProvider?: string;
    requestedModel?: string;
    userId?: number | string;
    userTier?: "free" | "pro" | "vip";
    mimeType: string;
    videoTechnique?: VideoGenerationTechnique;
    isPlannedPrediction?: boolean;
  }): MediaJob {
    const jobId = `job_${params.modality}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const job: MediaJob = {
      jobId,
      modality: params.modality,
      executionMode: params.executionMode,
      state: params.executionMode === "dry_run" ? "completed" : "queued",
      progress: params.executionMode === "dry_run" ? 100 : 5,
      originalPrompt: params.originalPrompt,
      enhancedPrompt: params.enhancedPrompt,
      requestedProvider: params.requestedProvider,
      requestedModel: params.requestedModel,
      actualProvider: params.actualProvider,
      actualModel: params.actualModel,
      videoTechnique: params.videoTechnique,
      userId: params.userId,
      userTier: params.userTier,
      mimeType: params.mimeType,
      latencyMs: 0,
      failovers: [],
      createdAt: now,
      updatedAt: now,
      completedAt: params.executionMode === "dry_run" ? now : undefined,
      isPlannedPrediction: params.isPlannedPrediction ?? (params.executionMode === "dry_run"),
    };

    this.jobs.set(jobId, job);
    this.trimOldJobs();
    logger.info({ jobId, modality: params.modality, mode: params.executionMode, state: job.state }, "Media job created in state machine");
    return job;
  }

  updateJobState(
    jobId: string,
    state: MediaJobState,
    updates: Partial<Omit<MediaJob, "jobId" | "createdAt">> = {}
  ): MediaJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn({ jobId }, "Attempted to update non-existent media job");
      return undefined;
    }

    job.state = state;
    job.updatedAt = new Date().toISOString();

    if (updates.progress !== undefined) job.progress = updates.progress;
    if (updates.artifactUrl !== undefined) job.artifactUrl = updates.artifactUrl;
    if (updates.storageProvider !== undefined) job.storageProvider = updates.storageProvider;
    if (updates.storagePublicId !== undefined) job.storagePublicId = updates.storagePublicId;
    if (updates.actualProvider !== undefined) job.actualProvider = updates.actualProvider;
    if (updates.actualModel !== undefined) job.actualModel = updates.actualModel;
    if (updates.videoTechnique !== undefined) job.videoTechnique = updates.videoTechnique;
    if (updates.width !== undefined) job.width = updates.width;
    if (updates.height !== undefined) job.height = updates.height;
    if (updates.durationSeconds !== undefined) job.durationSeconds = updates.durationSeconds;
    if (updates.latencyMs !== undefined) job.latencyMs = updates.latencyMs;
    if (updates.errorMessage !== undefined) job.errorMessage = updates.errorMessage;

    if (updates.failovers && updates.failovers.length > 0) {
      job.failovers.push(...updates.failovers);
    }

    if (state === "completed" || state === "failed" || state === "timed_out" || state === "cancelled") {
      job.completedAt = new Date().toISOString();
      if (state === "completed" && job.progress < 100) {
        job.progress = 100;
      }
    }

    this.jobs.set(jobId, job);
    logger.info({ jobId, state, progress: job.progress, videoTechnique: job.videoTechnique }, "Media job state updated");
    return job;
  }

  recordFailover(jobId: string, failover: FailoverRecord): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.failovers.push(failover);
      job.updatedAt = new Date().toISOString();
      logger.warn({ jobId, failover }, "Failover recorded in media job");
    }
  }

  getJob(jobId: string): MediaJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(options: { modality?: MediaModality; limit?: number; userId?: number | string } = {}): MediaJob[] {
    let result = Array.from(this.jobs.values());
    if (options.modality) {
      result = result.filter((j) => j.modality === options.modality);
    }
    if (options.userId) {
      result = result.filter((j) => j.userId === options.userId);
    }
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }
    return result;
  }

  private trimOldJobs(): void {
    if (this.jobs.size > this.maxRetainedJobs) {
      const sorted = Array.from(this.jobs.entries()).sort(
        ([, a], [, b]) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const toDelete = sorted.slice(0, this.jobs.size - this.maxRetainedJobs);
      for (const [id] of toDelete) {
        this.jobs.delete(id);
      }
    }
  }
}

export const asyncMediaJobManager = new AsyncMediaJobManagerService();
