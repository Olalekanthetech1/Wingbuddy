import { randomUUID } from "node:crypto";
import { getPool, chatDatabaseService } from "@workspace/db";
import { getConfig, AI_SYSTEM_INSTRUCTION } from "../config/env";
import { MODE_KEYS, type ModeKey } from "../config/mode";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { ConversationService } from "./conversation.service";
import { ModeService } from "./mode.service";
import { ExecutionPlannerService, type ExecutionPlan } from "./execution-planner.service";
import { adaptiveAIRouterService, type AIRoutingCandidate } from "./adaptive-ai-router.service";
import { apiKeyPoolService } from "./api-key-pool.service";
import { knowledgeVaultService } from "./knowledge-vault.service";
import { formatTelegramMessage } from "../utils/telegram-formatter";
import { safeErrorMetadata } from "../utils/safe-error";
import { logger } from "../lib/logger";
import { UnifiedMediaEngine } from "./media/unified-media-engine.service";
import type { FailoverRecord, MediaModality, VideoGenerationTechnique } from "./media/media-types";

export interface BotSimulationRequest {
  message: string;
  telegramUserId?: number;
  modeOverride?: ModeKey | "auto";
  personalityOverride?: PersonalityKey;
  userTier?: "free" | "pro" | "vip";
  personaOverride?: string;
  providerOverride?: string; // "auto" or specific provider
  modelOverride?: string;    // specific model ID
  includeHistory?: boolean;
  enableLiveSearch?: boolean;
  liveMediaGeneration?: boolean; // When true, executes actual production multimodal engine
  customHistory?: Array<{ role: "user" | "model"; content: string }>;
}

export interface MultimodalTransparency {
  executionMode: "dry_run" | "live";
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
  jobState: string;
  failovers: FailoverRecord[];
  artifactUrl?: string;
  storageProvider?: string;
  error?: string;
}

export interface CandidateScoreMatrixItem {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  totalScore: number;
  healthScore: number;
  latencyMs: number;
  priority: number;
  reasons: string[];
  status: "WINNER" | "eligible" | "unhealthy" | "overridden";
}

export interface ExecutionTimelineStep {
  stepNumber: number;
  phase: string;
  label: string;
  status: "completed" | "in_progress" | "failed" | "skipped";
  details: Record<string, unknown>;
  durationMs?: number;
}

export interface BotSimulationTrace {
  simulationId: string;
  createdAt: string;
  telegramUserId: number | null;
  persistentMode: ModeKey;
  effectiveMode: ModeKey;
  personality: PersonalityKey;
  userTier: "free" | "pro" | "vip";
  intent: ExecutionPlan["detectedIntent"];
  requiredCapabilities: ExecutionPlan["requiredCapabilities"];
  enableSearch: boolean;
  thinkingLevel?: string;
  providerPreference: ExecutionPlan["providerPreference"];
  modelCandidates: string[];
  selectedProvider?: string;
  selectedModel?: string;
  routingReasons?: string[];
  isTestOverride: boolean;
  candidateMatrix: CandidateScoreMatrixItem[];
  executionTimeline: ExecutionTimelineStep[];
  multimodal?: MultimodalTransparency;
  contextAssembly: {
    systemInstructionsSnippet: string;
    historyMessagesCount: number;
    historySnippets: Array<{ role: "user" | "model"; snippet: string }>;
    longTermMemories: Array<{ key: string; content: string; category: string; injected: boolean }>;
    retrievedKnowledge: Array<{ title: string; snippet: string; score: number; injected: boolean }>;
    userPreferences: { tier: string; personality: string; mode: string };
  };
  telemetry: {
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    totalTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  };
  latencyMs?: number;
  keyPool: {
    totalKeys: number;
    healthyKeys: number;
    cooldownKeys: number;
    disabledKeys: number;
    invalidKeys: number;
  };
  historyMessages: number;
  memoryFacts: number;
  sideEffects: {
    telegramSend: false;
    productionExecution: boolean;
    persistentUserMutation: boolean;
  };
}

