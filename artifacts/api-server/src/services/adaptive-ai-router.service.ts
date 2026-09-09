import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { unifiedModelRegistryService, type UnifiedModelRecord, type UnifiedModelRole } from "./unified-model-registry.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIStreamChunk } from "./ai-provider.types";

export type AIRoutingStrategy = "adaptive" | "primary_first" | "priority_only";

export interface AIRoutingPolicy {
  strategy: AIRoutingStrategy;
  capabilityWeight: number;
  healthWeight: number;
  latencyWeight: number;
  priorityWeight: number;
  maxAttempts: number;
  updatedAt: string;
}

export interface AIRoutingContext {
  mode?: string;
  isDeepReasoning?: boolean;
  isExtraction?: boolean;
  enableSearch?: boolean;
  requiresVision?: boolean;
  requiresTools?: boolean;
  preferredProvider?: AIProviderId;
  preferredModelId?: string;
}

export interface AIRoutingCandidate {
  model: UnifiedModelRecord;
  score: number;
  reasons: string[];
  healthScore: number;
  latencyMs: number;
}

const POLICY_KEY = "AI_ROUTING_POLICY";
const DEFAULT_POLICY: AIRoutingPolicy = {
  strategy: "adaptive",
  capabilityWeight: 40,
  healthWeight: 25,
  latencyWeight: 15,
  priorityWeight: 20,
  maxAttempts: 3,
  updatedAt: new Date().toISOString(),
};

interface ModelHealth {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  ewmaLatencyMs: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  cooldownUntil?: number;
}

