import { apiKeyPoolService } from "./api-key-pool.service";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import type { AIModelCatalogEntry, AIProviderId } from "./ai-provider.types";

export class AIModelCatalogService {
  private readonly cache = new Map<AIProviderId, { at: number; models: AIModelCatalogEntry[] }>();
  private readonly ttlMs = 60_000;

  private async resolveKey(provider: AIProviderId): Promise<string | undefined> {
    const record = await aiProviderRegistryService.get(provider);
    if (provider === "gemini") {
      try { await apiKeyPoolService.hydrateFromDatabase(); } catch {}
      return apiKeyPoolService.getOrderedKeysForExecution()[0]?.key || process.env[record.apiKeyEnv]?.trim() || undefined;
    }
    try { await aiProviderKeyPoolService.hydrateProvider(provider, record.apiKeyEnv); } catch {}
    return aiProviderKeyPoolService.getOrderedKeys(provider)[0]?.key || process.env[record.apiKeyEnv]?.trim() || undefined;
  }

  private normalize(models: AIModelCatalogEntry[]): AIModelCatalogEntry[] {
    return models.filter((model) => model.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name) || a.modelId.localeCompare(b.modelId));
  }

  async listWithKey(provider: AIProviderId, apiKey: string): Promise<AIModelCatalogEntry[]> {
    const record = await aiProviderRegistryService.get(provider);
    const adapter = aiProviderRegistryService.getAdapter(record.id);
    if (!adapter || typeof adapter.listModels !== "function") throw new Error(`Model discovery is not available for provider ${provider}`);
    const key = apiKey.trim();
    if (key.length < 10) throw new Error("A valid provider API key is required for model discovery");
    return this.normalize(await adapter.listModels(record, key));
  }

  async list(provider: AIProviderId, force = false): Promise<AIModelCatalogEntry[]> {
    const cached = this.cache.get(provider);
    if (!force && cached && Date.now() - cached.at < this.ttlMs) return cached.models.map((model) => ({ ...model, capabilities: [...model.capabilities] }));
    const record = await aiProviderRegistryService.get(provider);
    const key = await this.resolveKey(provider);
    if (!key) throw new Error(`${record.apiKeyEnv} is not configured and no Dashboard-managed key is available`);
    const models = await this.listWithKey(provider, key);
    this.cache.set(provider, { at: Date.now(), models });
    return models.map((model) => ({ ...model, capabilities: [...model.capabilities] }));
  }

  invalidate(provider?: AIProviderId): void {
    if (provider) this.cache.delete(provider);
    else this.cache.clear();
  }
}

export const aiModelCatalogService = new AIModelCatalogService();