export interface BotSimulationResult {
  id: string;
  status: "completed" | "failed";
  message: string;
  response?: string;
  telegramPreview?: string;
  trace: BotSimulationTrace;
  mediaArtifact?: {
    url: string;
    mimeType: string;
    videoTechnique?: VideoGenerationTechnique;
    storageProvider?: string;
  };
  error?: string;
}

interface SimulationRow {
  id: string;
  status: "completed" | "failed";
  message: string;
  response: string | null;
  telegram_preview: string | null;
  trace_json: BotSimulationTrace;
  error_text: string | null;
  created_at: string;
}

class BotSimulatorService {
  private schemaReady: Promise<void> | null = null;

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        const pool = getPool();
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_bot_simulation_runs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            message TEXT NOT NULL,
            response TEXT,
            telegram_preview TEXT,
            trace_json JSONB NOT NULL,
            error_text TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS ai_bot_simulation_runs_created_idx
            ON ai_bot_simulation_runs(created_at DESC);
          CREATE INDEX IF NOT EXISTS ai_bot_simulation_runs_status_idx
            ON ai_bot_simulation_runs(status);
        `);
      })().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    await this.schemaReady;
  }

  private async loadContext(telegramUserId: number | undefined, includeHistory: boolean, userTier: "free" | "pro" | "vip"): Promise<{
    persistentMode: ModeKey;
    personality: PersonalityKey;
    history: Array<{ role: "user" | "model"; content: string }>;
    memories: Array<{ key: string; content: string; category: string }>;
    knowledge: Array<{ title: string; snippet: string; score: number }>;
  }> {
    const pool = getPool();
    const fallback = { persistentMode: "general" as ModeKey, personality: "playful" as PersonalityKey, history: [], memories: [], knowledge: [] };
    if (!telegramUserId) return fallback;

    let persistentMode: ModeKey = "general";
    let personality: PersonalityKey = "playful";

    try {
      const userResult = await pool.query<{ mode: string; personality: string }>(
        `SELECT mode, personality FROM users WHERE telegram_user_id = $1 LIMIT 1`,
        [telegramUserId],
      );
      if (userResult.rows[0]) {
        if (MODE_KEYS.includes(userResult.rows[0].mode as ModeKey)) persistentMode = userResult.rows[0].mode as ModeKey;
        if (Object.prototype.hasOwnProperty.call(PERSONALITIES, userResult.rows[0].personality)) personality = userResult.rows[0].personality as PersonalityKey;
      }
    } catch {
      // fallback
    }

    let history: Array<{ role: "user" | "model"; content: string }> = [];
    const historyLimit = userTier === "vip" ? 40 : userTier === "pro" ? 20 : 8;

    if (includeHistory) {
      try {
        const historyResult = await pool.query<{ role: string; content: string }>(
          `
            SELECT m.role, m.content
            FROM messages m
            INNER JOIN conversations c ON c.id = m.conversation_id
            WHERE c.telegram_user_id = $1
            ORDER BY m.created_at DESC
            LIMIT $2
          `,
          [telegramUserId, historyLimit],
        );
        history = historyResult.rows
          .reverse()
          .filter((row) => row.role === "user" || row.role === "model")
          .map((row) => ({ role: row.role as "user" | "model", content: row.content }));
      } catch {
        history = [];
      }
    }

    let memories: Array<{ key: string; content: string; category: string }> = [];
    try {
      const memoryResult = await pool.query<{ key: string; content: string; category: string }>(
        `
          SELECT key, content, category
          FROM user_memories
          WHERE telegram_user_id = $1 AND status = 'active'
          ORDER BY importance DESC, updated_at DESC
          LIMIT 8
        `,
        [telegramUserId],
      );
      memories = memoryResult.rows;
    } catch {
      memories = [];
    }

    return { persistentMode, personality, history, memories, knowledge: [] };
  }

  private guidance(
    personality: PersonalityKey,
    plan: ExecutionPlan,
    memories: Array<{ key: string; content: string; category: string }>,
  ) {
    const personalityInstruction = PERSONALITIES[personality].instruction;
    const memoryInstruction = memories.length
      ? `Relevant user memory for this simulation only:\n${memories.map((m) => `- ${m.key}: ${m.content}`).join("\n")}`
      : undefined;

    return {
      personalityInstruction,
      modeInstruction: plan.effectiveSystemPrompt,
      memoryInstruction,
    };
  }

  private estimateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const m = modelId.toLowerCase();
    let promptRate = 0.075 / 1_000_000;
    let completionRate = 0.30 / 1_000_000;

    if (m.includes("llama-3.3-70b") || m.includes("large")) {
      promptRate = 0.59 / 1_000_000;
      completionRate = 0.79 / 1_000_000;
    } else if (m.includes("llama-3.1-8b") || m.includes("small") || m.includes("instant")) {
      promptRate = 0.05 / 1_000_000;
      completionRate = 0.08 / 1_000_000;
    } else if (m.includes("gemini-3.7") || m.includes("reasoning")) {
      promptRate = 0.15 / 1_000_000;
      completionRate = 0.60 / 1_000_000;
    }

    return Number(((promptTokens * promptRate) + (completionTokens * completionRate)).toFixed(6));
  }

  async run(request: BotSimulationRequest): Promise<BotSimulationResult> {
    await this.ensureSchema();

    const message = request.message?.trim();
    if (!message) throw new Error("Simulation message is required");
    if (message.length > 12000) throw new Error("Simulation message exceeds the 12,000 character limit");

    const simulationId = `sim_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const userTier = request.userTier || "free";
    const context = await this.loadContext(request.telegramUserId, request.includeHistory !== false, userTier);

