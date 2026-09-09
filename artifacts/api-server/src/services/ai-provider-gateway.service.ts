import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { aiProviderKeyPoolService, type ProviderManagedKey } from "./ai-provider-key-pool.service";
import { apiKeyPoolService, type ManagedKey } from "./api-key-pool.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIProviderRecord, AIStreamChunk } from "./ai-provider.types";

export interface AIProviderExecutionResult<T> { provider: AIProviderId; model: string; result: T; }

async function orderedKeys(provider: AIProviderRecord): Promise<Array<ProviderManagedKey | ManagedKey>> {
  if (provider.id === "gemini") return apiKeyPoolService.getOrderedKeysForExecution();
  await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
  return aiProviderKeyPoolService.getOrderedKeys(provider.id);
}

function keyValue(key: ProviderManagedKey | ManagedKey): string { return key.key; }
function keyId(key: ProviderManagedKey | ManagedKey): string { return key.id; }

export class AIProviderGatewayService {
  async getProvider(providerId: AIProviderId): Promise<AIProviderRecord> { return aiProviderRegistryService.get(providerId); }

  async chat(providerId: AIProviderId, request: AIChatRequest): Promise<AIProviderExecutionResult<AIChatResponse>> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const keys = await orderedKeys(provider);
    if (!keys.length) throw new Error(`No API key is configured for provider ${providerId}`);
    let lastError: unknown;
    for (const key of keys) {
      const started = Date.now();
      try {
        const result = await adapter.chat(request, provider, keyValue(key));
        const latency = Date.now() - started;
        if (provider.id === "gemini") apiKeyPoolService.recordSuccess(keyId(key), latency);
        else aiProviderKeyPoolService.recordSuccess(keyId(key), latency);
        return { provider: providerId, model: request.model, result };
      } catch (error) {
        lastError = error;
        if (provider.id === "gemini") apiKeyPoolService.recordError(keyId(key), error);
        else aiProviderKeyPoolService.recordFailure(keyId(key), error);
      }
    }
    throw new Error(`All configured ${providerId} API keys failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async *stream(providerId: AIProviderId, request: AIChatRequest): AsyncGenerator<AIStreamChunk> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const keys = await orderedKeys(provider);
    if (!keys.length) throw new Error(`No API key is configured for provider ${providerId}`);
    let lastError: unknown;
    for (const key of keys) {
      const started = Date.now();
      let emitted = false;
      try {
        for await (const chunk of adapter.stream(request, provider, keyValue(key))) {
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        const latency = Date.now() - started;
        if (provider.id === "gemini") apiKeyPoolService.recordSuccess(keyId(key), latency);
        else aiProviderKeyPoolService.recordSuccess(keyId(key), latency);
        return;
      } catch (error) {
        lastError = error;
        if (provider.id === "gemini") apiKeyPoolService.recordError(keyId(key), error);
        else aiProviderKeyPoolService.recordFailure(keyId(key), error);
        if (emitted) throw error;
      }
    }
    throw new Error(`All configured ${providerId} API keys failed for streaming. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

export const aiProviderGatewayService = new AIProviderGatewayService();