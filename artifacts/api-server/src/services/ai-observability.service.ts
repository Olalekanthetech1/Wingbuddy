import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { AIProviderId } from "./ai-provider.types";

export interface AIModelMetric {
  provider: AIProviderId;
  modelId: string;
  requests: number;
  successes: number;
  failures: number;
  streamedRequests: number;
  streamedFailures: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  ewmaLatencyMs: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface AIObservabilitySnapshot {
  generatedAt: string;
  windowStartedAt: string;
  totals: {
    requests: number;
    successes: number;
    failures: number;
    streamedRequests: number;
    streamedFailures: number;
    avgLatencyMs: number;
    successRate: number;
  };
  models: AIModelMetric[];
}

const KEY = "AI_OBSERVABILITY_METRICS";
const MAX_MODELS = 200;
const FLUSH_DEBOUNCE_MS = 2000;

function empty(provider: AIProviderId, modelId: string): AIModelMetric {
  const now = new Date().toISOString();
  return { provider, modelId, requests: 0, successes: 0, failures: 0, streamedRequests: 0, streamedFailures: 0, totalLatencyMs: 0, avgLatencyMs: 0, ewmaLatencyMs: 0, updatedAt: now };
}

function normalizeMetric(value: unknown): AIModelMetric | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AIModelMetric>;
  if (raw.provider !== "gemini" && raw.provider !== "groq" && raw.provider !== "mistral") return null;
  if (typeof raw.modelId !== "string" || !raw.modelId.trim()) return null;
  const metric = empty(raw.provider, raw.modelId.trim());
  metric.requests = Math.max(0, Number(raw.requests) || 0);
  metric.successes = Math.max(0, Number(raw.successes) || 0);
  metric.failures = Math.max(0, Number(raw.failures) || 0);
  metric.streamedRequests = Math.max(0, Number(raw.streamedRequests) || 0);
  metric.streamedFailures = Math.max(0, Number(raw.streamedFailures) || 0);
  metric.totalLatencyMs = Math.max(0, Number(raw.totalLatencyMs) || 0);
  metric.avgLatencyMs = Math.max(0, Number(raw.avgLatencyMs) || 0);
  metric.ewmaLatencyMs = Math.max(0, Number(raw.ewmaLatencyMs) || 0);
  metric.lastSuccessAt = typeof raw.lastSuccessAt === "string" ? raw.lastSuccessAt : undefined;
  metric.lastFailureAt = typeof raw.lastFailureAt === "string" ? raw.lastFailureAt : undefined;
  metric.lastError = typeof raw.lastError === "string" ? raw.lastError.slice(0, 1000) : undefined;
  metric.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();
  return metric;
}

export class AIObservabilityService {
  private metrics = new Map<string, AIModelMetric>();
  private loaded = false;
  private windowStartedAt = new Date().toISOString();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private dirty = false;

