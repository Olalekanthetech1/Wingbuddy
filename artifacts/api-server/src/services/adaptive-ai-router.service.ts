import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { aiObservabilityService } from "./ai-observability.service";
import { unifiedModelRegistryService, type UnifiedModelRecord, type UnifiedModelRole } from "./unified-model-registry.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIStreamChunk } from "./ai-provider.types";

export type AIRoutingStrategy = "adaptive" | "primary_first" | "priority_only";
export interface AIRoutingPolicy { strategy: AIRoutingStrategy; capabilityWeight: number; healthWeight: number; latencyWeight: number; priorityWeight: number; maxAttempts: number; updatedAt: string; }
export interface AIRoutingContext {
  mode?: string;
  isDeepReasoning?: boolean;
  isExtraction?: boolean;
  enableSearch?: boolean;
  requiresVision?: boolean;
  requiresTools?: boolean;
  preferredProvider?: AIProviderId;
  preferredModelId?: string;
  userTier?: "free" | "pro" | "vip";
  userCustomModelOverride?: string | null;
  personaPreferredModel?: string | null;
}
export interface AIRoutingCandidate { model: UnifiedModelRecord; score: number; reasons: string[]; healthScore: number; latencyMs: number; }

const POLICY_KEY = "AI_ROUTING_POLICY";
const DEFAULT_POLICY: AIRoutingPolicy = { strategy: "adaptive", capabilityWeight: 50, healthWeight: 25, latencyWeight: 15, priorityWeight: 10, maxAttempts: 3, updatedAt: new Date().toISOString() };
const PRIMARY_ROLE_BONUS = 15;

