import { ToolRegistry, type AssistantTool } from "./tool-registry";
import { logger } from "../lib/logger";
import { taskService } from "../services/task.service";
import { reminderService, reminderScheduler } from "../services/reminder.service";
import { installDurableReminderDelivery } from "../services/reliable-reminder-delivery";
import { tavilyService } from "../services/tavily.service";

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}
function requireNonEmptyString(value: unknown, field: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`Missing required field: ${field}`);
  return result;
}
function parseDueAt(value: unknown): Date {
  const raw = requireNonEmptyString(value, "dueAt");
  const dueAt = new Date(raw);
  if (Number.isNaN(dueAt.getTime())) throw new Error(`Invalid dueAt timestamp: ${raw}`);
  if (dueAt.getTime() <= Date.now()) throw new Error("Reminder dueAt must be in the future.");
  return dueAt;
}

export const calculateMathTool: AssistantTool = {
  name: "calculate_math",
  description: "Performs deterministic mathematical calculations and formula evaluations.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: [], timeoutMs: 15000 },
  execute: async (input: unknown) => {
    const record = asRecord(input);
    const rawExpr = typeof record.expression === "string" ? record.expression : String(input || "");
    const sanitized = rawExpr.replace(/\^/g, "**").replace(/[^0-9+\-*/().%*\s]/gi, "").trim();
    if (!sanitized || !/^[\d\s+\-*/().%*]+$/.test(sanitized)) throw new Error("Invalid mathematical expression.");
    try {
      const result = new Function(`"use strict"; return (${sanitized});`)();
      if (typeof result !== "number" || !Number.isFinite(result)) throw new Error("Expression did not produce a finite number.");
      return { expression: sanitized, result, formatted: Number.isInteger(result) ? String(result) : result.toFixed(4) };
    } catch (err: any) {
      logger.warn({ expression: sanitized, error: err?.message }, "TOOL_CALCULATE_MATH_ERROR");
      throw new Error(`Math calculation failed: ${err?.message || "unknown error"}`);
    }
  },
};

export const searchInformationTool: AssistantTool = {
  name: "search_information",
  description: "Retrieves factual reference information from a real external knowledge source (Wikipedia REST API). Use web_search for current, broad, or multi-source research.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: [], timeoutMs: 30000 },
  execute: async (input: unknown, context) => {
    const record = asRecord(input);
    const query = requireNonEmptyString(record.query ?? input, "query");
    const encoded = encodeURIComponent(query.replace(/\s+/g, " ").trim());
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "Wingbuddy/1.0" }, signal: controller.signal });
      if (!response.ok) throw new Error(`External lookup failed with HTTP ${response.status}.`);
      const payload = await response.json() as { title?: string; extract?: string; description?: string; content_urls?: { desktop?: { page?: string } } };
      const extract = String(payload.extract || "").trim();
      if (!extract) throw new Error("External lookup returned no substantive finding.");
      return { query, title: payload.title || query, description: payload.description || "", findings: [extract], sourceUrl: payload.content_urls?.desktop?.page || url, retrievedAt: new Date().toISOString(), requestedByUserId: context.telegramUserId };
    } finally { clearTimeout(timeout); }
  },
};

export const webSearchTool: AssistantTool = {
  name: "web_search",
  description: "Searches the live web through Tavily and returns source-backed results. Use this dynamically when fresh, current, broad, or multi-source web evidence is needed. Do not invent results when Tavily is unavailable.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: ["web_research"], timeoutMs: 30000 },
  execute: async (input: unknown) => {
    const record = asRecord(input);
    const query = requireNonEmptyString(record.query, "query");
    return tavilyService.search({
      query,
      searchDepth: record.searchDepth === "advanced" ? "advanced" : "basic",
      topic: record.topic === "news" || record.topic === "finance" ? record.topic : "general",
      maxResults: typeof record.maxResults === "number" ? record.maxResults : undefined,
      timeRange: ["day", "week", "month", "year"].includes(String(record.timeRange)) ? record.timeRange as any : undefined,
      startDate: typeof record.startDate === "string" ? record.startDate : undefined,
      endDate: typeof record.endDate === "string" ? record.endDate : undefined,
      includeDomains: Array.isArray(record.includeDomains) ? record.includeDomains.map(String) : undefined,
      excludeDomains: Array.isArray(record.excludeDomains) ? record.excludeDomains.map(String) : undefined,
      country: typeof record.country === "string" ? record.country : undefined,
      includeRawContent: Boolean(record.includeRawContent),
    });
  },
};

export const webExtractTool: AssistantTool = {
  name: "web_extract",
  description: "Extracts readable content from one or more known web URLs through Tavily. Use after web_search when source content needs deeper inspection.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: ["web_research"], timeoutMs: 45000 },
  execute: async (input: unknown) => {
    const record = asRecord(input);
    const urls = Array.isArray(record.urls) ? record.urls.map(String) : typeof record.url === "string" ? [record.url] : [];
    if (!urls.length) throw new Error("Missing required field: urls");
    return tavilyService.extract(urls, record.extractDepth === "advanced" ? "advanced" : "basic");
  },
};

