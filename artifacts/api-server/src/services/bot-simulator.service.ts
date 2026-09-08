import { randomUUID } from "node:crypto";
import { getPool } from "@workspace/db";
import { getConfig } from "../config/env";
import { MODE_KEYS, type ModeKey } from "../config/mode";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { ConversationService } from "./conversation.service";
import { ModeService } from "./mode.service";
import { ExecutionPlannerService, type ExecutionPlan } from "./execution-planner.service";
import { GeminiService } from "../gemini/gemini.service";
import { geminiModelPoolService } from "./gemini-model-pool.service";
import { apiKeyPoolService } from "./api-key-pool.service";
import { formatTelegramMessage } from "../utils/telegram-formatter";
import { safeErrorMetadata } from "../utils/safe-error";
import { logger } from "../lib/logger";

export interface BotSimulationRequest {
  message: string;
  telegramUserId?: number;
  modeOverride?: ModeKey | "auto";
  includeHistory?: boolean;
  enableLiveSearch?: boolean;
}

export interface BotSimulationTrace {
  simulationId: string;
  createdAt: string;
  telegramUserId: number | null;
  persistentMode: ModeKey;
  effectiveMode: ModeKey;
  personality: PersonalityKey;
  intent: ExecutionPlan["detectedIntent"];
  requiredCapabilities: ExecutionPlan["requiredCapabilities"];
  enableSearch: boolean;
  thinkingLevel?: string;
  providerPreference: ExecutionPlan["providerPreference"];
  modelCandidates: string[];
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
    productionExecution: false;
    persistentUserMutation: false;
  };
}

export interface BotSimulationResult {
  id: string;
  status: "completed" | "failed";
  message: string;
  response?: string;
  telegramPreview?: string;
  trace: BotSimulationTrace;
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

  private async loadContext(telegramUserId: number | undefined, includeHistory: boolean): Promise<{
    persistentMode: ModeKey;
    personality: PersonalityKey;
    history: Array<{ role: "user" | "model"; content: string }>;
    memories: Array<{ key: string; content: string; category: string }>;
  }> {
    const pool = getPool();
    const fallback = { persistentMode: "general" as ModeKey, personality: "playful" as PersonalityKey, history: [], memories: [] };
    if (!telegramUserId) return fallback;

    const userResult = await pool.query<{ mode: string; personality: string }>(
      `SELECT mode, personality FROM users WHERE telegram_user_id = $1 LIMIT 1`,
      [telegramUserId],
    );

    const persistentMode = MODE_KEYS.includes(userResult.rows[0]?.mode as ModeKey)
      ? userResult.rows[0].mode as ModeKey
      : "general";
    const personality = Object.prototype.hasOwnProperty.call(PERSONALITIES, userResult.rows[0]?.personality)
      ? userResult.rows[0].personality as PersonalityKey
      : "playful";

    let history: Array<{ role: "user" | "model"; content: string }> = [];
    if (includeHistory) {
      const historyResult = await pool.query<{ role: string; content: string }>(
        `
          SELECT m.role, m.content
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.telegram_user_id = $1
          ORDER BY m.created_at DESC
          LIMIT 20
        `,
        [telegramUserId],
      );
      history = historyResult.rows
        .reverse()
        .filter((row) => row.role === "user" || row.role === "model")
        .map((row) => ({ role: row.role as "user" | "model", content: row.content }));
    }

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

    return { persistentMode, personality, history, memories: memoryResult.rows };
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

  async run(request: BotSimulationRequest): Promise<BotSimulationResult> {
    await this.ensureSchema();

    const message = request.message?.trim();
    if (!message) throw new Error("Simulation message is required");
    if (message.length > 12000) throw new Error("Simulation message exceeds the 12,000 character limit");

    const simulationId = `sim_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const config = getConfig();
    const context = await this.loadContext(request.telegramUserId, request.includeHistory !== false);
    const persistentMode = request.modeOverride && request.modeOverride !== "auto"
      ? request.modeOverride
      : context.persistentMode;

    const conversations = new ConversationService();
    const modeService = new ModeService(conversations);
    const planner = new ExecutionPlannerService(modeService);
    const plan = planner.plan(message, persistentMode, context.history);
    const enableSearch = request.enableLiveSearch === undefined ? plan.enableSearch : Boolean(request.enableLiveSearch && plan.enableSearch);
    const modelCandidates = geminiModelPoolService.getCandidates(config.geminiModel, {
      mode: plan.effectiveMode,
      enableSearch,
      isDeepReasoning: plan.thinkingLevel !== undefined,
    });
    const keyPool = apiKeyPoolService.getSummary();

    const trace: BotSimulationTrace = {
      simulationId,
      createdAt,
      telegramUserId: request.telegramUserId ?? null,
      persistentMode,
      effectiveMode: plan.effectiveMode,
      personality: context.personality,
      intent: plan.detectedIntent,
      requiredCapabilities: plan.requiredCapabilities,
      enableSearch,
      thinkingLevel: plan.thinkingLevel,
      providerPreference: plan.providerPreference,
      modelCandidates,
      keyPool: {
        totalKeys: keyPool.totalKeys,
        healthyKeys: keyPool.healthyKeys,
        cooldownKeys: keyPool.cooldownKeys,
        disabledKeys: keyPool.disabledKeys,
        invalidKeys: keyPool.invalidKeys,
      },
      historyMessages: context.history.length,
      memoryFacts: context.memories.length,
      sideEffects: {
        telegramSend: false,
        productionExecution: false,
        persistentUserMutation: false,
      },
    };

    try {
      const gemini = new GeminiService(
        config.geminiApiKey,
        config.geminiModel,
        process.env.GEMINI_TIMEOUT_MS ? config.geminiTimeoutMs : 0,
      );
      const response = await gemini.generateReply(
        context.history,
        message,
        this.guidance(context.personality, plan, context.memories),
        {
          enableSearch,
          thinkingLevel: plan.thinkingLevel,
          mode: plan.effectiveMode,
          isDeepReasoning: plan.thinkingLevel !== undefined,
        },
      );
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
