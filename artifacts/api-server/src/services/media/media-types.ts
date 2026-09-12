export type MediaModality = "image" | "video" | "audio";

export type VideoGenerationTechnique =
  | "video_diffusion"
  | "image_sequence_to_video"
  | "synthetic_motion"
  | "fallback";

export type MediaJobState =
  | "queued"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "expired";

export type MediaExecutionMode = "dry_run" | "live";

export interface FailoverRecord {
  primaryProvider: string;
  primaryModel: string;
  errorCategory: "auth_error" | "rate_limit" | "timeout" | "model_unavailable" | "network_error" | "schema_error" | "unknown";
  errorMessage: string;
  httpStatus?: number;
  retryAttempt: number;
  fallbackProvider: string;
  fallbackModel: string;
  fallbackType: "secondary_provider" | "synthetic_motion" | "cached_asset";
  timestamp: string;
}

export interface MediaJob {
  jobId: string;
  modality: MediaModality;
  executionMode: MediaExecutionMode;
  state: MediaJobState;
  progress: number; // 0 to 100
  originalPrompt: string;
  enhancedPrompt: string;
  enhancerModel?: string;
  requestedProvider?: string;
  requestedModel?: string;
  actualProvider: string;
  actualModel: string;
  videoTechnique?: VideoGenerationTechnique;
  userId?: number | string;
  userTier?: "free" | "pro" | "vip";
  quotaDecision?: {
    allowed: boolean;
    remaining: number;
    dailyLimit: number;
    tier: string;
  };
  artifactUrl?: string;
  storageProvider?: "cloudinary" | "local_buffer" | "external_cdn";
  storagePublicId?: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  latencyMs: number;
  failovers: FailoverRecord[];
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  isPlannedPrediction?: boolean;
}

export interface MediaExecutionRequest {
  modality: MediaModality;
  prompt: string;
  executionMode?: MediaExecutionMode; // defaults to 'dry_run' if unspecified in simulator, 'live' in telegram
  userId?: number | string;
  userTier?: "free" | "pro" | "vip";
  providerOverride?: string;
  modelOverride?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  aspectRatio?: "1:1" | "16:9" | "9:16";
  sourceInterface?: "bot_simulator" | "telegram" | "dag_engine" | "media_storage" | "api";
}

export interface MediaExecutionResult {
  success: boolean;
  job: MediaJob;
  artifact?: {
    buffer?: Buffer;
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    technique?: VideoGenerationTechnique;
    storageProvider: "cloudinary" | "local_buffer" | "external_cdn";
  };
  transparency: {
    executionMode: MediaExecutionMode;
    isPlannedPrediction: boolean;
    detectedModality: MediaModality;
    selectedProvider: string;
    selectedModel: string;
    routingReason: string;
    videoTechnique?: VideoGenerationTechnique;
    quotaDecision: {
      allowed: boolean;
      remaining: number;
      tier: string;
    };
    latencyMs: number;
    jobId: string;
    jobState: MediaJobState;
    failovers: FailoverRecord[];
    artifactUrl?: string;
    storageProvider?: string;
    error?: string;
  };
}
