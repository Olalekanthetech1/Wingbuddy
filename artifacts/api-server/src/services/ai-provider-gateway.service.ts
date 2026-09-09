import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { aiProviderKeyPoolService, type ProviderManagedKey } from "./ai-provider-key-pool.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIProviderRecord, AIStreamChunk } from "./ai-provider.types";

export interface AIProviderExecutionResult<T> {
  provider: AIProviderId;
  model: string;
  result: T;
}

function orderedKeys(provider: AIProviderRecord): ProviderManagedKey[] {
  return aiProviderKeyPoolService.getOrderedKeys(provider.id, provider.apiKeyEnv);
}

export class AIProviderGatewayService {
  async getProvider(providerId: AIProviderId): Promise<AIProviderRecord> {
    return aiProviderRegistryService.get(providerId);
  }

  async chat(providerId: AIProviderId, request: AIChatRequest): Promise<AIProviderExecutionResult<AIChatResponse>> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const keys = orderedKeys(provider);
    if (!keys.length) throw new Error(`No API key is configured for provider ${providerId}`);
    let lastError: unknown;
    for (const key of keys) {
      const started = Date.now();
      try {
        const result = await adapter.chat(request, provider, key.key);
        aiProviderKeyPoolService.recordSuccess(key.id, Date.now() - started);
        return { provider: providerId, model: request.model, result };
      } catch (error) {
        lastError = error;
        aiProviderKeyPoolService.recordFailure(key.id, error);
      }
    }
    throw new Error(`All configured ${providerId} API keys failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async *stream(providerId: AIProviderId, request: AIChatRequest): AsyncGenerator<AIStreamChunk> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const keys = orderedKeys(provider);
    if (!keys.length) throw new Error(`No API key is configured for provider ${providerId}`);
    let lastError: unknown;
    for (const key of keys) {
      const started = Date.now();
      let emitted = false;
      try {
        for await (const chunk of adapter.stream(request, provider, key.key)) {
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        aiProviderKeyPoolService.recordSuccess(key.id, Date.now() - started);
        return;
      } catch (error) {
        lastError = error;
        aiProviderKeyPoolService.recordFailure(key.id, error);
        if (emitted) throw error;
      }
    }
    throw new Error(`All configured ${providerId} API keys failed for streaming. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

export const aiProviderGatewayService = new AIProviderGatewayService();