    const activeHistory = Array.isArray(request.customHistory) && request.customHistory.length > 0
      ? request.customHistory
      : context.history;

    const persistentMode = request.modeOverride && request.modeOverride !== "auto"
      ? request.modeOverride
      : context.persistentMode;

    const activePersonality = request.personalityOverride && PERSONALITIES[request.personalityOverride]
      ? request.personalityOverride
      : context.personality;

    const conversations = new ConversationService();
    const modeService = new ModeService(conversations);
    const planner = new ExecutionPlannerService(modeService);
    
    const startTime = Date.now();
    const timeline: ExecutionTimelineStep[] = [];

    // Step 1: Intent & Planning
    const plan = planner.plan(message, persistentMode, activeHistory);
    const enableSearch = request.enableLiveSearch === undefined ? plan.enableSearch : Boolean(request.enableLiveSearch && plan.enableSearch);
    
    timeline.push({
      stepNumber: 1,
      phase: "INTENT_&_PLANNING",
      label: `Classified intent: ${plan.detectedIntent} (${plan.effectiveMode} mode)`,
      status: "completed",
      details: {
        detectedIntent: plan.detectedIntent,
        effectiveMode: plan.effectiveMode,
        requiredCapabilities: plan.requiredCapabilities,
        thinkingLevel: plan.thinkingLevel || "none",
        enableSearch,
        systemPromptLength: plan.effectiveSystemPrompt.length,
      },
      durationMs: 8,
    });

    // Step 2: Context & Memory Retrieval
    let retrievedKnowledge: Array<{ title: string; snippet: string; score: number; injected: boolean }> = [];
    if (request.telegramUserId && message.length > 4) {
      try {
        const kResults = await knowledgeVaultService.searchSimilar(request.telegramUserId.toString(), message, 3);
        retrievedKnowledge = kResults.map((k) => ({
          title: k.metadata?.title || "Knowledge Document",
          snippet: k.chunk.slice(0, 140) + "...",
          score: Number((k.score || 0.85).toFixed(2)),
          injected: true,
        }));
      } catch {
        retrievedKnowledge = [];
      }
    }

    timeline.push({
      stepNumber: 2,
      phase: "CONTEXT_ASSEMBLY",
      label: `Assembled ${activeHistory.length} history turns, ${context.memories.length} memories, ${retrievedKnowledge.length} knowledge chunks`,
      status: "completed",
      details: {
        userTier,
        personality: activePersonality,
        historyCount: activeHistory.length,
        memoriesCount: context.memories.length,
        knowledgeChunksCount: retrievedKnowledge.length,
      },
      durationMs: 12,
    });

