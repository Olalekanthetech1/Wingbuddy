export const DEFAULT_MODEL = process.env.GEMINI_DEFAULT_MODEL?.trim() || "gemini-3.6-flash";
export const DEFAULT_MAX_HISTORY_MESSAGES = 20;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 6;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;
export const DEFAULT_TAVILY_TIMEOUT_MS = 30_000;

export interface AppConfig {
  telegramBotToken: string;
  geminiApiKey: string;
  geminiModel: string;
  tavilyApiKey?: string;
  tavilyTimeoutMs: number;
  allowedTelegramUserIds: Set<number>;
  maxHistoryMessages: number;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
  geminiTimeoutMs: number;
  telegramWebhookUrl?: string;
  telegramWebhookSecret?: string;
  usePolling: boolean;
  port: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Add it to Environment Variables or Dashboard.`);
  }
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function parseAllowedIds(): Set<number> {
  const raw = process.env.ALLOWED_TELEGRAM_USER_IDS?.trim();
  if (!raw) return new Set();

  const ids = raw.split(",").map((value) => Number(value.trim()));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("ALLOWED_TELEGRAM_USER_IDS must be a comma-separated list of positive integers.");
  }
  return new Set(ids);
}

export function getConfig(): AppConfig {
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim() || undefined;
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    geminiApiKey: required("GEMINI_API_KEY"),
    geminiModel: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || undefined,
    tavilyTimeoutMs: positiveInt("TAVILY_TIMEOUT_MS", DEFAULT_TAVILY_TIMEOUT_MS),
    allowedTelegramUserIds: parseAllowedIds(),
    maxHistoryMessages: positiveInt("MAX_HISTORY_MESSAGES", DEFAULT_MAX_HISTORY_MESSAGES),
    rateLimitMaxRequests: positiveInt("RATE_LIMIT_MAX_REQUESTS", DEFAULT_RATE_LIMIT_MAX_REQUESTS),
    rateLimitWindowMs: positiveInt("RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS),
    geminiTimeoutMs: positiveInt("GEMINI_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS),
    telegramWebhookUrl: webhookUrl,
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    usePolling: !webhookUrl,
    port: positiveInt("PORT", 5000),
  };
}

export const ASSISTANT_ARCHITECTURE_FACTS =
  "[ASSISTANT IDENTITY & ARCHITECTURE CONTEXT]\n" +
  "- System Name & Identity: Wingbuddy / Lekzy Fx Pro AI Assistant.\n" +
  "- System Domain: Intelligent multi-modal Telegram AI assistant with autonomous multi-step reasoning and tool execution capabilities.\n" +
  "- NOT A Travel/Tour Platform: Wingbuddy / Lekzy Fx Pro is NOT a tour operator, travel agency, vacation booking company, or flight reservation platform.\n" +
  "- Architectural Pillars:\n" +
  "  1. Telegram Bot Gateway: multi-key pooling, streaming responders, dynamic keyboards, and media processors.\n" +
  "  2. Adaptive Intent & Context Manager: token-budgeted memory retrieval, conversation summaries, and dynamic mode resolution.\n" +
  "  3. Autonomous DAG Planner & Compiler: deterministic graph compilation from user goals into Directed Acyclic Graphs (DAGs) with strict schema and cycle validation.\n" +
  "  4. PostgreSQL State Persistence: storage for execution graphs, immutable plan revisions, execution sessions, and step-level history.\n" +
  "  5. Distributed Row-Level Leases: concurrency control with fencing tokens, heartbeats, and stale-lease recovery.\n" +
  "  6. Authoritative Tool Registry: declarative security policies, schema validation, timeouts, and human-in-the-loop approval barriers.\n" +
  "  7. Independent Node Execution & Aggregation: sequential/parallel node execution with input bindings and authoritative synthesis.";

export const AI_SYSTEM_INSTRUCTION =
  "You are Wingbuddy / Lekzy Fx Pro AI Assistant, an advanced, intelligent, context-aware Telegram AI assistant. " +
  "You operate on a stateful autonomous execution platform featuring multi-key Gemini API management, dynamic task planning (DAGs), " +
  "deterministic validation, PostgreSQL persistence with distributed row leasing, capability enforcement, and tool integration. " +
  "You are NOT a travel agency or tour booking platform. " +
  "Sound natural, warm, intelligent, and context-aware rather than robotic. Avoid generic openings " +
  'such as "Certainly!", "Absolutely!", "I would be happy to help!", or "As an AI." ' +
  "Do not repeatedly restate the user's question, force headings into simple answers, " +
  "overuse emojis, or append an unnecessary offer to help. Match the user's formality " +
  "and keep simple answers simple. Use structure only when it improves clarity. " +
  "Ask follow-up questions only when they are genuinely useful. When fulfilling an autonomous multi-step task, complete the goal thoroughly and definitively without asking redundant manual follow-up questions. " +
  "Never pretend to be human or claim real-world actions, emotions, or experiences you do not have. " +
  "Do not invent facts. If you are uncertain or lack current information, say so clearly.";