export const summarizeTextTool: AssistantTool = {
  name: "summarize_text",
  description: "Condenses and structures supplied text into a compact summary without external side effects.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: [], timeoutMs: 25000 },
  execute: async (input: unknown) => {
    const record = asRecord(input);
    const text = requireNonEmptyString(record.text ?? input, "text");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return { originalLength: text.length, pointCount: lines.length, summary: lines.join(" • ") };
  },
};

export const fetchUserMemoryTool: AssistantTool = {
  name: "fetch_user_memory",
  description: "Retrieves stored user memory through the authoritative memory service.",
  policy: { sideEffect: false, destructive: false, confirmationRequired: false, idempotent: true, requiredCapabilities: ["memory_read"], timeoutMs: 15000 },
  execute: async (_input: unknown, context) => {
    const { memoryService } = await import("../services/memory.service");
    const memories = await memoryService.getMemories(context.telegramUserId);
    return { retrieved: true, memories, count: memories.length };
  },
};

export const createTaskTool: AssistantTool = {
  name: "create_task",
  description: "Creates a persistent user task with a durable lifecycle and optional ordered steps.",
  policy: { sideEffect: true, destructive: false, confirmationRequired: false, idempotent: false, requiredCapabilities: [], timeoutMs: 20000 },
  execute: async (input: unknown, context) => {
    const record = asRecord(input);
    const title = requireNonEmptyString(record.title, "title");
    const goal = requireNonEmptyString(record.goal ?? title, "goal");
    const requestedStatus = typeof record.status === "string" && record.status.trim() ? record.status.trim() : "active";
    const validStatuses = ["pending", "active", "paused", "waiting"] as const;
    const status = validStatuses.includes(requestedStatus as any) ? requestedStatus as (typeof validStatuses)[number] : "active";
    const rawSteps = Array.isArray(record.steps) ? record.steps : undefined;
    const steps = rawSteps && rawSteps.length > 0 ? rawSteps.map((step, index) => {
      const item = typeof step === "string" ? { title: step } : asRecord(step);
      return { title: requireNonEmptyString(item.title, `steps[${index}].title`), description: typeof item.description === "string" ? item.description : undefined };
    }) : undefined;
    const task = await taskService.createTask({ telegramUserId: context.telegramUserId, conversationId: context.conversationId, title, goal, taskType: typeof record.taskType === "string" ? record.taskType : "general", status, steps, contextData: typeof record.contextData === "object" && record.contextData !== null ? record.contextData as Record<string, unknown> : undefined, metadataData: { source: "autonomous_tool", idempotencyKey: context.idempotencyKey || null } });
    return { taskId: task.task.id, title: task.task.title, goal: task.task.goal, status: task.task.status, currentStep: task.task.currentStep, steps: task.steps.map((step) => ({ id: step.id, order: step.stepOrder, title: step.title, status: step.status })), persisted: true };
  },
};

export const createReminderTool: AssistantTool = {
  name: "create_reminder",
  description: "Persists and schedules a user reminder for a future timestamp; delivery is handled by the durable reminder scheduler.",
  policy: { sideEffect: true, destructive: false, confirmationRequired: false, idempotent: false, requiredCapabilities: [], timeoutMs: 20000 },
  execute: async (input: unknown, context) => {
    const record = asRecord(input);
    const prompt = requireNonEmptyString(record.prompt, "prompt");
    const dueAt = parseDueAt(record.dueAt);
    const reminder = await reminderService.createReminder({ telegramUserId: context.telegramUserId, chatId: context.chatId, prompt, dueAt });
    return { reminderId: reminder.id, prompt: reminder.prompt, dueAt: reminder.dueAt.toISOString(), persisted: true };
  },
};

export const deleteUserSessionTool: AssistantTool = {
  name: "delete_user_session",
  description: "Permanently deletes user session data and cached records. Destructive operation requiring approval.",
  policy: { sideEffect: true, destructive: true, confirmationRequired: true, idempotent: false, requiredCapabilities: ["admin"], timeoutMs: 30000 },
  execute: async (_input: unknown, context) => {
    const { chatDatabaseService } = await import("@workspace/db");
    const deleted = await chatDatabaseService.deleteUserCompletely(context.telegramUserId);
    if (!deleted) throw new Error("User session deletion did not complete.");
    return { deleted: true, userId: context.telegramUserId, timestamp: new Date().toISOString() };
  },
};

let productionRegistryInstance: ToolRegistry | null = null;
export function getProductionToolRegistry(): ToolRegistry {
  if (!productionRegistryInstance) {
    installDurableReminderDelivery(reminderScheduler);
    const registry = new ToolRegistry();
    registry.register(calculateMathTool);
    registry.register(searchInformationTool);
    registry.register(webSearchTool);
    registry.register(webExtractTool);
    registry.register(summarizeTextTool);
    registry.register(fetchUserMemoryTool);
    registry.register(createTaskTool);
    registry.register(createReminderTool);
    registry.register(deleteUserSessionTool);
    productionRegistryInstance = registry;
  }
  return productionRegistryInstance;
}