    // Step 3: Tool Selection & Autonomous Loop Evaluation
    const toolsSelected: string[] = [];
    if (enableSearch) toolsSelected.push("live_web_search");
    if (plan.effectiveMode === "crypto") toolsSelected.push("crypto_market_evaluator");
    if (plan.effectiveMode === "coder") toolsSelected.push("code_interpreter_sandbox");

    if (toolsSelected.length > 0) {
      timeline.push({
        stepNumber: 3,
        phase: "TOOL_SELECTION",
        label: `Identified required tool capabilities: ${toolsSelected.join(", ")}`,
        status: "completed",
        details: {
          toolsSelected,
          autonomousLoopGated: true,
          liveSearchPermitted: enableSearch,
        },
        durationMs: 6,
      });
    }

    // Step 4: Adaptive Routing Candidate Scoring
    const candidateContext = {
      mode: plan.effectiveMode,
      enableSearch,
      isDeepReasoning: plan.thinkingLevel !== undefined,
      preferredProvider: (request.providerOverride && request.providerOverride !== "auto")
        ? (request.providerOverride as any)
        : (plan.providerPreference !== "default" ? (plan.providerPreference as any) : undefined),
      preferredModelId: request.modelOverride || undefined,
      userTier,
    };

    const isTestOverride = Boolean(request.providerOverride && request.providerOverride !== "auto") || Boolean(request.modelOverride);
    const routerCandidates: AIRoutingCandidate[] = await adaptiveAIRouterService.candidates(candidateContext);
    const modelCandidates = routerCandidates.map((c) => `${c.model.provider}:${c.model.modelId}`);
    const keyPool = apiKeyPoolService.getSummary();

    const candidateMatrix: CandidateScoreMatrixItem[] = routerCandidates.map((cand, idx) => ({
      id: cand.model.id,
      provider: cand.model.provider,
      modelId: cand.model.modelId,
      name: cand.model.name,
      totalScore: Math.round(cand.score),
      healthScore: Math.round(cand.healthScore),
      latencyMs: Math.round(cand.latencyMs),
      priority: cand.model.priority,
      reasons: cand.reasons,
      status: idx === 0 ? "WINNER" : (cand.healthScore <= 0 ? "unhealthy" : "eligible"),
    }));

    timeline.push({
      stepNumber: toolsSelected.length > 0 ? 4 : 3,
      phase: "ROUTING_ARBITRATION",
      label: isTestOverride 
        ? `Test override active: routed to ${candidateContext.preferredProvider || candidateContext.preferredModelId}`
        : `Evaluated ${candidateMatrix.length} model candidates across active providers`,
      status: "completed",
      details: {
        isTestOverride,
        winnerCandidate: candidateMatrix[0] ? `${candidateMatrix[0].provider}:${candidateMatrix[0].modelId}` : "none",
        candidatesCount: candidateMatrix.length,
      },
      durationMs: 14,
    });

    const guidanceObj = this.guidance(activePersonality, plan, context.memories);
    const systemInstruction = [
      AI_SYSTEM_INSTRUCTION,
      guidanceObj.personalityInstruction,
      guidanceObj.modeInstruction,
      guidanceObj.memoryInstruction,
      retrievedKnowledge.length ? `Retrieved Vault Context:\n${retrievedKnowledge.map((k) => `• ${k.title}: ${k.snippet}`).join("\n")}` : undefined,
    ].filter(Boolean).join("\n\n");

    const promptText = systemInstruction + " " + activeHistory.map((h) => h.content).join(" ") + " " + message;
    const estPromptTokens = Math.ceil(promptText.length / 3.8);

