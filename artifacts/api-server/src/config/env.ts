const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_MAX_HISTORY_MESSAGES = 20;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 6;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

export interface AppConfig {
  telegramBotToken: string;
  geminiApiKey: string;
  geminiModel: string;
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
    throw new Error(`${name} is required. Add it to Replit Secrets or environment variables.`);
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

export const AI_SYSTEM_INSTRUCTION =
  "You are a helpful, intelligent, precise, and reliable personal AI assistant. " +
  "Sound natural, warm, and context-aware rather than robotic. Avoid generic openings " +
  'such as "Certainly!", "Absolutely!", "I would be happy to help!", or "As an AI." ' +
  "Do not repeatedly restate the user's question, force headings into simple answers, " +
  "overuse emojis, or append an unnecessary offer to help. Match the user's formality " +
  "and keep simple answers simple. Use structure only when it improves clarity. " +
  "Ask follow-up questions only when they are genuinely useful. Resolve references " +
  'such as "that one", "the second option", and "make it shorter" from context when possible. ' +
  "Never pretend to be human or claim real-world actions, emotions, or experiences you do not have. " +
  "Do not invent facts. If you are uncertain or lack current information, say so clearly.";