interface ModelHealth { successes: number; failures: number; consecutiveFailures: number; ewmaLatencyMs: number; lastSuccessAt?: string; lastFailureAt?: string; lastError?: string; cooldownUntil?: number; }
function finite(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function isQuotaOrRateLimit(error: unknown): boolean {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : undefined;
  const status = typeof record?.status === "number" ? record.status : undefined;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("429") || message.includes("quota") || message.includes("resource_exhausted") || message.includes("rate limit") || message.includes("too many requests") || message.includes("tokens per minute") || message.includes("tpm");
}

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
    const penalty = Math.min(60, health.consecutiveFailures * 20);
    return clamp(reliability - penalty, 0, 100);
  }
  private latencyScore(model: UnifiedModelRecord): number {
    const latency = this.getHealth(model).ewmaLatencyMs;
    if (!latency) return 70;
    return clamp(100 - Math.max(0, latency - 300) / 25, 10, 100);
  }

  async initializeHealth(): Promise<void> {
    await aiObservabilityService.initialize();
    const [snapshot, models] = await Promise.all([Promise.resolve(aiObservabilityService.snapshot()), unifiedModelRegistryService.list()]);
    const modelIds = new Map(models.map((model) => [`${model.provider}:${model.modelId}`, model.id]));
    for (const metric of snapshot.models) {
      const key = modelIds.get(`${metric.provider}:${metric.modelId}`) || `${metric.provider}:${metric.modelId}`;
      const attempts = metric.successes + metric.failures;
      const health = this.health.get(key) || this.defaultHealth();
      health.successes = metric.successes;
      health.failures = metric.failures;
      health.consecutiveFailures = attempts > 0 && metric.successes === 0 ? Math.min(3, metric.failures) : 0;
      health.ewmaLatencyMs = metric.ewmaLatencyMs || metric.avgLatencyMs || 0;
      health.lastSuccessAt = metric.lastSuccessAt;
      health.lastFailureAt = metric.lastFailureAt;
      health.lastError = metric.lastError;
      if (attempts > 0 && metric.failures > metric.successes && metric.lastFailureAt) health.cooldownUntil = Date.now() + 10_000;
      this.health.set(key, health);
    }
  }

  private async loadPolicy(): Promise<AIRoutingPolicy> {
    if (this.policyCache && Date.now() - this.policyCacheAt < this.policyCacheTtlMs) return this.policyCache;
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, POLICY_KEY)).limit(1);
      if (rows[0]?.value) { this.policyCache = this.normalizePolicy(JSON.parse(rows[0].value) as Partial<AIRoutingPolicy>); this.policyCacheAt = Date.now(); return this.policyCache; }
    } catch (error) { logger.warn({ error: String(error) }, "Failed to read adaptive AI routing policy"); }
    this.policyCache = this.normalizePolicy(DEFAULT_POLICY);
    this.policyCacheAt = Date.now();
    return this.policyCache;
  }

  private normalizePolicy(raw: Partial<AIRoutingPolicy>): AIRoutingPolicy {
    const strategy: AIRoutingStrategy = raw.strategy === "primary_first" || raw.strategy === "priority_only" ? raw.strategy : "adaptive";
    return {
      strategy,
      capabilityWeight: clamp(finite(raw.capabilityWeight, DEFAULT_POLICY.capabilityWeight), 0, 100),
      healthWeight: clamp(finite(raw.healthWeight, DEFAULT_POLICY.healthWeight), 0, 100),
      latencyWeight: clamp(finite(raw.latencyWeight, DEFAULT_POLICY.latencyWeight), 0, 100),
      priorityWeight: clamp(finite(raw.priorityWeight, DEFAULT_POLICY.priorityWeight), 0, 100),
      maxAttempts: clamp(Math.round(finite(raw.maxAttempts, DEFAULT_POLICY.maxAttempts)), 1, 6),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
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
      if (context.enableSearch && !model.capabilities.includes("web_search") && !provider.capabilities.includes("web_search")) return false;
      return this.healthScore(model) > 0;
    });
    const hasRole = (model: UnifiedModelRecord, role: UnifiedModelRole): boolean => model.roles.includes(role);
    
    let preferredCapability: string | undefined = context.isExtraction ? "extraction" : context.isDeepReasoning ? "reasoning" : undefined;
    if (!preferredCapability && context.mode) {
      if (context.mode === "fast" || context.mode === "prompt_enhancement" || context.mode === "video_prompt_enhancement") preferredCapability = "fast";
      else if (context.mode === "reasoning") preferredCapability = "reasoning";
      else if (context.mode === "extraction") preferredCapability = "extraction";
      else if (context.mode === "embedding") preferredCapability = "embedding";
    }

    const reqCapabilities = (context as any).capabilities || [];
    const targetPrimaryRole: UnifiedModelRole = 
      reqCapabilities.includes("image_generation") ? "primary_image" :
      reqCapabilities.includes("video_generation") ? "primary_video" :
      reqCapabilities.includes("embedding") ? "primary_embedding" : "primary_chat";
      
    const isTargetPrimary = (m: UnifiedModelRecord) => m.roles.includes(targetPrimaryRole) || (targetPrimaryRole === "primary_chat" && m.roles.includes("primary"));

    const scored = eligible.map((model) => {
      let capabilityAffinityScore = 0;
      if (preferredCapability && model.capabilities.includes(preferredCapability)) {
        capabilityAffinityScore += 250;
      }

      if (context.requiresVision && !model.capabilities.includes("vision") && !providerMap.get(model.provider)?.capabilities.includes("vision")) {
         // Should be filtered out already, but just in case
      }

      const primaryBonus = isTargetPrimary(model) ? PRIMARY_ROLE_BONUS : 0;
      const priorityScore = 100 - clamp(model.priority * 8, 0, 100);
      const healthScore = this.healthScore(model);
      const latencyScore = this.latencyScore(model);
      
      const totalWeight = Math.max(1, policy.capabilityWeight + policy.healthWeight + policy.latencyWeight + policy.priorityWeight);
      
      let baseScore = (100 * policy.capabilityWeight + healthScore * policy.healthWeight + latencyScore * policy.latencyWeight + priorityScore * policy.priorityWeight) / totalWeight;
      
      let score = baseScore + capabilityAffinityScore;
      
      if (policy.strategy === "priority_only") score = priorityScore + capabilityAffinityScore;
      if (policy.strategy === "adaptive" && !context.preferredProvider && !context.preferredModelId) score += primaryBonus;
      if (policy.strategy === "primary_first" && isTargetPrimary(model)) score += PRIMARY_ROLE_BONUS;
      if (context.preferredProvider || context.preferredModelId) score += isTargetPrimary(model) ? PRIMARY_ROLE_BONUS / 2 : 0;
      
      const reasons: string[] = [];
      if (isTargetPrimary(model)) reasons.push("primary");
      if (preferredCapability && model.capabilities.includes(preferredCapability)) reasons.push(`capability affinity: ${preferredCapability}`);
      if (healthScore >= 85) reasons.push("healthy");
      if (latencyScore >= 85) reasons.push("low latency");

      // Adaptive User Tier & Model Override routing
      const override = context.userCustomModelOverride?.trim().toLowerCase();
      const personaPref = context.personaPreferredModel?.trim().toLowerCase();
      if (override && (model.id.toLowerCase() === override || model.modelId.toLowerCase() === override)) {
        score += 2500;
        reasons.push("user-assigned model override");
      } else if (personaPref && (model.id.toLowerCase() === personaPref || model.modelId.toLowerCase() === personaPref || model.id.toLowerCase().includes(personaPref))) {
        score += 1800;
        reasons.push("persona preferred model");
      } else if (context.userTier === "free") {
        // Free tier routes toward ultra-fast, cost-effective models
        if (model.capabilities.includes("fast") || model.roles.includes("fast")) {
          score += 200;
          reasons.push("free-tier fast routing");
        }
        if ((model.capabilities.includes("reasoning") || model.roles.includes("reasoning")) && !context.isDeepReasoning) {
          score -= 80;
        }
      } else if (context.userTier === "vip") {
        // VIP tier boosts heavy reasoning models and primary models
        if (model.capabilities.includes("reasoning") || model.roles.includes("reasoning") || isTargetPrimary(model)) {
          score += 300;
          reasons.push("vip priority reasoning");
        }
      } else if (context.userTier === "pro") {
        if (isTargetPrimary(model) || model.capabilities.includes("vision")) {
          score += 100;
          reasons.push("pro tier priority");
        }
      }
      
      return { model, score, reasons, healthScore, latencyMs: this.getHealth(model).ewmaLatencyMs };
    });
    const sorted = scored.sort((a, b) => b.score - a.score || a.model.priority - b.model.priority || a.model.provider.localeCompare(b.model.provider));
    if (policy.strategy !== "primary_first") return sorted;
    const primary = sorted.filter((candidate) => isTargetPrimary(candidate.model));
    const rest = sorted.filter((candidate) => !isTargetPrimary(candidate.model));
    return [...primary, ...rest];
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
    if (isQuotaOrRateLimit(error)) health.cooldownUntil = Date.now() + 30_000;
    else if (health.consecutiveFailures >= 3) health.cooldownUntil = Date.now() + Math.min(60_000, 5_000 * 2 ** (health.consecutiveFailures - 3));
    this.health.set(modelId, health);
  }

  resetHealth(modelId?: string): void { if (modelId) this.health.delete(modelId); else this.health.clear(); }

  async route(request: AIChatRequest, context: AIRoutingContext = {}): Promise<{ response: AIChatResponse; candidate: AIRoutingCandidate; attempts: string[] }> {
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
      aiObservabilityService.recordStart(candidate.model.provider, candidate.model.modelId, false);
      try {
        const response = (await aiProviderGatewayService.chat(candidate.model.provider, { ...request, model: candidate.model.modelId })).result;
        const latencyMs = Date.now() - started;
        this.recordSuccess(candidate.model.id, latencyMs);
        aiObservabilityService.recordSuccess(candidate.model.provider, candidate.model.modelId, latencyMs);
        logger.info({ provider: candidate.model.provider, model: candidate.model.modelId, roles: candidate.model.roles, strategy: policy.strategy, reasons: candidate.reasons, attempts }, "Unified AI model selected");
        return { response: { ...response, provider: candidate.model.provider, model: candidate.model.modelId }, candidate, attempts };
      } catch (error) {
        const latencyMs = Date.now() - started;
        lastError = error;
        this.recordFailure(candidate.model.id, error);
        aiObservabilityService.recordFailure(candidate.model.provider, candidate.model.modelId, latencyMs, error);
        logger.warn({ provider: candidate.model.provider, model: candidate.model.modelId, roles: candidate.model.roles, error: error instanceof Error ? error.message : String(error) }, "Adaptive AI candidate failed; selecting next eligible provider/model");
      }
    }
    throw new Error(`Adaptive AI routing exhausted ${attempts.length} candidate(s). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async *routeStream(request: AIChatRequest, context: AIRoutingContext = {}): AsyncGenerator<AIStreamChunk> {
    const policy = await this.loadPolicy();
    const candidates = await this.candidates(context);
    if (!candidates.length) throw new Error("No eligible AI model is available for the requested capability.");
    const limited = candidates.slice(0, policy.maxAttempts);
    let lastError: unknown;
    for (const candidate of limited) {
      const started = Date.now();
      let emitted = false;
      aiObservabilityService.recordStart(candidate.model.provider, candidate.model.modelId, true);
      try {
        for await (const chunk of aiProviderGatewayService.stream(candidate.model.provider, { ...request, model: candidate.model.modelId })) {
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        const latencyMs = Date.now() - started;
        this.recordSuccess(candidate.model.id, latencyMs);
        aiObservabilityService.recordSuccess(candidate.model.provider, candidate.model.modelId, latencyMs);
        logger.info({ provider: candidate.model.provider, model: candidate.model.modelId, roles: candidate.model.roles, strategy: policy.strategy, reasons: candidate.reasons }, "Unified AI streaming model selected");
        return;
      } catch (error) {
        const latencyMs = Date.now() - started;
        lastError = error;
        this.recordFailure(candidate.model.id, error);
        aiObservabilityService.recordFailure(candidate.model.provider, candidate.model.modelId, latencyMs, error, true);
        if (emitted) throw error;
        logger.warn({ provider: candidate.model.provider, model: candidate.model.modelId, roles: candidate.model.roles, error: error instanceof Error ? error.message : String(error) }, "Adaptive AI stream candidate failed before output; selecting next eligible provider/model");
      }
    }
    throw new Error(`Adaptive AI streaming exhausted candidates. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async healthSnapshot() {
    const models = await unifiedModelRegistryService.list();
    return models.filter((model) => !model.roles.includes("embedding")).map((model) => {
      const health = this.getHealth(model);
      return { provider: model.provider, modelId: model.modelId, id: model.id, roles: [...model.roles], successes: health.successes, failures: health.failures, consecutiveFailures: health.consecutiveFailures, ewmaLatencyMs: Math.round(health.ewmaLatencyMs), healthScore: Math.round(this.healthScore(model)), lastSuccessAt: health.lastSuccessAt || null, lastFailureAt: health.lastFailureAt || null, cooldownUntil: health.cooldownUntil || null, lastError: health.lastError || null };
    });
  }
}

export const adaptiveAIRouterService = new AdaptiveAIRouterService();