import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { aiProviderAdapters } from "./ai-provider.adapters";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import { apiKeyPoolService } from "./api-key-pool.service";
import type { AIProviderCapability, AIProviderId, AIProviderRecord } from "./ai-provider.types";

const REGISTRY_KEY = "AI_PROVIDER_REGISTRY";
const BUILT_IN_PROVIDERS: Record<AIProviderId, Omit<AIProviderRecord, "createdAt" | "updatedAt" | "enabled">> = {
  gemini: { id: "gemini", name: "Google Gemini", adapter: "gemini", baseUrl: "https://generativelanguage.googleapis.com", apiKeyEnv: "GEMINI_API_KEY", capabilities: ["chat", "streaming", "vision", "reasoning", "long_context", "web_search"] },
  groq: { id: "groq", name: "Groq", adapter: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", capabilities: ["chat", "streaming"] },
  mistral: { id: "mistral", name: "Mistral AI", adapter: "mistral", baseUrl: "https://api.mistral.ai", apiKeyEnv: "MISTRAL_API_KEY", capabilities: ["chat", "streaming"] },
  huggingface: { id: "huggingface", name: "Hugging Face", adapter: "huggingface", baseUrl: "https://huggingface.co", apiKeyEnv: "HF_TOKEN", capabilities: ["chat", "streaming", "image_generation", "video_generation"] },
  elevenlabs: { id: "elevenlabs", name: "ElevenLabs", adapter: "elevenlabs", baseUrl: "https://api.elevenlabs.io", apiKeyEnv: "ELEVENLABS_API_KEY", capabilities: ["audio_generation"] },
  tavily: { id: "tavily", name: "Tavily Web Research", adapter: "tavily", baseUrl: "https://api.tavily.com", apiKeyEnv: "TAVILY_API_KEY", capabilities: ["web_search", "web_extract"] },
};

function normalize(value: unknown): AIProviderRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AIProviderRecord => {
    if (!item || typeof item !== "object") return false;
    const id = (item as Partial<AIProviderRecord>).id;
    return typeof id === "string" && id in BUILT_IN_PROVIDERS;
  }).map((item) => {
    const defaults = BUILT_IN_PROVIDERS[item.id];
    const storedCapabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
    const capabilities = [...new Set([
      ...defaults.capabilities,
      ...storedCapabilities.filter((value): value is AIProviderCapability => defaults.capabilities.includes(value)),
    ])];
    return {
      ...defaults,
      ...item,
      adapter: defaults.adapter,
      apiKeyEnv: defaults.apiKeyEnv,
      capabilities,
      baseUrl: typeof item.baseUrl === "string" && item.baseUrl.trim() ? item.baseUrl.trim().replace(/\/+$/, "") : defaults.baseUrl,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : defaults.name,
      enabled: item.id === "huggingface" ? item.enabled !== false : item.enabled === true,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    };
  });
}

function bootstrapProviders(): AIProviderRecord[] {
  const now = new Date().toISOString();
  return Object.values(BUILT_IN_PROVIDERS).map((provider) => ({
    ...provider,
    enabled: provider.id === "huggingface" ? true : Boolean(process.env[provider.apiKeyEnv]?.trim()),
    createdAt: now,
    updatedAt: now,
  }));
}

export class AIProviderRegistryService {
  private cache: AIProviderRecord[] | null = null;
  private cacheAt = 0;
  private readonly cacheTtlMs = 5000;

  private async read(): Promise<AIProviderRecord[]> {
    if (this.cache && Date.now() - this.cacheAt < this.cacheTtlMs) return this.cache;
    try {
      const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, REGISTRY_KEY)).limit(1);
      if (rows[0]?.value) {
        const stored = normalize(JSON.parse(rows[0].value));
        const byId = new Map(stored.map((provider) => [provider.id, provider]));
        const merged = Object.values(BUILT_IN_PROVIDERS).map((defaults) => byId.get(defaults.id) || {
          ...defaults,
          enabled: defaults.id === "huggingface" ? true : false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.cache = merged;
        this.cacheAt = Date.now();
        return merged;
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to read AI provider registry from PostgreSQL");
    }
    this.cache = bootstrapProviders();
    this.cacheAt = Date.now();
    return this.cache;
  }

  private async persist(providers: AIProviderRecord[]): Promise<void> {
    const normalized = normalize(providers);
    await db.insert(systemSettingsTable).values({ key: REGISTRY_KEY, value: JSON.stringify(normalized), updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: JSON.stringify(normalized), updatedAt: new Date() } });
    this.cache = normalized;
    this.cacheAt = Date.now();
  }