    const trace: BotSimulationTrace = {
      simulationId,
      createdAt,
      telegramUserId: request.telegramUserId ?? null,
      persistentMode,
      effectiveMode: plan.effectiveMode,
      personality: activePersonality,
      userTier,
      intent: plan.detectedIntent,
      requiredCapabilities: plan.requiredCapabilities,
      enableSearch,
      thinkingLevel: plan.thinkingLevel,
      providerPreference: plan.providerPreference,
      modelCandidates,
      isTestOverride,
      candidateMatrix,
      executionTimeline: timeline,
      contextAssembly: {
        systemInstructionsSnippet: systemInstruction.slice(0, 300) + (systemInstruction.length > 300 ? "..." : ""),
        historyMessagesCount: activeHistory.length,
        historySnippets: activeHistory.slice(-5).map((h) => ({ role: h.role, snippet: h.content.slice(0, 100) + (h.content.length > 100 ? "..." : "") })),
        longTermMemories: context.memories.map((m) => ({ key: m.key, content: m.content, category: m.category, injected: true })),
        retrievedKnowledge,
        userPreferences: {
          tier: userTier.toUpperCase(),
          personality: activePersonality,
          mode: persistentMode,
        },
      },
      telemetry: {
        estimatedPromptTokens: estPromptTokens,
        estimatedCompletionTokens: 0,
        totalTokens: estPromptTokens,
        latencyMs: 0,
        estimatedCostUsd: 0,
      },
      keyPool: {
        totalKeys: keyPool.totalKeys,
        healthyKeys: keyPool.healthyKeys,
        cooldownKeys: keyPool.cooldownKeys,
        disabledKeys: keyPool.disabledKeys,
        invalidKeys: keyPool.invalidKeys,
      },
      historyMessages: activeHistory.length,
      memoryFacts: context.memories.length,
      sideEffects: {
        telegramSend: false,
        productionExecution: Boolean(request.liveMediaGeneration),
        persistentUserMutation: Boolean(request.liveMediaGeneration),
      },
    };

    // Check if intent is multimodal (image or video generation)
    const isImageIntent = plan.detectedIntent === "image_generation" || message.startsWith("/image");
    const isVideoIntent = plan.detectedIntent === "video_generation" || message.startsWith("/video");

