import { db, getPool, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import { apiKeyPoolService } from "./api-key-pool.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { huggingFaceCapabilityService } from "./huggingface-capability.service";
import { cloudinaryMediaAdminService } from "./cloudinary-media-admin.service";
import { asyncMediaJobManager } from "./media/async-media-job-manager.service";
import { userTierService } from "./user-tier.service";
import { VideoExecutor } from "./media/video-executor.service";
import { ImageExecutor } from "./media/image-executor.service";
import { telegramRuntime } from "../app";
import type { MediaJob, MediaModality } from "./media/media-types";

export type DiagnosticErrorCategory =
  | "credential_missing"
  | "billing_quota_exhausted"
  | "capability_not_enabled"
  | "cluster_busy"
  | "endpoint_unreachable"
  | "unknown";

export interface CategorizedDiagnosticError {
  category: DiagnosticErrorCategory;
  code: string;
  title: string;
  badge: string;
  description: string;
  recommendation: string;
  remediationTab?: string;
  rawError: string;
  httpStatus?: number;
}

export interface ProviderHealthDetail {
  providerId: string;
  name: string;
  status: "healthy" | "warning" | "down" | "unconfigured";
  configured: boolean;
  activeKeys: number;
  totalKeys: number;
  inCooldownKeys: number;
  latencyMs?: number;
  lastCheckedAt: string;
  activeModel?: string;
  quotaStatus?: string;
  rateLimitStatus?: string;
  capabilities: string[];
  lastError?: CategorizedDiagnosticError;
  metadata?: Record<string, unknown>;
}

export interface SystemHealthMatrix {
  overallStatus: "HEALTHY" | "DEGRADED" | "CRITICAL";
  timestamp: string;
  uptimeSeconds: number;
  providers: Record<string, ProviderHealthDetail>;
  activeAlerts: Array<{
    severity: "high" | "medium" | "info";
    title: string;
    message: string;
    category: DiagnosticErrorCategory;
    recommendation: string;
    remediationTab?: string;
  }>;
  summary: {
    totalProviders: number;
    healthyCount: number;
    warningCount: number;
    downCount: number;
    unconfiguredCount: number;
  };
}

export interface ProbeResult {
  probeId: string;
  target: string;
  modality: string;
  status: "PASSED" | "FAILED" | "WARNING";
  latencyMs: number;
  timestamp: string;
  details?: Record<string, unknown>;
  outputSnippet?: string;
  error?: CategorizedDiagnosticError;
}

export interface SimulationStep {
  phase: string;
  name: string;
  status: "passed" | "failed" | "warning" | "skipped";
  durationMs: number;
  summary: string;
  data?: Record<string, unknown>;
  error?: CategorizedDiagnosticError;
}

export interface PipelineSimulationResult {
  simulationId: string;
  modality: "image" | "video";
  originalPrompt: string;
  enhancedPrompt: string;
  success: boolean;
  totalDurationMs: number;
  overallStatus: "SUCCESS" | "DEGRADED" | "FAILED";
  plannedProvider: string;
  plannedModel: string;
  quotaAllowed: boolean;
  steps: SimulationStep[];
}

export interface HistoricalTrendsSummary {
  period: "24h";
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  successRatePercent: number;
  averageLatencyMs: number;
  failoversRecorded: number;
  byModality: Record<string, { total: number; completed: number; failed: number }>;
  byErrorCategory: Record<DiagnosticErrorCategory, number>;
  recentAlertCount: number;
}

export class DiagnosticsService {
  private lastProbeCache = new Map<string, ProbeResult>();
  private probeHistory: ProbeResult[] = [];

  /**
   * Categorize any runtime, provider, or network error into standardized diagnostic taxonomy.
   */
  classifyError(
    error: unknown,
    context: { provider?: string; modality?: string; httpStatus?: number; endpoint?: string } = {}
  ): CategorizedDiagnosticError {
    const rawError = error instanceof Error ? error.message : String(error ?? "Unknown error");
    const lower = rawError.toLowerCase();
    const httpStatus = context.httpStatus;

    // 1. Missing credentials / auth errors
    if (
      lower.includes("hf_token unavailable") ||
      lower.includes("no api key is configured") ||
      lower.includes("api key is required") ||
      lower.includes("missing elevenlabs api key") ||
      lower.includes("cloudinary is not configured") ||
      lower.includes("invalid api key") ||
      lower.includes("invalid hugging face token") ||
      lower.includes("unauthorized") ||
      lower.includes("not configured") ||
      httpStatus === 401
    ) {
      const isHf = context.provider === "huggingface" || lower.includes("hf_token");
      const isGemini = context.provider === "gemini" || lower.includes("gemini");
      const isCloudinary = context.provider === "cloudinary" || lower.includes("cloudinary");

      return {
        category: "credential_missing",
        code: "CREDENTIAL_MISSING",
        title: "Missing or Invalid API Credential",
        badge: "🔑 Credential Missing",
        description: isHf
          ? "The Hugging Face API token (HF_TOKEN) is not configured or lacks authorization for model inference."
          : isGemini
          ? "No healthy Google Gemini API key is currently available in the active key pool."
          : isCloudinary
          ? "Cloudinary credentials (CLOUDINARY_URL or Cloud Name / Key / Secret) are not configured."
          : `API credentials for ${context.provider || "provider"} are missing or rejected.`,
        recommendation: isHf
          ? "Add your HF_TOKEN in AI Models → Provider API Keys or via the environment variables. Ensure the token has Inference API permissions."
          : isGemini
          ? "Add a valid Gemini API key in AI Models → Managed Key Registry."
          : isCloudinary
          ? "Navigate to Media & Storage to configure and test Cloudinary credentials."
          : "Register a valid API token in the appropriate dashboard configuration tab.",
        remediationTab: isHf ? "models" : isCloudinary ? "media-storage" : "models",
        rawError,
        httpStatus: httpStatus || 401,
      };
    }

    // 2. Billing / Quota / Rate limit exhausted
    if (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("quota") ||
      lower.includes("resource_exhausted") ||
      lower.includes("billing") ||
      lower.includes("credit") ||
      httpStatus === 429
    ) {
      return {
        category: "billing_quota_exhausted",
        code: "QUOTA_EXHAUSTED",
        title: "Provider Rate Limit or Quota Exhausted",
        badge: "💳 Quota Exhausted",
        description: "The AI provider returned HTTP 429 or reported that the quota/credit allowance for this token has been exhausted.",
        recommendation: "Add additional backup API keys to the rotation pool for automatic failover, or upgrade the provider plan tier.",
        remediationTab: "models",
        rawError,
        httpStatus: httpStatus || 429,
      };
    }

    // 3. Cluster busy / Model loading (Hugging Face cold start)
    if (
      lower.includes("503") ||
      lower.includes("cluster busy") ||
      lower.includes("high demand") ||
      lower.includes("currently loading") ||
      lower.includes("estimated_time") ||
      httpStatus === 503
    ) {
      return {
        category: "cluster_busy",
        code: "CLUSTER_LOAD_WAIT",
        title: "Inference Cluster Warmup or High Demand",
        badge: "⏳ Cluster Busy",
        description: "The model inference server is cold-starting or the provider GPU cluster is currently processing high queue volume.",
        recommendation: "The bot automatically queues or retries within 30-60 seconds. Alternatively, select an active warm model.",
        remediationTab: "models",
        rawError,
        httpStatus: httpStatus || 503,
      };
    }

    // 4. Capability not enabled / Model allowlist / Access restrictions
    if (
      lower.includes("403") ||
      lower.includes("404") ||
      lower.includes("forbidden") ||
      lower.includes("not found on hugging face") ||
      lower.includes("not supported") ||
      lower.includes("allowlist") ||
      lower.includes("not authorized") ||
      lower.includes("permission") ||
      httpStatus === 403 ||
      httpStatus === 404
    ) {
      return {
        category: "capability_not_enabled",
        code: "CAPABILITY_UNAUTHORIZED",
        title: "Model Capability or Access Not Enabled",
        badge: "⚙️ Capability Not Enabled",
        description: "The requested model repository either does not exist, has restricted access requiring agreement acceptance on Hugging Face, or requires project allowlisting.",
        recommendation: "Visit the model card on Hugging Face (or Google Vertex AI console) and agree to terms/enable access, or select a discovered public pipeline.",
        remediationTab: "models",
        rawError,
        httpStatus: httpStatus || (lower.includes("404") ? 404 : 403),
      };
    }

    // 5. Network / Timeout / DNS
    if (
      lower.includes("timeout") ||
      lower.includes("etimedout") ||
      lower.includes("econnrefused") ||
      lower.includes("fetch failed") ||
      lower.includes("socket") ||
      lower.includes("enotfound") ||
      lower.includes("network error")
    ) {
      return {
        category: "endpoint_unreachable",
        code: "ENDPOINT_UNREACHABLE",
        title: "Network Connection Timeout",
        badge: "🌐 Endpoint Unreachable",
        description: "Connection to the provider endpoint timed out or failed to establish a network handshake.",
        recommendation: "Verify outbound internet reachability or check the provider's status page for transient network incidents.",
        rawError,
      };
    }

    // Default fallback category
    return {
      category: "unknown",
      code: "PROVIDER_ERROR",
      title: "Provider Execution Error",
      badge: "⚠️ Provider Error",
      description: "An unexpected error occurred during provider execution.",
      recommendation: "Inspect the raw error logs or check provider dashboard for operational status.",
      rawError,
      httpStatus,
    };
  }

  /**
   * Build complete live health matrix across all AI models, storage, bot runtime, and DB.
   */
  async getSystemHealthMatrix(): Promise<SystemHealthMatrix> {
    const now = new Date().toISOString();
    const providers: Record<string, ProviderHealthDetail> = {};
    const activeAlerts: SystemHealthMatrix["activeAlerts"] = [];

    // 1. Google Gemini Provider
    try {
      const geminiSummary = apiKeyPoolService.getSummary();
      const primaryModel = process.env.GEMINI_MODEL || process.env.GEMINI_DEFAULT_MODEL || "gemini-2.5-flash";
      const totalKeys = geminiSummary.totalKeys || 0;
      const healthyKeys = geminiSummary.healthyKeys || 0;
      const cooldownKeys = (geminiSummary.keys || []).filter((k) => k.status === "cooldown").length;

      let status: ProviderHealthDetail["status"] = "unconfigured";
      if (totalKeys === 0) {
        status = "unconfigured";
        activeAlerts.push({
          severity: "high",
          title: "Gemini Key Missing",
          message: "No Google Gemini API keys are configured. Conversational reasoning and text operations are offline.",
          category: "credential_missing",
          recommendation: "Add a GEMINI_API_KEY in the Managed Key Registry.",
          remediationTab: "models",
        });
      } else if (healthyKeys === 0) {
        status = "down";
        activeAlerts.push({
          severity: "high",
          title: "All Gemini Keys in Cooldown",
          message: "All registered Gemini API keys are currently exhausted or experiencing rate-limits.",
          category: "billing_quota_exhausted",
          recommendation: "Add backup API keys to the pool or await automatic cooldown reset.",
          remediationTab: "models",
        });
      } else if (cooldownKeys > 0) {
        status = "warning";
      } else {
        status = "healthy";
      }

      providers.gemini = {
        providerId: "gemini",
        name: "Google Gemini",
        status,
        configured: totalKeys > 0,
        activeKeys: healthyKeys,
        totalKeys,
        inCooldownKeys: cooldownKeys,
        activeModel: primaryModel,
        lastCheckedAt: now,
        quotaStatus: `${healthyKeys}/${totalKeys} Keys Operational`,
        rateLimitStatus: cooldownKeys > 0 ? `${cooldownKeys} in cooldown` : "Normal",
        capabilities: ["chat", "streaming", "reasoning", "vision", "web_search", "long_context"],
      };
    } catch (err) {
      providers.gemini = {
        providerId: "gemini",
        name: "Google Gemini",
        status: "down",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["chat"],
        lastError: this.classifyError(err, { provider: "gemini" }),
      };
    }

    // 2. Hugging Face Multimodal Provider (Images & Video)
    try {
      await aiProviderKeyPoolService.hydrateProvider("huggingface", "HF_TOKEN");
      const hfSummary = aiProviderKeyPoolService.getSummary("huggingface");
      const totalKeys = hfSummary.totalKeys || 0;
      const healthyKeys = hfSummary.healthyKeys || 0;
      const envTokenPresent = Boolean(process.env.HF_TOKEN?.trim());
      const isConfigured = totalKeys > 0 || envTokenPresent;

      let imageModel = "black-forest-labs/FLUX.1-schnell";
      let videoModel = "damo-vilab/text-to-video-ms-1.7b";

      try {
        const imgCap = await huggingFaceCapabilityService.resolveModel("text-to-image");
        if (imgCap.model) imageModel = imgCap.model;
        const vidCap = await huggingFaceCapabilityService.resolveModel("text-to-video");
        if (vidCap.model) videoModel = vidCap.model;
      } catch {}

      let status: ProviderHealthDetail["status"] = "unconfigured";
      if (!isConfigured) {
        status = "warning";
        activeAlerts.push({
          severity: "medium",
          title: "Video Diffusion Unconfigured",
          message: "HF_TOKEN is missing. Authentic generative video requests will be rejected with quota protection.",
          category: "credential_missing",
          recommendation: "Add a free Hugging Face token in Provider API Keys to unlock high-fidelity AI video generation.",
          remediationTab: "models",
        });
      } else if (healthyKeys === 0 && totalKeys > 0) {
        status = "down";
        activeAlerts.push({
          severity: "high",
          title: "Hugging Face Tokens Rate-Limited",
          message: "All configured HF tokens are currently rate-limited.",
          category: "billing_quota_exhausted",
          recommendation: "Rotate Hugging Face tokens or upgrade inference limits.",
          remediationTab: "models",
        });
      } else {
        status = "healthy";
      }

      providers.huggingface = {
        providerId: "huggingface",
        name: "Hugging Face Diffusion",
        status,
        configured: isConfigured,
        activeKeys: isConfigured ? Math.max(1, healthyKeys) : 0,
        totalKeys: Math.max(isConfigured ? 1 : 0, totalKeys),
        inCooldownKeys: hfSummary.inCooldownKeys || 0,
        activeModel: `${imageModel} (Img) · ${videoModel} (Vid)`,
        lastCheckedAt: now,
        quotaStatus: isConfigured ? "Token Registered" : "Token Missing",
        rateLimitStatus: isConfigured ? "Ready" : "Inactive",
        capabilities: ["image_generation", "video_generation", "chat"],
        metadata: { imageModel, videoModel },
      };
    } catch (err) {
      providers.huggingface = {
        providerId: "huggingface",
        name: "Hugging Face Diffusion",
        status: "warning",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["image_generation", "video_generation"],
        lastError: this.classifyError(err, { provider: "huggingface" }),
      };
    }

    // 3. ElevenLabs Audio & Sound Generation
    try {
      await aiProviderKeyPoolService.hydrateProvider("elevenlabs", "ELEVENLABS_API_KEY");
      const elSummary = aiProviderKeyPoolService.getSummary("elevenlabs");
      const envToken = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
      const isConfigured = elSummary.totalKeys > 0 || envToken;

      providers.elevenlabs = {
        providerId: "elevenlabs",
        name: "ElevenLabs Voice & Sound",
        status: isConfigured ? (elSummary.healthyKeys > 0 || envToken ? "healthy" : "down") : "unconfigured",
        configured: isConfigured,
        activeKeys: isConfigured ? Math.max(1, elSummary.healthyKeys) : 0,
        totalKeys: Math.max(isConfigured ? 1 : 0, elSummary.totalKeys),
        inCooldownKeys: elSummary.inCooldownKeys || 0,
        activeModel: "elevenlabs-sound-effects",
        lastCheckedAt: now,
        capabilities: ["audio_generation", "sound_generation", "text_to_speech"],
      };
    } catch {
      providers.elevenlabs = {
        providerId: "elevenlabs",
        name: "ElevenLabs Voice & Sound",
        status: "unconfigured",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["audio_generation"],
      };
    }

    // 4. Cloudinary Media Storage & CDN
    try {
      const cloudStatus = await cloudinaryMediaAdminService.getStatus();
      let status: ProviderHealthDetail["status"] = "unconfigured";
      if (cloudStatus.healthy) {
        status = "healthy";
      } else if (cloudStatus.configured) {
        status = "warning";
        activeAlerts.push({
          severity: "medium",
          title: "Cloudinary Validation Failed",
          message: cloudStatus.error || "Unable to authenticate with Cloudinary admin API.",
          category: "credential_missing",
          recommendation: "Re-verify your Cloudinary Cloud Name, API Key, and Secret in Media & Storage.",
          remediationTab: "media-storage",
        });
      } else {
        status = "unconfigured";
        activeAlerts.push({
          severity: "info",
          title: "Cloudinary Unconfigured",
          message: "Cloud storage is not connected. Media files will be delivered as in-memory buffers without persistent CDN hosting.",
          category: "credential_missing",
          recommendation: "Connect a free Cloudinary account in Media & Storage for permanent video & image CDN hosting.",
          remediationTab: "media-storage",
        });
      }

      providers.cloudinary = {
        providerId: "cloudinary",
        name: "Cloudinary Media Cloud",
        status,
        configured: cloudStatus.configured,
        activeKeys: cloudStatus.healthy ? 1 : 0,
        totalKeys: cloudStatus.configured ? 1 : 0,
        inCooldownKeys: 0,
        activeModel: cloudStatus.cloudName || "Not configured",
        lastCheckedAt: now,
        capabilities: cloudStatus.capabilities || ["image_storage", "video_storage"],
        quotaStatus: cloudStatus.healthy ? "Connected" : "Unconnected",
      };
    } catch (err) {
      providers.cloudinary = {
        providerId: "cloudinary",
        name: "Cloudinary Media Cloud",
        status: "unconfigured",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["image_storage", "video_storage"],
        lastError: this.classifyError(err, { provider: "cloudinary" }),
      };
    }

    // 5. Telegram Bot Gateway
    try {
      const bot = telegramRuntime.bot;
      const botTokenSet = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
      let botUsername = "—";
      let status: ProviderHealthDetail["status"] = "unconfigured";

      if (!botTokenSet) {
        status = "unconfigured";
        activeAlerts.push({
          severity: "high",
          title: "Telegram Bot Token Missing",
          message: "TELEGRAM_BOT_TOKEN is not set. Bot update listener is inactive.",
          category: "credential_missing",
          recommendation: "Set TELEGRAM_BOT_TOKEN in system environment variables.",
        });
      } else if (bot) {
        status = "healthy";
        try {
          const me = await bot.api.getMe();
          botUsername = `@${me.username}`;
        } catch {
          botUsername = "Active (polling/webhook)";
        }
      } else {
        status = "warning";
      }

      providers.telegram = {
        providerId: "telegram",
        name: "Telegram Bot Gateway",
        status,
        configured: botTokenSet,
        activeKeys: botTokenSet ? 1 : 0,
        totalKeys: 1,
        inCooldownKeys: 0,
        activeModel: botUsername,
        lastCheckedAt: now,
        capabilities: ["bot_messages", "inline_queries", "media_delivery", "reactions"],
        rateLimitStatus: "Optimal",
      };
    } catch (err) {
      providers.telegram = {
        providerId: "telegram",
        name: "Telegram Bot Gateway",
        status: "down",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["bot_messages"],
        lastError: this.classifyError(err, { provider: "telegram" }),
      };
    }

    // 6. PostgreSQL Database
    try {
      const dbStart = Date.now();
      await db.execute(sql`SELECT 1 as ping`);
      const latencyMs = Date.now() - dbStart;
      const pool = getPool();

      providers.postgres = {
        providerId: "postgres",
        name: "PostgreSQL Database",
        status: "healthy",
        configured: true,
        activeKeys: 1,
        totalKeys: 1,
        inCooldownKeys: 0,
        latencyMs,
        activeModel: "PostgreSQL with Drizzle ORM",
        lastCheckedAt: now,
        capabilities: ["durable_sessions", "user_tiers", "memory_pgvector", "media_jobs"],
        metadata: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
        },
      };
    } catch (err) {
      providers.postgres = {
        providerId: "postgres",
        name: "PostgreSQL Database",
        status: "down",
        configured: false,
        activeKeys: 0,
        totalKeys: 0,
        inCooldownKeys: 0,
        lastCheckedAt: now,
        capabilities: ["durable_sessions"],
        lastError: this.classifyError(err, { provider: "postgres" }),
      };
      activeAlerts.push({
        severity: "high",
        title: "Database Unreachable",
        message: "Unable to query PostgreSQL database connection pool.",
        category: "endpoint_unreachable",
        recommendation: "Verify DATABASE_URL connectivity.",
      });
    }

    // Compute Summary counts
    const providerList = Object.values(providers);
    const healthyCount = providerList.filter((p) => p.status === "healthy").length;
    const warningCount = providerList.filter((p) => p.status === "warning").length;
    const downCount = providerList.filter((p) => p.status === "down").length;
    const unconfiguredCount = providerList.filter((p) => p.status === "unconfigured").length;

    let overallStatus: SystemHealthMatrix["overallStatus"] = "HEALTHY";
    if (downCount > 0 || providers.gemini?.status === "down" || providers.postgres?.status === "down") {
      overallStatus = "CRITICAL";
    } else if (warningCount > 0 || unconfiguredCount > 0) {
      overallStatus = "DEGRADED";
    }

    return {
      overallStatus,
      timestamp: now,
      uptimeSeconds: Math.round(process.uptime()),
      providers,
      activeAlerts,
      summary: {
        totalProviders: providerList.length,
        healthyCount,
        warningCount,
        downCount,
        unconfiguredCount,
      },
    };
  }

  /**
   * Run targeted probe with millisecond latency measurement.
   */
  async runProbe(probeId: string): Promise<ProbeResult> {
    const timestamp = new Date().toISOString();
    const start = Date.now();

    try {
      switch (probeId) {
        case "gemini":
        case "text": {
          const primaryModel = process.env.GEMINI_MODEL || process.env.GEMINI_DEFAULT_MODEL || "gemini-2.5-flash";
          const res = await aiProviderGatewayService.chat("gemini", {
            model: primaryModel,
            messages: [{ role: "user", content: "Ping: Respond with 1 word 'Operational'." }],
            maxOutputTokens: 5,
            temperature: 0,
          });
          const latencyMs = Date.now() - start;
          const result: ProbeResult = {
            probeId: "gemini",
            target: "Google Gemini Reasoning",
            modality: "text",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { model: res.model, provider: res.provider },
            outputSnippet: res.result.text?.trim()?.slice(0, 100) || "Operational",
          };
          this.recordProbeResult(result);
          return result;
        }

        case "huggingface_image":
        case "image": {
          const capability = await huggingFaceCapabilityService.resolveModel("text-to-image");
          const targetModel = capability.model || "black-forest-labs/FLUX.1-schnell";
          const res = await aiProviderGatewayService.test("huggingface", targetModel);
          const latencyMs = Date.now() - start;

          if (!res.ok) {
            const categorized = this.classifyError(res.error, { provider: "huggingface", modality: "image" });
            const result: ProbeResult = {
              probeId: "huggingface_image",
              target: `Hugging Face Image Pipeline (${targetModel})`,
              modality: "image",
              status: "FAILED",
              latencyMs,
              timestamp,
              error: categorized,
              details: { model: targetModel, discovered: capability.discovered },
            };
            this.recordProbeResult(result);
            return result;
          }

          const result: ProbeResult = {
            probeId: "huggingface_image",
            target: `Hugging Face Image Pipeline (${targetModel})`,
            modality: "image",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { model: targetModel, discovered: capability.discovered },
            outputSnippet: `Model active & responsive (${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        case "huggingface_video":
        case "video": {
          // Probe authentic video generation capability
          const capability = await huggingFaceCapabilityService.resolveModel("text-to-video");
          const targetModel = capability.model || "damo-vilab/text-to-video-ms-1.7b";
          const hfToken = process.env.HF_TOKEN?.trim();

          if (!hfToken && aiProviderKeyPoolService.getSummary("huggingface").totalKeys === 0) {
            const categorized: CategorizedDiagnosticError = {
              category: "credential_missing",
              code: "HF_TOKEN_MISSING",
              title: "Hugging Face Token Not Configured",
              badge: "🔑 Credential Missing",
              description: "HF_TOKEN is missing. Generative video diffusion requires an authorized Hugging Face API token.",
              recommendation: "Navigate to AI Models → Provider API Keys to input your Hugging Face Access Token with Inference API permission.",
              remediationTab: "models",
              rawError: "HF_TOKEN unavailable and authentic text-to-video diffusion is required (synthetic motion fallback disabled)",
              httpStatus: 401,
            };
            const result: ProbeResult = {
              probeId: "huggingface_video",
              target: `Hugging Face Video Pipeline (${targetModel})`,
              modality: "video",
              status: "FAILED",
              latencyMs: Date.now() - start,
              timestamp,
              error: categorized,
              details: { model: targetModel, discovered: capability.discovered },
            };
            this.recordProbeResult(result);
            return result;
          }

          const res = await aiProviderGatewayService.test("huggingface", targetModel);
          const latencyMs = Date.now() - start;

          if (!res.ok) {
            const categorized = this.classifyError(res.error, { provider: "huggingface", modality: "video" });
            const result: ProbeResult = {
              probeId: "huggingface_video",
              target: `Hugging Face Video Pipeline (${targetModel})`,
              modality: "video",
              status: "FAILED",
              latencyMs,
              timestamp,
              error: categorized,
              details: { model: targetModel, discovered: capability.discovered },
            };
            this.recordProbeResult(result);
            return result;
          }

          const result: ProbeResult = {
            probeId: "huggingface_video",
            target: `Hugging Face Video Pipeline (${targetModel})`,
            modality: "video",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { model: targetModel, discovered: capability.discovered },
            outputSnippet: `Video diffusion endpoint ready (${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        case "elevenlabs":
        case "voice": {
          const res = await aiProviderGatewayService.test("elevenlabs", "elevenlabs-sound-effects");
          const latencyMs = Date.now() - start;

          if (!res.ok) {
            const categorized = this.classifyError(res.error, { provider: "elevenlabs", modality: "audio" });
            const result: ProbeResult = {
              probeId: "elevenlabs",
              target: "ElevenLabs Sound Effects & TTS",
              modality: "audio",
              status: "FAILED",
              latencyMs,
              timestamp,
              error: categorized,
            };
            this.recordProbeResult(result);
            return result;
          }

          const result: ProbeResult = {
            probeId: "elevenlabs",
            target: "ElevenLabs Sound Effects & TTS",
            modality: "audio",
            status: "PASSED",
            latencyMs,
            timestamp,
            outputSnippet: `ElevenLabs API operational (${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        case "cloudinary":
        case "storage": {
          const overview = await cloudinaryMediaAdminService.getOverview();
          const latencyMs = Date.now() - start;

          if (!overview.configured) {
            const categorized: CategorizedDiagnosticError = {
              category: "credential_missing",
              code: "CLOUDINARY_UNCONFIGURED",
              title: "Cloudinary Not Configured",
              badge: "🔑 Credential Missing",
              description: "Cloudinary URL or Cloud Name + Secret credentials are not set.",
              recommendation: "Configure Cloudinary credentials in Media & Storage to enable CDN asset delivery.",
              remediationTab: "media-storage",
              rawError: "Cloudinary is not configured",
            };
            const result: ProbeResult = {
              probeId: "cloudinary",
              target: "Cloudinary Media Cloud & CDN",
              modality: "storage",
              status: "FAILED",
              latencyMs,
              timestamp,
              error: categorized,
            };
            this.recordProbeResult(result);
            return result;
          }

          const result: ProbeResult = {
            probeId: "cloudinary",
            target: "Cloudinary Media Cloud & CDN",
            modality: "storage",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { totals: overview.totals },
            outputSnippet: `Operational · ${overview.totals?.total ?? 0} media assets in cloud (${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        case "telegram":
        case "bot": {
          const bot = telegramRuntime.bot;
          if (!bot) {
            const categorized: CategorizedDiagnosticError = {
              category: "credential_missing",
              code: "BOT_NOT_INITIALIZED",
              title: "Telegram Bot Not Initialized",
              badge: "🔑 Credential Missing",
              description: "The Telegram bot runtime is not active or TELEGRAM_BOT_TOKEN is unset.",
              recommendation: "Check TELEGRAM_BOT_TOKEN in environment configuration.",
              rawError: "Telegram bot instance not initialized",
            };
            const result: ProbeResult = {
              probeId: "telegram",
              target: "Telegram Bot API",
              modality: "bot",
              status: "FAILED",
              latencyMs: Date.now() - start,
              timestamp,
              error: categorized,
            };
            this.recordProbeResult(result);
            return result;
          }

          const me = await bot.api.getMe();
          const latencyMs = Date.now() - start;
          const result: ProbeResult = {
            probeId: "telegram",
            target: "Telegram Bot API",
            modality: "bot",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { id: me.id, username: me.username, isBot: me.is_bot },
            outputSnippet: `@${me.username} online · ID: ${me.id} (${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        case "postgres":
        case "database": {
          await db.execute(sql`SELECT 1 as ping`);
          const latencyMs = Date.now() - start;
          const pool = getPool();
          const result: ProbeResult = {
            probeId: "postgres",
            target: "PostgreSQL Database Pool",
            modality: "database",
            status: "PASSED",
            latencyMs,
            timestamp,
            details: { totalCount: pool.totalCount, idleCount: pool.idleCount },
            outputSnippet: `Pool active (${pool.idleCount}/${pool.totalCount} idle/total, ${latencyMs}ms)`,
          };
          this.recordProbeResult(result);
          return result;
        }

        default:
          throw new Error(`Unrecognized probe identifier: ${probeId}`);
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const categorized = this.classifyError(err, { provider: probeId });
      const result: ProbeResult = {
        probeId,
        target: probeId,
        modality: "unknown",
        status: "FAILED",
        latencyMs,
        timestamp,
        error: categorized,
      };
      this.recordProbeResult(result);
      return result;
    }
  }

  /**
   * Run all diagnostics probes simultaneously.
   */
  async runAllProbes(): Promise<Record<string, ProbeResult>> {
    const probeIds = ["gemini", "huggingface_image", "huggingface_video", "elevenlabs", "cloudinary", "telegram", "postgres"];
    const results: Record<string, ProbeResult> = {};

    const settled = await Promise.allSettled(probeIds.map((id) => this.runProbe(id)));
    settled.forEach((res, i) => {
      const id = probeIds[i];
      if (res.status === "fulfilled") {
        results[id] = res.value;
      } else {
        results[id] = {
          probeId: id,
          target: id,
          modality: "unknown",
          status: "FAILED",
          latencyMs: 0,
          timestamp: new Date().toISOString(),
          error: this.classifyError(res.reason, { provider: id }),
        };
      }
    });

    return results;
  }

  /**
   * End-to-End Dry-Run Simulation: traces prompt analysis, model routing, user quota checking,
   * credential readiness, and CDN storage pre-flight without consuming live generation budget.
   */
  async simulatePipeline(prompt: string, modality: "image" | "video"): Promise<PipelineSimulationResult> {
    const simulationId = `sim_${modality}_${Date.now().toString(36)}`;
    const overallStart = Date.now();
    const steps: SimulationStep[] = [];

    let enhancedPrompt = prompt.trim();
    let plannedProvider = "huggingface";
    let plannedModel = "";
    let quotaAllowed = true;
    let overallStatus: PipelineSimulationResult["overallStatus"] = "SUCCESS";

    // Phase 1: Director Prompt Enhancement
    const step1Start = Date.now();
    try {
      if (modality === "video") {
        const enhanced = await VideoExecutor.enhanceDirectorPrompt(prompt);
        enhancedPrompt = enhanced.prompt;
      } else {
        const enhanced = await ImageExecutor.enhancePrompt(prompt);
        enhancedPrompt = enhanced.prompt;
      }
      steps.push({
        phase: "1. Prompt Engineering & Enhancement",
        name: "Direct Fast-Path Dispatch",
        status: "passed",
        durationMs: Date.now() - step1Start,
        summary: `Direct user prompt forwarded without expansion delay (${enhancedPrompt.length} chars)`,
        data: { enhancedPrompt },
      });
    } catch (err) {
      steps.push({
        phase: "1. Prompt Engineering & Enhancement",
        name: "Director Prompt Expander",
        status: "warning",
        durationMs: Date.now() - step1Start,
        summary: "Prompt enhancer unavailable; using raw prompt as fallback",
        error: this.classifyError(err),
      });
    }

    // Phase 2: Route Planning & Engine Selection
    const step2Start = Date.now();
    try {
      if (modality === "video") {
        const plan = await VideoExecutor.plan({ prompt, modality: "video" });
        plannedProvider = plan.plannedProvider;
        plannedModel = plan.plannedModel;
        steps.push({
          phase: "2. Adaptive AI Route Selection",
          name: "Model Discovery & Dispatcher",
          status: "passed",
          durationMs: Date.now() - step2Start,
          summary: `Selected provider ${plannedProvider} with model ${plannedModel}`,
          data: { routingReason: plan.routingReason, videoTechnique: plan.videoTechnique },
        });
      } else {
        const plan = await ImageExecutor.plan({ prompt, modality: "image" });
        plannedProvider = plan.plannedProvider;
        plannedModel = plan.plannedModel;
        steps.push({
          phase: "2. Adaptive AI Route Selection",
          name: "Model Discovery & Dispatcher",
          status: "passed",
          durationMs: Date.now() - step2Start,
          summary: `Selected provider ${plannedProvider} with model ${plannedModel}`,
          data: { routingReason: plan.routingReason },
        });
      }
    } catch (err) {
      overallStatus = "FAILED";
      steps.push({
        phase: "2. Adaptive AI Route Selection",
        name: "Model Discovery & Dispatcher",
        status: "failed",
        durationMs: Date.now() - step2Start,
        summary: "Unable to plan model dispatch route",
        error: this.classifyError(err, { provider: plannedProvider }),
      });
    }

    // Phase 3: Quota & VIP Tier Authorization
    const step3Start = Date.now();
    try {
      const quotaCheck = await userTierService.checkQuota(1, modality === "video" ? "video" : "image");
      quotaAllowed = quotaCheck.allowed;
      steps.push({
        phase: "3. Quota & Tier Authorization",
        name: "VIP Tier Policy Check",
        status: quotaCheck.allowed ? "passed" : "warning",
        durationMs: Date.now() - step3Start,
        summary: quotaCheck.allowed
          ? `Allowed · Remaining daily quota: ${quotaCheck.remaining}`
          : `Quota limit reached (${quotaCheck.remaining} left)`,
        data: { quotaCheck },
      });
    } catch (err) {
      steps.push({
        phase: "3. Quota & Tier Authorization",
        name: "VIP Tier Policy Check",
        status: "warning",
        durationMs: Date.now() - step3Start,
        summary: "User tier lookup bypassed for simulation",
      });
    }

    // Phase 4: Provider Credential & Endpoint Pre-Flight
    const step4Start = Date.now();
    try {
      const probeTarget = plannedProvider === "gemini"
        ? "gemini"
        : modality === "video"
          ? "huggingface_video"
          : "huggingface_image";
      const probeResult = await this.runProbe(probeTarget);
      if (probeResult.status === "FAILED") {
        overallStatus = overallStatus === "FAILED" ? "FAILED" : "DEGRADED";
        steps.push({
          phase: "4. Provider Credential & Inference Pre-flight",
          name: "Endpoint Connectivity",
          status: "failed",
          durationMs: Date.now() - step4Start,
          summary: `Provider pre-flight failed: ${probeResult.error?.title || "Endpoint error"} (${probeTarget})`,
          error: probeResult.error,
        });
      } else {
        steps.push({
          phase: "4. Provider Credential & Inference Pre-flight",
          name: "Endpoint Connectivity",
          status: "passed",
          durationMs: Date.now() - step4Start,
          summary: `Inference endpoint verified & authorized (${probeTarget}, ${probeResult.latencyMs}ms)`,
        });
      }
    } catch (err) {
      overallStatus = "DEGRADED";
      steps.push({
        phase: "4. Provider Credential & Inference Pre-flight",
        name: "Endpoint Connectivity",
        status: "failed",
        durationMs: Date.now() - step4Start,
        summary: "Pre-flight check error",
        error: this.classifyError(err, { provider: plannedProvider }),
      });
    }

    // Phase 5: Storage Bucket & CDN Readiness
    const step5Start = Date.now();
    try {
      const storageStatus = await cloudinaryMediaAdminService.getStatus();
      steps.push({
        phase: "5. Media Storage & CDN Distribution",
        name: "Cloudinary Ingestion Check",
        status: storageStatus.healthy ? "passed" : "warning",
        durationMs: Date.now() - step5Start,
        summary: storageStatus.healthy
          ? `Storage operational (${storageStatus.cloudName})`
          : "Cloudinary unconfigured; will fall back to direct buffer delivery",
        data: { cloudName: storageStatus.cloudName },
      });
    } catch (err) {
      steps.push({
        phase: "5. Media Storage & CDN Distribution",
        name: "Cloudinary Ingestion Check",
        status: "warning",
        durationMs: Date.now() - step5Start,
        summary: "Storage verification warning; memory buffer fallback active",
      });
    }

    const totalDurationMs = Date.now() - overallStart;

    return {
      simulationId,
      modality,
      originalPrompt: prompt,
      enhancedPrompt,
      success: overallStatus !== "FAILED",
      totalDurationMs,
      overallStatus,
      plannedProvider,
      plannedModel,
      quotaAllowed,
      steps,
    };
  }

  /**
   * Summarizes historical trends (last 24 hours) based on retained jobs.
   */
  getHistoricalTrends(): HistoricalTrendsSummary {
    const jobs = asyncMediaJobManager.listJobs({ limit: 200 });
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 3600 * 1000;

    const recentJobs = jobs.filter((j) => new Date(j.createdAt).getTime() >= twentyFourHoursAgo);
    const totalJobs = recentJobs.length;
    const completedJobs = recentJobs.filter((j) => j.state === "completed").length;
    const failedJobs = recentJobs.filter((j) => j.state === "failed" || j.state === "timed_out").length;

    let totalLatency = 0;
    let latencyCount = 0;
    let failoversRecorded = 0;

    const byModality: HistoricalTrendsSummary["byModality"] = {
      image: { total: 0, completed: 0, failed: 0 },
      video: { total: 0, completed: 0, failed: 0 },
      audio: { total: 0, completed: 0, failed: 0 },
    };

    const byErrorCategory: Record<DiagnosticErrorCategory, number> = {
      credential_missing: 0,
      billing_quota_exhausted: 0,
      capability_not_enabled: 0,
      cluster_busy: 0,
      endpoint_unreachable: 0,
      unknown: 0,
    };

    for (const job of recentJobs) {
      if (job.latencyMs && job.latencyMs > 0) {
        totalLatency += job.latencyMs;
        latencyCount += 1;
      }
      if (job.failovers && job.failovers.length > 0) {
        failoversRecorded += job.failovers.length;
      }

      const mod = job.modality || "image";
      if (!byModality[mod]) {
        byModality[mod] = { total: 0, completed: 0, failed: 0 };
      }
      byModality[mod].total += 1;
      if (job.state === "completed") byModality[mod].completed += 1;
      if (job.state === "failed" || job.state === "timed_out") byModality[mod].failed += 1;

      if (job.state === "failed" && job.errorMessage) {
        const classified = this.classifyError(job.errorMessage, {
          provider: job.actualProvider,
          modality: job.modality,
        });
        byErrorCategory[classified.category] = (byErrorCategory[classified.category] || 0) + 1;
      }
    }

    const successRatePercent = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 100;
    const averageLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

    return {
      period: "24h",
      totalJobs,
      completedJobs,
      failedJobs,
      successRatePercent,
      averageLatencyMs,
      failoversRecorded,
      byModality,
      byErrorCategory,
      recentAlertCount: failedJobs,
    };
  }

  /**
   * List jobs with categorized diagnostics metadata.
   */
  listJobsWithDiagnostics(options: { modality?: MediaModality; status?: string; limit?: number } = {}) {
    let jobs = asyncMediaJobManager.listJobs({
      modality: options.modality,
      limit: options.limit || 50,
    });

    if (options.status && options.status !== "all") {
      jobs = jobs.filter((j) => j.state === options.status);
    }

    return jobs.map((job) => {
      let categorizedError: CategorizedDiagnosticError | undefined;
      if (job.errorMessage) {
        categorizedError = this.classifyError(job.errorMessage, {
          provider: job.actualProvider,
          modality: job.modality,
        });
      }

      return {
        ...job,
        categorizedError,
      };
    });
  }

  /**
   * Dispatch proactive system snapshot to administrator Telegram chat.
   */
  async sendTelegramSnapshot(targetChatId?: number | string): Promise<{ success: boolean; message: string; chatId: number }> {
    const bot = telegramRuntime.bot;
    if (!bot) {
      throw new Error("Telegram bot runtime is not active. Cannot send Telegram notification.");
    }

    let recipientId: number | null = null;
    if (targetChatId && Number.isSafeInteger(Number(targetChatId))) {
      recipientId = Number(targetChatId);
    } else if (process.env.ADMIN_TELEGRAM_ID && Number.isSafeInteger(Number(process.env.ADMIN_TELEGRAM_ID))) {
      recipientId = Number(process.env.ADMIN_TELEGRAM_ID);
    } else {
      const allowedEnv = process.env.ALLOWED_TELEGRAM_USER_IDS?.trim();
      if (allowedEnv) {
        const first = Number(allowedEnv.split(",")[0]?.trim());
        if (Number.isSafeInteger(first) && first > 0) recipientId = first;
      }
    }

    if (!recipientId) {
      // Find latest registered user from database
      const user = await db
        .select({ telegramUserId: usersTable.telegramUserId })
        .from(usersTable)
        .limit(1);
      if (user.length > 0 && user[0].telegramUserId) {
        recipientId = Number(user[0].telegramUserId);
      }
    }

    if (!recipientId) {
      throw new Error("No admin Telegram chat ID found. Please specify target Chat ID or set ADMIN_TELEGRAM_ID.");
    }

    const matrix = await this.getSystemHealthMatrix();
    const trends = this.getHistoricalTrends();

    const statusEmoji = matrix.overallStatus === "HEALTHY" ? "🟢" : matrix.overallStatus === "DEGRADED" ? "🟡" : "🔴";
    const geminiStatus = matrix.providers.gemini?.status === "healthy" ? "✅" : "⚠️";
    const hfStatus = matrix.providers.huggingface?.status === "healthy" ? "✅" : matrix.providers.huggingface?.configured ? "⚠️" : "⚪";
    const cloudStatus = matrix.providers.cloudinary?.status === "healthy" ? "✅" : "⚪";
    const dbStatus = matrix.providers.postgres?.status === "healthy" ? "✅" : "❌";

    let alertBlock = "";
    if (matrix.activeAlerts.length > 0) {
      alertBlock = `\n\n<b>⚠️ Active Attention Required:</b>\n` +
        matrix.activeAlerts
          .slice(0, 3)
          .map((a) => `• <b>${a.title}</b>: ${a.message}`)
          .join("\n");
    }

    const message =
      `${statusEmoji} <b>Wingbuddy Proactive Diagnostics Snapshot</b>\n\n` +
      `<b>System Status:</b> ${matrix.overallStatus}\n` +
      `<b>Uptime:</b> ${Math.floor(matrix.uptimeSeconds / 3600)}h ${Math.floor((matrix.uptimeSeconds % 3600) / 60)}m\n\n` +
      `<b>Provider Matrix:</b>\n` +
      `${geminiStatus} <b>Gemini:</b> ${matrix.providers.gemini?.quotaStatus || "OK"}\n` +
      `${hfStatus} <b>Hugging Face:</b> ${matrix.providers.huggingface?.quotaStatus || "Unconfigured"}\n` +
      `${cloudStatus} <b>Cloudinary:</b> ${matrix.providers.cloudinary?.quotaStatus || "Unconfigured"}\n` +
      `${dbStatus} <b>Database:</b> ${matrix.providers.postgres?.status || "OK"} (${matrix.providers.postgres?.latencyMs ?? 0}ms)\n\n` +
      `<b>24h Telemetry:</b>\n` +
      `• Total Requests: ${trends.totalJobs}\n` +
      `• Success Rate: ${trends.successRatePercent}%\n` +
      `• Avg Latency: ${trends.averageLatencyMs}ms` +
      alertBlock +
      `\n\n<i>Generated at ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`;

    await bot.api.sendMessage(recipientId, message, { parse_mode: "HTML" });
    logger.info({ recipientId, overallStatus: matrix.overallStatus }, "Dispatched diagnostic snapshot to Telegram");

    return {
      success: true,
      message: `Diagnostic snapshot sent to Telegram ID ${recipientId}`,
      chatId: recipientId,
    };
  }

  private recordProbeResult(result: ProbeResult): void {
    this.lastProbeCache.set(result.probeId, result);
    this.probeHistory.unshift(result);
    if (this.probeHistory.length > 50) {
      this.probeHistory.pop();
    }
  }
}

export const diagnosticsService = new DiagnosticsService();
