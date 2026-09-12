import { logger } from "../lib/logger";
import { universalArtifactService, type UniversalArtifact } from "./universal-artifact.service";

export type AsyncJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "timed_out";

export interface AsyncVideoJobRecord {
  jobId: string;
  provider: string;
  model: string;
  prompt: string;
  status: AsyncJobStatus;
  progressPercent: number;
  stageMessage: string;
  pollAttempts: number;
  maxPollAttempts: number;
  pollIntervalMs: number;
  timeoutMs: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  artifact?: UniversalArtifact;
  raw?: unknown;
}

export interface CreateAsyncJobParams {
  provider: string;
  model: string;
  prompt: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  timeoutMs?: number;
  sourceNodeId?: string;
  graphId?: string;
  executionId?: string;
  referenceArtifactIds?: string[];
  parameters?: Record<string, unknown>;
}

export class AsyncJobPollerService {
  private static instance: AsyncJobPollerService;
  private readonly jobs = new Map<string, AsyncVideoJobRecord>();
  private readonly MAX_JOBS = 200;

  public static getInstance(): AsyncJobPollerService {
    if (!AsyncJobPollerService.instance) {
      AsyncJobPollerService.instance = new AsyncJobPollerService();
    }
    return AsyncJobPollerService.instance;
  }

  /**
   * Creates and registers a new async job
   */
  createJob(params: CreateAsyncJobParams): AsyncVideoJobRecord {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const record: AsyncVideoJobRecord = {
      jobId,
      provider: params.provider,
      model: params.model,
      prompt: params.prompt,
      status: "queued",
      progressPercent: 0,
      stageMessage: "Job queued in scheduler",
      pollAttempts: 0,
      maxPollAttempts: params.maxPollAttempts || 30,
      pollIntervalMs: params.pollIntervalMs || 2000,
      timeoutMs: params.timeoutMs || 180_000, // 3 mins default
      startedAt: now,
      updatedAt: now,
    };

    if (this.jobs.size >= this.MAX_JOBS) {
      const oldestKey = this.jobs.keys().next().value;
      if (oldestKey) this.jobs.delete(oldestKey);
    }

    this.jobs.set(jobId, record);
    return record;
  }

  getJob(jobId: string): AsyncVideoJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): AsyncVideoJobRecord[] {
    return Array.from(this.jobs.values()).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  listActiveJobs(): AsyncVideoJobRecord[] {
    return this.listJobs().filter((j) => j.status === "queued" || j.status === "processing");
  }

  updateJob(jobId: string, patch: Partial<AsyncVideoJobRecord>): AsyncVideoJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    
    Object.assign(job, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });

    return job;
  }

  /**
   * Executes polling against a generator/worker function with full async lifecycle tracking
   */
  async executeJobWithPolling(
    jobId: string,
    workerFn: (onProgress: (progress: number, stage: string) => void) => Promise<{
      buffer: Buffer;
      url: string;
      mimeType: string;
      metadata?: Record<string, unknown>;
    }>,
    provenanceParams: {
      sourceNodeId?: string;
      graphId?: string;
      executionId?: string;
      planRevision?: number;
      parameters?: Record<string, unknown>;
      referenceArtifactIds?: string[];
    } = {},
  ): Promise<AsyncVideoJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    job.status = "processing";
    job.progressPercent = 10;
    job.stageMessage = "Connecting to provider generation stream";
    job.updatedAt = new Date().toISOString();

    const startTime = Date.now();

    try {
      // Progress reporter callback
      const onProgress = (progress: number, stage: string) => {
        job.pollAttempts++;
        job.progressPercent = Math.min(Math.max(10, Math.round(progress)), 95);
        job.stageMessage = stage;
        job.updatedAt = new Date().toISOString();
        logger.debug({ jobId, progress: job.progressPercent, stage }, "ASYNC_JOB_PROGRESS");
      };

      const result = await workerFn(onProgress);

      const artifact = universalArtifactService.register({
        type: "video",
        mimeType: result.mimeType || "video/mp4",
        uri: result.url,
        publicUrl: result.url,
        sourceNodeId: provenanceParams.sourceNodeId,
        graphId: provenanceParams.graphId,
        planRevision: provenanceParams.planRevision,
        executionId: provenanceParams.executionId,
        metadata: {
          format: result.mimeType,
          fileSizeBytes: result.buffer?.length,
          ...(result.metadata || {}),
        },
        generation: {
          model: job.model,
          provider: job.provider,
          prompt: job.prompt,
          jobId,
          parameters: provenanceParams.parameters || {},
          referenceArtifactIds: provenanceParams.referenceArtifactIds,
          executionDurationMs: Date.now() - startTime,
        },
      });

      job.status = "completed";
      job.progressPercent = 100;
      job.stageMessage = "Video artifact generated and verified";
      job.artifact = artifact;
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;

      logger.info({ jobId, artifactId: artifact.id, durationMs: Date.now() - startTime }, "ASYNC_VIDEO_JOB_COMPLETED");
      return job;
    } catch (err: any) {
      const isTimeout = Date.now() - startTime > job.timeoutMs;
      job.status = isTimeout ? "timed_out" : "failed";
      job.error = err.message || String(err);
      job.stageMessage = `Failed: ${job.error}`;
      job.updatedAt = new Date().toISOString();

      logger.error({ jobId, error: job.error, isTimeout }, "ASYNC_VIDEO_JOB_FAILED");
      throw err;
    }
  }
}

export const asyncJobPollerService = AsyncJobPollerService.getInstance();