  async list(): Promise<Array<AIProviderRecord & { configured: boolean; adapterAvailable: boolean; keyCount: number }>> {
    const providers = await this.read();
    return Promise.all(providers.map(async (provider) => {
      let keyCount = 0;
      try {
        if (provider.id === "gemini") {
          await apiKeyPoolService.hydrateFromDatabase();
          keyCount = apiKeyPoolService.getSummary().totalKeys;
        } else {
          await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
          keyCount = aiProviderKeyPoolService.getSummary(provider.id).totalKeys;
        }
      } catch (error) {
        logger.warn({ provider: provider.id, error: String(error) }, "AI provider key hydration failed; provider remains isolated from routing");
      }
      return {
        ...provider,
        capabilities: [...provider.capabilities],
        configured: provider.id === "huggingface" ? keyCount > 0 || Boolean(process.env.HF_TOKEN?.trim()) : keyCount > 0 || Boolean(process.env[provider.apiKeyEnv]?.trim()),
        adapterAvailable: Boolean(aiProviderAdapters[provider.adapter]),
        keyCount,
      };
    }));
  }

  getKnownProviderIds(): AIProviderId[] {
    return Object.keys(BUILT_IN_PROVIDERS) as AIProviderId[];
  }

  isKnownProvider(id: string): id is AIProviderId {
    return id in BUILT_IN_PROVIDERS;
  }

  async get(id: string): Promise<AIProviderRecord> {
    const provider = (await this.read()).find((item) => item.id === id);
    if (!provider) throw new Error(`Unknown AI provider: ${id}`);
    return provider;
  }

  async update(id: string, patch: Partial<Pick<AIProviderRecord, "name" | "enabled" | "baseUrl" | "capabilities">>): Promise<AIProviderRecord> {
    const providers = await this.read();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error(`Unknown AI provider: ${id}`);
    const current = providers[index];
    const next = {
      ...current,
      ...(typeof patch.name === "string" && patch.name.trim() ? { name: patch.name.trim() } : {}),
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(typeof patch.baseUrl === "string" && patch.baseUrl.trim() ? { baseUrl: patch.baseUrl.trim().replace(/\/+$/, "") } : {}),
      ...(Array.isArray(patch.capabilities) ? { capabilities: patch.capabilities.filter((value): value is AIProviderCapability => BUILT_IN_PROVIDERS[id as AIProviderId]?.capabilities.includes(value)) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.persist(providers.map((provider, i) => i === index ? next : provider));
    return next;
  }

  async test(id: AIProviderId, model: string) {
    const provider = await this.get(id);
    if (!provider.enabled) throw new Error(`Provider ${id} is disabled`);
    const adapter = aiProviderAdapters[provider.adapter];
    if (!adapter) throw new Error(`No adapter is registered for provider ${id}`);
    try {
      if (provider.id === "gemini") {
        await apiKeyPoolService.hydrateFromDatabase();
        const keys = apiKeyPoolService.getOrderedKeysForExecution();
        if (!keys.length) return adapter.test(model.trim(), provider);
        const key = keys[0];
        const result = await adapter.test(model.trim(), provider, key.key);
        if (result.ok) apiKeyPoolService.recordSuccess(key.id, result.latencyMs); else apiKeyPoolService.recordError(key.id, result.error || "Provider test failed");
        return result;
      }
      await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
      const keys = aiProviderKeyPoolService.getOrderedKeys(provider.id);
      if (!keys.length) return adapter.test(model.trim(), provider);
      const key = keys[0];
      const result = await adapter.test(model.trim(), provider, key.key);
      if (result.ok) aiProviderKeyPoolService.recordSuccess(key.id, result.latencyMs); else aiProviderKeyPoolService.recordFailure(key.id, result.error || "Provider test failed");
      return result;
    } catch (error) {
      logger.warn({ provider: id, error: String(error) }, "AI provider test could not hydrate managed credentials; falling back to provider adapter result");
      return adapter.test(model.trim(), provider, process.env[provider.apiKeyEnv]?.trim() || undefined);
    }
  }

  getAdapter(id: AIProviderId) {
    const adapter = aiProviderAdapters[id];
    if (!adapter) throw new Error(`No adapter is registered for provider ${id}`);
    return adapter;
  }
}

export const aiProviderRegistryService = new AIProviderRegistryService();