    if (isImageIntent || isVideoIntent) {
      const modality: MediaModality = isVideoIntent ? "video" : "image";
      const cleanPrompt = message.replace(/^\/(image|video)\s+/i, "").trim() || message;
      const isLive = Boolean(request.liveMediaGeneration);

      try {
        let mediaResult;
        if (isLive) {
          timeline.push({
            stepNumber: timeline.length + 1,
            phase: "MEDIA_EXECUTION_DISPATCH",
            label: `Live ${modality.toUpperCase()} generation dispatched to UnifiedMediaEngine`,
            status: "in_progress",
            details: { modality, mode: "live", cleanPrompt },
          });

          mediaResult = await UnifiedMediaEngine.execute({
            modality,
            prompt: cleanPrompt,
            executionMode: "live",
            userId: request.telegramUserId,
            userTier,
            providerOverride: request.providerOverride,
            modelOverride: request.modelOverride,
            sourceInterface: "bot_simulator",
          });
        } else {
          timeline.push({
            stepNumber: timeline.length + 1,
            phase: "MEDIA_DRY_RUN_PLAN",
            label: `Safe Dry-Run evaluation for ${modality.toUpperCase()} generation`,
            status: "completed",
            details: { modality, mode: "dry_run", cleanPrompt, note: "Zero-cost simulation; no provider media resources consumed" },
          });

          mediaResult = await UnifiedMediaEngine.plan({
            modality,
            prompt: cleanPrompt,
            executionMode: "dry_run",
            userId: request.telegramUserId,
            userTier,
            providerOverride: request.providerOverride,
            modelOverride: request.modelOverride,
            sourceInterface: "bot_simulator",
          });
        }

        trace.multimodal = mediaResult.transparency;
        trace.selectedProvider = mediaResult.transparency.selectedProvider;
        trace.selectedModel = mediaResult.transparency.selectedModel;
        trace.latencyMs = mediaResult.transparency.latencyMs;

        timeline.push({
          stepNumber: timeline.length + 1,
          phase: isLive ? "MEDIA_JOB_COMPLETION" : "MEDIA_PLAN_COMPLETE",
          label: isLive
            ? `Media job ${mediaResult.job.jobId} ${mediaResult.job.state} via ${mediaResult.job.actualProvider}:${mediaResult.job.actualModel} (${mediaResult.job.latencyMs}ms)`
            : `Planned media job ${mediaResult.job.jobId} routing to ${mediaResult.job.actualProvider}:${mediaResult.job.actualModel}`,
          status: mediaResult.success ? "completed" : "failed",
          details: {
            jobId: mediaResult.job.jobId,
            state: mediaResult.job.state,
            actualProvider: mediaResult.job.actualProvider,
            actualModel: mediaResult.job.actualModel,
            videoTechnique: mediaResult.job.videoTechnique,
            artifactUrl: mediaResult.job.artifactUrl,
            quotaRemaining: mediaResult.job.quotaDecision?.remaining,
            failovers: mediaResult.job.failovers,
          },
          durationMs: mediaResult.transparency.latencyMs,
        });

        let responseText = "";
        if (isLive) {
          if (mediaResult.success && mediaResult.artifact?.url) {
            responseText = modality === "video"
              ? `🎬 **Generated Video (${mediaResult.job.videoTechnique || "video_diffusion"})**\n\nPrompt: _"${cleanPrompt}"_\nModel: \`${mediaResult.job.actualProvider}:${mediaResult.job.actualModel}\`\n\n[▶️ Watch Video Asset](${mediaResult.artifact.url})`
              : `🎨 **Generated Image**\n\nPrompt: _"${cleanPrompt}"_\nModel: \`${mediaResult.job.actualProvider}:${mediaResult.job.actualModel}\`\n\n[🖼️ View Full Image](${mediaResult.artifact.url})`;
          } else {
            responseText = `⚠️ **${modality.toUpperCase()} Generation Failed**\n\n${mediaResult.job.errorMessage || "Unknown provider error occurred during media execution."}`;
          }
        } else {
          responseText = `🔍 **Multimodal Dry-Run Prediction [SAFE SIMULATION]**\n\n` +
            `• **Modality**: \`${modality.toUpperCase()}\`\n` +
            `• **Planned Route**: \`${mediaResult.job.actualProvider} / ${mediaResult.job.actualModel}\`\n` +
            (mediaResult.job.videoTechnique ? `• **Planned Technique**: \`${mediaResult.job.videoTechnique}\`\n` : "") +
            `• **Enhanced Prompt**: _"${mediaResult.job.enhancedPrompt}"_\n` +
            `• **Tier / Quota**: ${mediaResult.job.quotaDecision?.tier} (${mediaResult.job.quotaDecision?.remaining ?? 0} remaining)\n\n` +
            `💡 _Switch the "Live Generation" toggle to ON to produce and render the real media artifact._`;
        }

        const telegramPreview = formatTelegramMessage(responseText, {
          telegramUserId: request.telegramUserId,
          chunkIndex: 0,
          source: "dashboard.simulator",
        });

        const result: BotSimulationResult = {
          id: simulationId,
          status: mediaResult.success ? "completed" : "failed",
          message,
          response: responseText,
          telegramPreview,
          trace,
          mediaArtifact: mediaResult.artifact
            ? {
                url: mediaResult.artifact.url,
                mimeType: mediaResult.artifact.mimeType,
                videoTechnique: mediaResult.artifact.technique,
                storageProvider: mediaResult.artifact.storageProvider,
              }
            : undefined,
          error: mediaResult.success ? undefined : mediaResult.job.errorMessage,
        };

        await getPool().query(
          `INSERT INTO ai_bot_simulation_runs (id, status, message, response, telegram_preview, trace_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [simulationId, result.status, message, responseText, telegramPreview, JSON.stringify(trace)],
        );
        return result;
      } catch (mediaErr: any) {
        const errorText = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
        logger.error({ stage: "simulator_media_dispatch", error: safeErrorMetadata(mediaErr) }, "Simulator media execution crashed");

        timeline.push({
          stepNumber: timeline.length + 1,
          phase: "MEDIA_EXECUTION_FAILURE",
          label: `Media pipeline failure: ${errorText}`,
          status: "failed",
          details: { error: errorText },
        });

        const result: BotSimulationResult = {
          id: simulationId,
          status: "failed",
          message,
          trace,
          error: errorText,
        };

        await getPool().query(
          `INSERT INTO ai_bot_simulation_runs (id, status, message, trace_json, error_text)
           VALUES ($1, 'failed', $2, $3::jsonb, $4)`,
          [simulationId, message, JSON.stringify(trace), errorText],
        );
        return result;
      }
    }

    try {
      const routed = await adaptiveAIRouterService.route({
        systemInstruction,
        messages: [
          ...activeHistory.map((h) => ({ role: h.role === "model" ? "assistant" as const : "user" as const, content: h.content })),
          { role: "user" as const, content: message },
        ],
      }, candidateContext);

      const latencyMs = routed.latencyMs || (Date.now() - startTime);
      trace.selectedProvider = routed.candidate.model.provider;
      trace.selectedModel = routed.candidate.model.modelId;
      trace.routingReasons = isTestOverride 
        ? ["TEST OVERRIDE — production routing bypassed", ...(routed.candidate.reasons || [])]
        : routed.candidate.reasons;
      trace.latencyMs = latencyMs;

      const response = routed.response.text;
      const estCompTokens = Math.ceil(response.length / 3.8);
      const estCost = this.estimateCost(trace.selectedModel, estPromptTokens, estCompTokens);

      trace.telemetry = {
        estimatedPromptTokens: estPromptTokens,
        estimatedCompletionTokens: estCompTokens,
        totalTokens: estPromptTokens + estCompTokens,
        latencyMs,
        estimatedCostUsd: estCost,
      };

      timeline.push({
        stepNumber: timeline.length + 1,
        phase: "RESPONSE_GENERATION",
        label: `Generated ${response.length} characters in ${latencyMs}ms via ${trace.selectedProvider}:${trace.selectedModel}`,
        status: "completed",
        details: {
          provider: trace.selectedProvider,
          model: trace.selectedModel,
          promptTokens: estPromptTokens,
          completionTokens: estCompTokens,
          latencyMs,
          estimatedCostUsd: estCost,
        },
        durationMs: latencyMs,
      });

      const telegramPreview = formatTelegramMessage(response, {
        telegramUserId: request.telegramUserId,
        chunkIndex: 0,
        source: "dashboard.simulator",
      });

      const result: BotSimulationResult = {
        id: simulationId,
        status: "completed",
        message,
        response,
        telegramPreview,
        trace,
      };

      await getPool().query(
        `INSERT INTO ai_bot_simulation_runs (id, status, message, response, telegram_preview, trace_json)
         VALUES ($1, 'completed', $2, $3, $4, $5::jsonb)`,
        [simulationId, message, response, telegramPreview, JSON.stringify(trace)],
      );
      return result;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      logger.error({ stage: "bot_simulator", simulationId, error: safeErrorMetadata(error) }, "Bot simulation failed");
      
      timeline.push({
        stepNumber: timeline.length + 1,
        phase: "EXECUTION_FAILURE",
        label: `Execution failed: ${errorText}`,
        status: "failed",
        details: { error: errorText },
      });

      await getPool().query(
        `INSERT INTO ai_bot_simulation_runs (id, status, message, trace_json, error_text)
         VALUES ($1, 'failed', $2, $3::jsonb, $4)`,
        [simulationId, message, JSON.stringify(trace), errorText],
      );
      return {
        id: simulationId,
        status: "failed",
        message,
        trace,
        error: errorText,
      };
    }
  }

  async list(limit = 20): Promise<SimulationRow[]> {
    await this.ensureSchema();
    const safeLimit = Math.min(50, Math.max(1, limit));
    const result = await getPool().query<SimulationRow>(
      `
        SELECT id, status, message, response, telegram_preview, trace_json, error_text, created_at::text
        FROM ai_bot_simulation_runs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit],
    );
    return result.rows;
  }

  async get(id: string): Promise<SimulationRow | null> {
    await this.ensureSchema();
    const result = await getPool().query<SimulationRow>(
      `
        SELECT id, status, message, response, telegram_preview, trace_json, error_text, created_at::text
        FROM ai_bot_simulation_runs
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );
    return result.rows[0] || null;
  }
}

export const botSimulatorService = new BotSimulatorService();

