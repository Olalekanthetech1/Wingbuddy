import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import type { AIProviderId } from "./ai-provider.types";

export type UnifiedModelRole = "primary" | "primary_chat" | "primary_image" | "primary_video" | "primary_embedding" | "fast" | "reasoning" | "extraction" | "embedding";
export interface UnifiedModelRecord { id: string; provider: AIProviderId; modelId: string; name: string; roles: UnifiedModelRole[]; enabled: boolean; priority: number; capabilities: string[]; createdAt: string; updatedAt: string; }
const REGISTRY_KEY = "AI_MODEL_REGISTRY";
const LEGACY_GEMINI_KEY = "GEMINI_MODEL_REGISTRY";
const ROLES: UnifiedModelRole[] = ["primary", "primary_chat", "primary_image", "primary_video", "primary_embedding", "fast", "reasoning", "extraction", "embedding"];
const SUPPORTED_PROVIDERS: AIProviderId[] = ["gemini", "groq", "mistral", "huggingface"];
const makeId = (provider: AIProviderId, modelId: string): string => `${provider}:${modelId}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function parseList(value?: string): string[] { return String(value || "").split(",").map((v) => v.trim()).filter(Boolean); }

export interface ModelUpgradeRule {
  pattern: RegExp | string;
  targetModelId: string;
  provider?: AIProviderId;
  reason?: string;
}

const DEFAULT_UPGRADE_RULES: ModelUpgradeRule[] = [
  // Gemini deprecations / modern generation upgrades
  { pattern: /^gemini-1\.5-flash/i, targetModelId: "gemini-3.6-flash", provider: "gemini", reason: "Gemini 1.5 Flash upgraded to Gemini 3.6 Flash" },
  { pattern: /^gemini-2\.5-flash/i, targetModelId: "gemini-3.6-flash", provider: "gemini", reason: "Gemini 2.5 Flash upgraded to Gemini 3.6 Flash" },
  { pattern: /^gemini-1\.5-pro/i, targetModelId: "gemini-3.7-flash", provider: "gemini", reason: "Gemini 1.5 Pro upgraded to Gemini 3.7 Flash" },
  { pattern: /^gemini-2\.5-pro/i, targetModelId: "gemini-3.7-flash", provider: "gemini", reason: "Gemini 2.5 Pro upgraded to Gemini 3.7 Flash" },
  { pattern: /^gemini-embedding-001$/i, targetModelId: "text-embedding-004", provider: "gemini", reason: "Gemini embedding-001 upgraded to text-embedding-004" },
  { pattern: /^text-embedding-001$/i, targetModelId: "text-embedding-004", provider: "gemini", reason: "text-embedding-001 upgraded to text-embedding-004" },
  // Groq model upgrades
  { pattern: /^llama-3-8b/i, targetModelId: "llama-3.1-8b-instant", provider: "groq", reason: "Llama 3 8B upgraded to Llama 3.1 8B Instant" },
  { pattern: /^llama-3-70b/i, targetModelId: "llama-3.3-70b-versatile", provider: "groq", reason: "Llama 3 70B upgraded to Llama 3.3 70B Versatile" },
  // Mistral model upgrades
  { pattern: /^mistral-tiny/i, targetModelId: "mistral-small-latest", provider: "mistral", reason: "Mistral Tiny upgraded to Mistral Small Latest" },
  { pattern: /^mistral-medium/i, targetModelId: "mistral-large-latest", provider: "mistral", reason: "Mistral Medium upgraded to Mistral Large Latest" },
];

export function resolveDynamicModelUpgrade(modelId: string, provider?: AIProviderId): string {
  if (!modelId) return modelId;
  const trimmed = modelId.trim();

  // 1. Check dynamic environment / custom rules
  const customMap = process.env.MODEL_UPGRADE_MAP || process.env.MODEL_ALIAS_MAPPINGS;
  if (customMap) {
    try {
      if (customMap.startsWith("{")) {
        const parsed = JSON.parse(customMap);
        if (parsed[trimmed]) return parsed[trimmed];
      } else {
        const pairs = customMap.split(",").map(p => p.trim());
        for (const pair of pairs) {
          const [from, to] = pair.split(":").map(s => s.trim());
          if (from && to && (from.toLowerCase() === trimmed.toLowerCase() || new RegExp(`^${from}$`, "i").test(trimmed))) {
            return to;
          }
        }
      }
    } catch {
      // ignore parse errors and fallback to built-in rules
    }
  }

  // 2. Check default upgrade rules
  for (const rule of DEFAULT_UPGRADE_RULES) {
    if (rule.provider && provider && rule.provider !== provider) continue;
    if (typeof rule.pattern === "string") {
      if (rule.pattern.toLowerCase() === trimmed.toLowerCase()) {
        return rule.targetModelId;
      }
    } else if (rule.pattern.test(trimmed)) {
      return rule.targetModelId;
    }
  }

  return trimmed;
}

function normalize(value: unknown): UnifiedModelRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<UnifiedModelRecord>;
    return typeof candidate.modelId === "string" && SUPPORTED_PROVIDERS.includes(candidate.provider as AIProviderId);
  }).map((item) => {
    const candidate = item as Partial<UnifiedModelRecord>;
    const provider = candidate.provider as AIProviderId;
    const modelId = resolveDynamicModelUpgrade(candidate.modelId!, provider);
    const roles = unique(Array.isArray(candidate.roles) ? candidate.roles.filter((role): role is UnifiedModelRole => ROLES.includes(role as UnifiedModelRole)) : []);
    const embedding = roles.includes("embedding");
    return {
      id: candidate.id || makeId(provider, modelId),
      provider,
      modelId,
      name: typeof candidate.name === "string" && candidate.name.trim() && candidate.name !== candidate.modelId ? candidate.name.trim() : modelId,
      roles: embedding ? roles.filter((role) => role !== "primary" && role !== "primary_chat") : roles,
      enabled: candidate.enabled !== false,
      priority: Number.isFinite(candidate.priority) ? Number(candidate.priority) : 0,
      capabilities: unique(Array.isArray(candidate.capabilities) && candidate.capabilities.length ? candidate.capabilities.filter((v): v is string => typeof v === "string") : (embedding ? ["embedding"] : ["generate"])),
      createdAt: candidate.createdAt || new Date().toISOString(),
      updatedAt: candidate.updatedAt || new Date().toISOString(),
    };
  });
}

export class UnifiedModelRegistryService {
  private cache: UnifiedModelRecord[] | null = null;
  private cacheAt = 0;
  private readonly cacheTtlMs = 3000;

  private enforce(models: UnifiedModelRecord[]): UnifiedModelRecord[] {
    const deduped = new Map<string, UnifiedModelRecord>();
    for (const model of normalize(models)) deduped.set(`${model.provider}:${model.modelId}`, model);
    return [...deduped.values()].sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider) || a.modelId.localeCompare(b.modelId));
  }

  public getDefaultModels(): UnifiedModelRecord[] {
    const now = new Date().toISOString();
    return [
      { id: "gemini:gemini-3.8-flash", provider: "gemini", modelId: "gemini-3.8-flash", name: "Gemini 3.8 Flash", roles: ["primary", "primary_chat", "fast"], enabled: true, priority: 0, capabilities: ["generate", "chat", "streaming", "fast", "vision", "tool_calling", "web_search"], createdAt: now, updatedAt: now },
      { id: "gemini:gemini-3.5-flash", provider: "gemini", modelId: "gemini-3.5-flash", name: "Gemini 3.5 Flash", roles: ["fast"], enabled: true, priority: 1, capabilities: ["generate", "chat", "streaming", "fast"], createdAt: now, updatedAt: now },
      { id: "gemini:gemini-3.7-flash", provider: "gemini", modelId: "gemini-3.7-flash", name: "Gemini 3.7 Flash", roles: ["reasoning"], enabled: true, priority: 1, capabilities: ["generate", "chat", "streaming", "reasoning", "vision"], createdAt: now, updatedAt: now },
      { id: "gemini:text-embedding-004", provider: "gemini", modelId: "text-embedding-004", name: "Gemini Text Embedding 004", roles: ["embedding", "primary_embedding"], enabled: true, priority: 2, capabilities: ["embedding"], createdAt: now, updatedAt: now },
      { id: "groq:llama-3.3-70b-versatile", provider: "groq", modelId: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", roles: ["fast", "reasoning"], enabled: true, priority: 1, capabilities: ["generate", "chat", "streaming", "fast", "reasoning", "tool_calling"], createdAt: now, updatedAt: now },
      { id: "groq:llama-3.1-8b-instant", provider: "groq", modelId: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", roles: ["fast"], enabled: true, priority: 2, capabilities: ["generate", "chat", "streaming", "fast"], createdAt: now, updatedAt: now },
      { id: "mistral:mistral-large-latest", provider: "mistral", modelId: "mistral-large-latest", name: "Mistral Large", roles: ["reasoning"], enabled: true, priority: 1, capabilities: ["generate", "chat", "streaming", "reasoning", "tool_calling"], createdAt: now, updatedAt: now },
      { id: "mistral:mistral-small-latest", provider: "mistral", modelId: "mistral-small-latest", name: "Mistral Small", roles: ["fast"], enabled: true, priority: 2, capabilities: ["generate", "chat", "streaming", "fast"], createdAt: now, updatedAt: now },
      { id: "huggingface:meta-llama/Llama-3.2-3B-Instruct", provider: "huggingface", modelId: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B Instruct", roles: ["fast"], enabled: true, priority: 3, capabilities: ["generate", "chat", "streaming", "fast"], createdAt: now, updatedAt: now },
    ];
  }

  private envBootstrap(): UnifiedModelRecord[] {
    const now = new Date().toISOString();
    const sources: Array<{ provider: AIProviderId; role?: UnifiedModelRole; value?: string }> = [
      { provider: "gemini", value: process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_DEFAULT_MODEL?.trim() },
      ...parseList(process.env.GEMINI_MODEL_POOL).map((value) => ({ provider: "gemini" as const, value })),
      ...parseList(process.env.GEMINI_MODEL_FALLBACKS).map((value) => ({ provider: "gemini" as const, value })),
      ...(process.env.GEMINI_MODEL_FAST?.trim() ? [{ provider: "gemini" as const, role: "fast" as const, value: process.env.GEMINI_MODEL_FAST.trim() }] : []),
      ...(process.env.GEMINI_MODEL_REASONING?.trim() ? [{ provider: "gemini" as const, role: "reasoning" as const, value: process.env.GEMINI_MODEL_REASONING.trim() }] : []),
      ...(process.env.GEMINI_MODEL_EXTRACTION?.trim() ? [{ provider: "gemini" as const, role: "extraction" as const, value: process.env.GEMINI_MODEL_EXTRACTION.trim() }] : []),
      ...(process.env.GEMINI_EMBEDDING_MODEL?.trim() ? [{ provider: "gemini" as const, role: "embedding" as const, value: process.env.GEMINI_EMBEDDING_MODEL.trim() }] : []),
      ...parseList(process.env.GROQ_MODEL_POOL).map((value) => ({ provider: "groq" as const, value })),
      ...parseList(process.env.MISTRAL_MODEL_POOL).map((value) => ({ provider: "mistral" as const, value })),
      ...(process.env.HF_TEXT_MODEL?.trim() ? [{ provider: "huggingface" as const, value: process.env.HF_TEXT_MODEL.trim() }] : []),
      ...parseList(process.env.HF_TEXT_MODEL_POOL).map((value) => ({ provider: "huggingface" as const, value })),
    ];
    const models = new Map<string, UnifiedModelRecord>();
    for (const def of this.getDefaultModels()) {
      models.set(`${def.provider}:${def.modelId}`, def);
    }
    for (const source of sources) {
      if (!source.value) continue;
      const key = `${source.provider}:${source.value}`;
      const existing = models.get(key);
      models.set(key, {
        id: existing?.id || makeId(source.provider, source.value),
        provider: source.provider,
        modelId: source.value,
        name: existing?.name || source.value,
        roles: unique([...(existing?.roles || []), ...(source.role ? [source.role] : [])]).filter((role) => !(source.provider !== "gemini" && role === "embedding")),
        enabled: existing?.enabled ?? true,
        priority: existing?.priority ?? models.size,
        capabilities: existing?.capabilities || ["generate"],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
    }
    return this.enforce([...models.values()]);
  }

  private async load(): Promise<UnifiedModelRecord[]> {
    if (this.cache && Date.now() - this.cacheAt < this.cacheTtlMs) return this.cache;
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, REGISTRY_KEY)).limit(1);
      if (rows[0]?.value) {
        const stored = normalize(JSON.parse(rows[0].value));
        this.cache = this.enforce(stored);
        this.cacheAt = Date.now();
        return this.cache;
      }
      const legacy = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, LEGACY_GEMINI_KEY)).limit(1);
      if (legacy[0]?.value) {
        const migrated = normalize(JSON.parse(legacy[0].value)).map((model) => ({ ...model, provider: "gemini" as const, id: makeId("gemini", model.modelId) }));
        const defaults = this.getDefaultModels();
        const existingIds = new Set(migrated.map((m) => `${m.provider}:${m.modelId}`));
        const merged = [...migrated];
        for (const def of defaults) {
          if (!existingIds.has(`${def.provider}:${def.modelId}`)) {
            merged.push(def);
          }
        }
        this.cache = this.enforce(merged);
        this.cacheAt = Date.now();
        await this.persist(this.cache);
        return this.cache;
      }
    } catch (error) { logger.warn({ error: String(error) }, "Failed to read unified AI model registry from PostgreSQL"); }
    this.cache = this.envBootstrap(); this.cacheAt = Date.now(); return this.cache;
  }

  private async syncLegacyGemini(models: UnifiedModelRecord[]): Promise<void> {
    const gemini = models.filter((model) => model.provider === "gemini");
    await db.insert(systemSettingsTable).values({ key: LEGACY_GEMINI_KEY, value: JSON.stringify(gemini), updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: JSON.stringify(gemini), updatedAt: new Date() } });
    const executable = gemini.filter((model) => model.enabled && !model.roles.includes("embedding"));
    const preferred = executable.find((model) => model.roles.includes("primary"));
    process.env.GEMINI_MODEL = preferred?.modelId || executable[0]?.modelId || "";
    process.env.GEMINI_MODEL_POOL = executable.map((model) => model.modelId).join(",");
    process.env.GEMINI_MODEL_FALLBACKS = preferred ? executable.filter((model) => model.id !== preferred.id).map((model) => model.modelId).join(",") : executable.slice(1).map((model) => model.modelId).join(",");
    process.env.GEMINI_MODEL_FAST = executable.find((model) => model.roles.includes("fast"))?.modelId || "";
    process.env.GEMINI_MODEL_REASONING = executable.find((model) => model.roles.includes("reasoning"))?.modelId || "";
    process.env.GEMINI_MODEL_EXTRACTION = executable.find((model) => model.roles.includes("extraction"))?.modelId || "";
    process.env.GEMINI_EMBEDDING_MODEL = gemini.find((model) => model.enabled && model.roles.includes("embedding"))?.modelId || "";
  }

  private async persist(models: UnifiedModelRecord[]): Promise<void> { const normalized = this.enforce(models); await db.insert(systemSettingsTable).values({ key: REGISTRY_KEY, value: JSON.stringify(normalized), updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: JSON.stringify(normalized), updatedAt: new Date() } }); await this.syncLegacyGemini(normalized); this.cache = normalized; this.cacheAt = Date.now(); }
  async initialize(): Promise<UnifiedModelRecord[]> { await this.load(); await aiProviderRegistryService.list(); return this.list(); }
  async list(): Promise<UnifiedModelRecord[]> { const models = await this.load(); return models.map((model) => ({ ...model, roles: [...model.roles], capabilities: [...model.capabilities] })); }

  async add(input: { provider: AIProviderId; modelId: string; name?: string; roles?: UnifiedModelRole[]; priority?: number; capabilities?: string[] }): Promise<UnifiedModelRecord> {
    const modelId = input.modelId.trim(); if (!modelId) throw new Error("modelId is required");
    const provider = await aiProviderRegistryService.get(input.provider); if (!provider.enabled) throw new Error(`Provider ${provider.id} is disabled`);
    const models = await this.list(); if (models.some((model) => model.provider === input.provider && model.modelId === modelId)) throw new Error(`Model ${input.provider}/${modelId} is already registered.`);
    const roles = unique((input.roles || []).filter((role): role is UnifiedModelRole => ROLES.includes(role))); if ((roles.includes("primary") || roles.includes("primary_chat")) && roles.includes("embedding")) throw new Error("Embedding models cannot be primary chat models.");
    const now = new Date().toISOString(); const model: UnifiedModelRecord = { id: makeId(input.provider, modelId), provider: input.provider, modelId, name: input.name?.trim() || modelId, roles, enabled: true, priority: Number.isFinite(input.priority) ? Number(input.priority) : models.length, capabilities: unique(input.capabilities?.length ? input.capabilities : (roles.includes("embedding") ? ["embedding"] : ["generate"])), createdAt: now, updatedAt: now };
    const next = roles.includes("primary") ? models.map((item) => ({ ...item, roles: item.roles.filter((role) => role !== "primary") })).concat(model) : models.concat(model); await this.persist(next); return model;
  }

  async update(id: string, patch: Partial<Pick<UnifiedModelRecord, "provider" | "modelId" | "name" | "roles" | "enabled" | "priority" | "capabilities">>): Promise<UnifiedModelRecord> {
    const models = await this.list(); const index = models.findIndex((model) => model.id === id); if (index < 0) throw new Error("Model not found"); const current = models[index]; const provider = patch.provider || current.provider; const modelId = patch.modelId?.trim() || current.modelId; const providerRecord = await aiProviderRegistryService.get(provider); if (!providerRecord.enabled && provider !== current.provider) throw new Error(`Provider ${provider} is disabled`); if (models.some((model, i) => i !== index && model.provider === provider && model.modelId === modelId)) throw new Error(`Model ${provider}/${modelId} is already registered.`); const roles = patch.roles ? unique(patch.roles.filter((role): role is UnifiedModelRole => ROLES.includes(role))) : current.roles; if ((roles.includes("primary") || roles.includes("primary_chat")) && roles.includes("embedding")) throw new Error("Embedding models cannot be primary chat models."); if (roles.includes("primary") && patch.enabled === false) throw new Error("A preferred model must remain enabled."); const updated: UnifiedModelRecord = { ...current, ...patch, provider, modelId, id: makeId(provider, modelId), name: patch.name?.trim() || current.name, roles, enabled: patch.enabled ?? current.enabled, priority: patch.priority ?? current.priority, capabilities: patch.capabilities ? unique(patch.capabilities) : current.capabilities, updatedAt: new Date().toISOString() }; const base = models.map((model, i) => i === index ? updated : model); const normalized = roles.includes("primary") ? base.map((model, i) => i === index ? model : ({ ...model, roles: model.roles.filter((role) => role !== "primary") })) : base; await this.persist(normalized); return updated;
  }

  async setPrimary(id: string): Promise<UnifiedModelRecord> {
    const models = await this.list();
    const target = models.find((model) => model.id === id);
    if (!target) throw new Error("Model not found");
    const provider = await aiProviderRegistryService.get(target.provider);
    if (!provider.enabled) throw new Error(`Provider ${provider.id} is disabled`);
    if (!target.enabled) throw new Error("Enable the model before making it preferred.");

    let primaryRole: UnifiedModelRole = "primary";
    const lowerId = target.modelId.toLowerCase();
    if (target.capabilities.includes("image_generation") || lowerId.includes("flux") || lowerId.includes("image") || lowerId.includes("stable-diffusion") || lowerId.includes("sdxl")) primaryRole = "primary_image";
    else if (target.capabilities.includes("video_generation") || lowerId.includes("wan") || lowerId.includes("video") || lowerId.includes("sora") || lowerId.includes("kling")) primaryRole = "primary_video";
    else if (target.capabilities.includes("embedding") || target.roles.includes("embedding") || lowerId.includes("embed")) primaryRole = "primary_embedding";
    else primaryRole = "primary_chat";

    const next = models.map((model) => {
      if (model.id === id) {
        // Remove old primary variants and add the new one
        return { ...model, roles: unique([...model.roles.filter((role) => !role.startsWith("primary")), primaryRole, ...(primaryRole === "primary_chat" ? ["primary" as UnifiedModelRole] : [])]) };
      }
      // Remove this specific primary role from other models
      return { ...model, roles: model.roles.filter((role) => role !== primaryRole && (primaryRole !== "primary_chat" || role !== "primary")) };
    });
    
    await this.persist(next);
    return next.find((model) => model.id === id)!;
  }
  async remove(id: string): Promise<void> { const models = await this.list(); const target = models.find((model) => model.id === id); if (!target) throw new Error("Model not found"); await this.persist(models.filter((model) => model.id !== id)); }
  async test(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> { const model = (await this.list()).find((item) => item.id === id); if (!model) throw new Error("Model not found"); return aiProviderRegistryService.test(model.provider, model.modelId); }

  getModelForRole(role?: UnifiedModelRole): UnifiedModelRecord | undefined {
    const list = this.cache || this.getDefaultModels();
    const enabled = list.filter((m) => m.enabled);
    if (!role || role === "primary" || role === "primary_chat") {
      return enabled.find((m) => m.roles.includes("primary") || m.roles.includes("primary_chat")) || enabled[0];
    }
    return enabled.find((m) => m.roles.includes(role)) || enabled.find((m) => m.roles.includes("primary")) || enabled[0];
  }

  async resolveModelForRole(role?: UnifiedModelRole): Promise<UnifiedModelRecord> {
    const models = await this.list();
    const enabled = models.filter((m) => m.enabled);
    if (!role || role === "primary" || role === "primary_chat") {
      return enabled.find((m) => m.roles.includes("primary") || m.roles.includes("primary_chat")) || enabled[0] || this.getDefaultModels()[0];
    }
    return enabled.find((m) => m.roles.includes(role)) || enabled.find((m) => m.roles.includes("primary")) || enabled[0] || this.getDefaultModels()[0];
  }
}

export const unifiedModelRegistryService = new UnifiedModelRegistryService();