  private key(provider: AIProviderId, modelId: string): string { return `${provider}:${modelId}`; }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, KEY)).limit(1);
      if (rows[0]?.value) {
        const parsed = JSON.parse(rows[0].value) as { windowStartedAt?: string; models?: unknown[] };
        if (typeof parsed.windowStartedAt === "string") this.windowStartedAt = parsed.windowStartedAt;
        if (Array.isArray(parsed.models)) {
          for (const item of parsed.models) {
            const metric = normalizeMetric(item);
            if (metric) this.metrics.set(this.key(metric.provider, metric.modelId), metric);
          }
        }
      }
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Failed to hydrate AI observability metrics");
    }
    this.loaded = true;
  }

  private ensure(provider: AIProviderId, modelId: string): AIModelMetric {
    const key = this.key(provider, modelId);
    const current = this.metrics.get(key);
    if (current) return current;
    const metric = empty(provider, modelId);
    this.metrics.set(key, metric);
    return metric;
  }

  recordStart(provider: AIProviderId, modelId: string, streamed = false): void {
    const metric = this.ensure(provider, modelId);
    metric.requests += 1;
    if (streamed) metric.streamedRequests += 1;
    metric.updatedAt = new Date().toISOString();
    this.markDirty();
  }

  recordSuccess(provider: AIProviderId, modelId: string, latencyMs: number): void {
    const metric = this.ensure(provider, modelId);
    const latency = Math.max(0, Math.round(latencyMs));
    metric.successes += 1;
    metric.totalLatencyMs += latency;
    metric.avgLatencyMs = metric.successes > 0 ? Math.round(metric.totalLatencyMs / metric.successes) : 0;
    metric.ewmaLatencyMs = metric.ewmaLatencyMs ? metric.ewmaLatencyMs * 0.7 + latency * 0.3 : latency;
    metric.lastSuccessAt = new Date().toISOString();
    metric.updatedAt = new Date().toISOString();
    this.markDirty();
  }

  recordFailure(provider: AIProviderId, modelId: string, latencyMs: number, error: unknown, streamed = false): void {
    const metric = this.ensure(provider, modelId);
    const latency = Math.max(0, Math.round(latencyMs));
    metric.failures += 1;
    if (streamed) metric.streamedFailures += 1;
    metric.totalLatencyMs += latency;
    const completed = metric.successes + metric.failures;
    metric.avgLatencyMs = completed > 0 ? Math.round(metric.totalLatencyMs / completed) : 0;
    metric.ewmaLatencyMs = metric.ewmaLatencyMs ? metric.ewmaLatencyMs * 0.7 + latency * 0.3 : latency;
    metric.lastFailureAt = new Date().toISOString();
    metric.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    metric.updatedAt = new Date().toISOString();
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, FLUSH_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (!this.loaded || !this.dirty) return;
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = (async () => {
      try {
        const models = [...this.metrics.values()]
          .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId))
          .slice(0, MAX_MODELS);
        const payload = { windowStartedAt: this.windowStartedAt, models, updatedAt: new Date().toISOString() };
        await db.insert(systemSettingsTable).values({ key: KEY, value: JSON.stringify(payload), updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: JSON.stringify(payload), updatedAt: new Date() } });
        this.dirty = false;
      } catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Failed to persist AI observability metrics");
      } finally {
        this.flushInFlight = null;
      }
    })();
    return this.flushInFlight;
  }

  reset(provider?: AIProviderId, modelId?: string): void {
    if (provider && modelId) {
      this.metrics.delete(this.key(provider, modelId));
    } else if (provider) {
      for (const key of this.metrics.keys()) if (key.startsWith(`${provider}:`)) this.metrics.delete(key);
    } else if (modelId) {
      for (const key of this.metrics.keys()) if (key.endsWith(`:${modelId}`)) this.metrics.delete(key);
    } else {
      this.metrics.clear();
    }
    this.markDirty();
  }

  snapshot(): AIObservabilitySnapshot {
    const models = [...this.metrics.values()].map((metric) => ({ ...metric }));
    const totals = models.reduce((acc, metric) => ({
      requests: acc.requests + metric.requests,
      successes: acc.successes + metric.successes,
      failures: acc.failures + metric.failures,
      streamedRequests: acc.streamedRequests + metric.streamedRequests,
      streamedFailures: acc.streamedFailures + metric.streamedFailures,
      totalLatencyMs: acc.totalLatencyMs + metric.totalLatencyMs,
    }), { requests: 0, successes: 0, failures: 0, streamedRequests: 0, streamedFailures: 0, totalLatencyMs: 0 });
    const completed = totals.successes + totals.failures;
    return {
      generatedAt: new Date().toISOString(),
      windowStartedAt: this.windowStartedAt,
      totals: {
        requests: totals.requests,
        successes: totals.successes,
        failures: totals.failures,
        streamedRequests: totals.streamedRequests,
        streamedFailures: totals.streamedFailures,
        avgLatencyMs: completed ? Math.round(totals.totalLatencyMs / completed) : 0,
        successRate: completed ? Number(((totals.successes / completed) * 100).toFixed(2)) : 0,
      },
      models: models.sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId)),
    };
  }
}

export const aiObservabilityService = new AIObservabilityService();