function finite(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

export class AdaptiveAIRouterService {
  private policyCache: AIRoutingPolicy | null = null;
  private policyCacheAt = 0;
  private readonly policyCacheTtlMs = 3000;
  private readonly health = new Map<string, ModelHealth>();

  private defaultHealth(): ModelHealth { return { successes: 0, failures: 0, consecutiveFailures: 0, ewmaLatencyMs: 0 }; }

  private getHealth(model: UnifiedModelRecord): ModelHealth {
    const current = this.health.get(model.id);
    if (current) return current;
    const initial = this.defaultHealth();
    this.health.set(model.id, initial);
    return initial;
  }

  private healthScore(model: UnifiedModelRecord): number {
    const health = this.getHealth(model);
    if (health.cooldownUntil && Date.now() < health.cooldownUntil) return 0;
    const attempts = health.successes + health.failures;
    const reliability = attempts === 0 ? 80 : (health.successes / Math.max(1, attempts)) * 100;
    const penalty = Math.min(45, health.consecutiveFailures * 15);
    return clamp(reliability - penalty, 0, 100);
  }

  private latencyScore(model: UnifiedModelRecord): number {
    const latency = this.getHealth(model).ewmaLatencyMs;
    if (!latency) return 70;
    return clamp(100 - Math.max(0, latency - 300) / 25, 10, 100);
  }

  private async loadPolicy(): Promise<AIRoutingPolicy> {
    if (this.policyCache && Date.now() - this.policyCacheAt < this.policyCacheTtlMs) return this.policyCache;
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, POLICY_KEY)).limit(1);
      if (rows[0]?.value) {
        this.policyCache = this.normalizePolicy(JSON.parse(rows[0].value) as Partial<AIRoutingPolicy>);
        this.policyCacheAt = Date.now();
        return this.policyCache;
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to read adaptive AI routing policy");
    }
    this.policyCache = this.normalizePolicy(DEFAULT_POLICY);
    this.policyCacheAt = Date.now();
    return this.policyCache;
  }

  private normalizePolicy(raw: Partial<AIRoutingPolicy>): AIRoutingPolicy {
    const strategy: AIRoutingStrategy = raw.strategy === "primary_first" || raw.strategy === "priority_only" ? raw.strategy : "adaptive";
    return { strategy, capabilityWeight: clamp(finite(raw.capabilityWeight, DEFAULT_POLICY.capabilityWeight), 0, 100), healthWeight: clamp(finite(raw.healthWeight, DEFAULT_POLICY.healthWeight), 0, 100), latencyWeight: clamp(finite(raw.latencyWeight, DEFAULT_POLICY.latencyWeight), 0, 100), priorityWeight: clamp(finite(raw.priorityWeight, DEFAULT_POLICY.priorityWeight), 0, 100), maxAttempts: clamp(Math.round(finite(raw.maxAttempts, DEFAULT_POLICY.maxAttempts)), 1, 6), updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString() };
  }

  async getPolicy(): Promise<AIRoutingPolicy> { return { ...(await this.loadPolicy()) }; }

  async setPolicy(patch: Partial<Omit<AIRoutingPolicy, "updatedAt">>): Promise<AIRoutingPolicy> {
    const current = await this.loadPolicy();
    const next = this.normalizePolicy({ ...current, ...patch, updatedAt: new Date().toISOString() });
    await db.insert(systemSettingsTable).values({ key: POLICY_KEY, value: JSON.stringify(next), updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
    this.policyCache = next;
    this.policyCacheAt = Date.now();
    return { ...next };
  }

  async candidates(context: AIRoutingContext = {}): Promise<AIRoutingCandidate[]> {
    const [models, providers, policy] = await Promise.all([unifiedModelRegistryService.list(), aiProviderRegistryService.list(), this.loadPolicy()]);
    const providerMap = new Map(providers.map((item) => [item.id, item]));
    const eligible = models.filter((model) => {
      if (!model.enabled || model.roles.includes("embedding")) return false;
      const provider = providerMap.get(model.provider);
      if (!provider?.enabled || !provider.adapter || !provider.configured) return false;
      if (context.preferredProvider && model.provider !== context.preferredProvider) return false;
      if (context.preferredModelId && model.modelId !== context.preferredModelId) return false;
      if (context.requiresVision && !model.capabilities.includes("vision") && !provider.capabilities.includes("vision")) return false;
      if (context.requiresTools && !model.capabilities.includes("tool_calling") && !provider.capabilities.includes("tool_calling")) return false;
      if (context.enableSearch && model.provider !== "gemini") return false;
      return this.healthScore(model) > 0;
    });
    const hasRole = (model: UnifiedModelRecord, role: UnifiedModelRole): boolean => model.roles.includes(role);
    const primary = eligible.find((model) => hasRole(model, "primary"));
    const preferredRole: UnifiedModelRole | undefined = context.isExtraction ? "extraction" : context.isDeepReasoning ? "reasoning" : context.enableSearch ? "fast" : undefined;

    return eligible.map((model) => {
      const capabilityMatches = [
        context.requiresVision ? (model.capabilities.includes("vision") ? 1 : 0) : undefined,
        context.requiresTools ? (model.capabilities.includes("tool_calling") ? 1 : 0) : undefined,
        context.enableSearch ? (model.provider === "gemini" ? 1 : 0) : undefined,
        context.isDeepReasoning ? (hasRole(model, "reasoning") || model.capabilities.includes("reasoning") ? 1 : 0) : undefined,
        context.isExtraction ? (hasRole(model, "extraction") ? 1 : 0) : undefined,
      ].filter((value): value is number => value !== undefined);
      const capabilityMatch = capabilityMatches.length ? (capabilityMatches.reduce((a, b) => a + b, 0) / capabilityMatches.length) * 100 : 70;
      const roleBonus = preferredRole && hasRole(model, preferredRole) ? 30 : 0;
      const primaryBonus = primary?.id === model.id ? 20 : 0;
      const priorityScore = 100 - clamp(model.priority * 8, 0, 100);
      const healthScore = this.healthScore(model);
      const latencyScore = this.latencyScore(model);
      const totalWeight = Math.max(1, policy.capabilityWeight + policy.healthWeight + policy.latencyWeight + policy.priorityWeight);
      let score = (capabilityMatch * policy.capabilityWeight + healthScore * policy.healthWeight + latencyScore * policy.latencyWeight + priorityScore * policy.priorityWeight) / totalWeight;
      if (policy.strategy === "primary_first" && primary?.id === model.id) score += 100;
      if (policy.strategy === "priority_only") score = priorityScore;
      score += roleBonus + primaryBonus;
      const reasons: string[] = [];
      if (hasRole(model, "primary")) reasons.push("primary");
      if (preferredRole && hasRole(model, preferredRole)) reasons.push(preferredRole);
      if (capabilityMatch >= 90) reasons.push("capability match");
      if (healthScore >= 85) reasons.push("healthy");
      if (latencyScore >= 85) reasons.push("low latency");
      return { model, score, reasons, healthScore, latencyMs: this.getHealth(model).ewmaLatencyMs };
    }).sort((a, b) => b.score - a.score || a.model.priority - b.model.priority);
  }

  recordSuccess(modelId: string, latencyMs: number): void {
    const health = this.health.get(modelId) || this.defaultHealth();
    health.successes += 1;
    health.consecutiveFailures = 0;
    health.lastSuccessAt = new Date().toISOString();
    health.ewmaLatencyMs = health.ewmaLatencyMs ? health.ewmaLatencyMs * 0.7 + latencyMs * 0.3 : latencyMs;
    health.cooldownUntil = undefined;
    this.health.set(modelId, health);
  }

  recordFailure(modelId: string, error: unknown): void {
    const health = this.health.get(modelId) || this.defaultHealth();
    health.failures += 1;
    health.consecutiveFailures += 1;
    health.lastFailureAt = new Date().toISOString();
    health.lastError = error instanceof Error ? error.message : String(error);
    if (health.consecutiveFailures >= 3) health.cooldownUntil = Date.now() + Math.min(60_000, 5_000 * 2 ** (health.consecutiveFailures - 3));
    this.health.set(modelId, health);
  }

  async route(request: AIChatRequest, context: AIRoutingContext = {}, geminiExecutor?: () => Promise<AIChatResponse>): Promise<{ response: AIChatResponse; candidate: AIRoutingCandidate; attempts: string[] }> {
    const policy = await this.loadPolicy();
    const candidates = await this.candidates(context);
    if (!candidates.length) throw new Error("No eligible AI model is available for the requested capability.");
    const attempts: string[] = [];
    const limited = candidates.slice(0, policy.maxAttempts);
    let lastError: unknown;
    for (const candidate of limited) {
      const started = Date.now();
      const key = `${candidate.model.provider}/${candidate.model.modelId}`;
      attempts.push(key);
      try {
        let response: AIChatResponse;
        if (candidate.model.provider === "gemini" && geminiExecutor) {
          response = await geminiExecutor();
        } else {
          response = (await aiProviderGatewayService.chat(candidate.model.provider, { ...request, model: candidate.model.modelId })).result;
        }
        this.recordSuccess(candidate.model.id, Date.now() - started);
        return { response: { ...response, provider: candidate.model.provider, model: candidate.model.modelId }, candidate, attempts };
      } catch (error) {
        lastError = error;
        this.recordFailure(candidate.model.id, error);
        logger.warn({ provider: candidate.model.provider, model: candidate.model.modelId, error: error instanceof Error ? error.message : String(error) }, "Adaptive AI candidate failed; trying next candidate");
      }
    }
    throw new Error(`Adaptive AI routing exhausted ${attempts.length} candidate(s). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async *routeStream(request: AIChatRequest, context: AIRoutingContext = {}, geminiExecutor?: (onChunk?: (chunk: string) => Promise<void> | void) => Promise<string>): AsyncGenerator<AIStreamChunk> {
    const policy = await this.loadPolicy();
    const candidates = await this.candidates(context);
    if (!candidates.length) throw new Error("No eligible AI model is available for the requested capability.");
    const limited = candidates.slice(0, policy.maxAttempts);
    let lastError: unknown;
    for (const candidate of limited) {
      const started = Date.now();
      let emitted = false;
      try {
        if (candidate.model.provider === "gemini" && geminiExecutor) {
          let full = "";
          const text = await geminiExecutor((chunk) => { emitted = true; full = chunk; });
          this.recordSuccess(candidate.model.id, Date.now() - started);
          if (!full && text) full = text;
          if (!full) throw new Error("Gemini streaming returned an empty response.");
          yield { provider: "gemini", model: candidate.model.modelId, delta: full, done: false };
          yield { provider: "gemini", model: candidate.model.modelId, delta: "", done: true };
          return;
        }
        for await (const chunk of aiProviderGatewayService.stream(candidate.model.provider, { ...request, model: candidate.model.modelId })) {
          emitted = emitted || Boolean(chunk.delta);
          yield chunk;
        }
        this.recordSuccess(candidate.model.id, Date.now() - started);
        return;
      } catch (error) {
        lastError = error;
        this.recordFailure(candidate.model.id, error);
        if (emitted) throw error;
        logger.warn({ provider: candidate.model.provider, model: candidate.model.modelId, error: error instanceof Error ? error.message : String(error) }, "Adaptive AI stream candidate failed before output; trying next candidate");
      }
    }
    throw new Error(`Adaptive AI streaming exhausted candidates. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async healthSnapshot() {
    const models = await unifiedModelRegistryService.list();
    return models.filter((model) => !model.roles.includes("embedding")).map((model) => {
      const health = this.getHealth(model);
      return { provider: model.provider, modelId: model.modelId, id: model.id, successes: health.successes, failures: health.failures, consecutiveFailures: health.consecutiveFailures, ewmaLatencyMs: Math.round(health.ewmaLatencyMs), healthScore: Math.round(this.healthScore(model)), lastSuccessAt: health.lastSuccessAt || null, lastFailureAt: health.lastFailureAt || null, cooldownUntil: health.cooldownUntil || null, lastError: health.lastError || null };
    });
  }
}

export const adaptiveAIRouterService = new AdaptiveAIRouterService();
