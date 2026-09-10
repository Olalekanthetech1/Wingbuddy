import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { aiProviderKeyPoolService, type ProviderManagedKey } from "./ai-provider-key-pool.service";
import { apiKeyPoolService, type ManagedKey } from "./api-key-pool.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIProviderRecord, AIStreamChunk, AIImageGenerationRequest, AIImageGenerationResponse, AIVideoGenerationRequest, AIVideoGenerationResponse } from "./ai-provider.types";

export interface AIProviderExecutionResult<T> { provider: AIProviderId; model: string; result: T; }

async function orderedKeys(provider: AIProviderRecord): Promise<Array<ProviderManagedKey | ManagedKey>> {
  if (provider.id === "gemini") return apiKeyPoolService.getOrderedKeysForExecution();
  await aiProviderKeyPoolService.hydrateProvider(provider.id, provider.apiKeyEnv);
  return aiProviderKeyPoolService.getOrderedKeys(provider.id);
}

function keyValue(key: ProviderManagedKey | ManagedKey): string { return key.key; }
function keyId(key: ProviderManagedKey | ManagedKey): string { return key.id; }
function recordSuccess(provider: AIProviderRecord, id: string, latency: number): void { if (provider.id === "gemini") apiKeyPoolService.recordSuccess(id, latency); else aiProviderKeyPoolService.recordSuccess(id, latency); }
function recordFailure(provider: AIProviderRecord, id: string, error: unknown): void { if (provider.id === "gemini") apiKeyPoolService.recordError(id, error); else aiProviderKeyPoolService.recordFailure(id, error); }

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
        recordSuccess(provider, keyId(key), Date.now() - started);
        return { provider: providerId, model: request.model, result };
      } catch (error) {
        lastError = error;
        recordFailure(provider, keyId(key), error);
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
        recordSuccess(provider, keyId(key), Date.now() - started);
        return;
      } catch (error) {
        lastError = error;
        recordFailure(provider, keyId(key), error);
        if (emitted) throw error;
      }
    }
    throw new Error(`All configured ${providerId} API keys failed for streaming. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async generateImage(providerId: AIProviderId, request: AIImageGenerationRequest): Promise<AIProviderExecutionResult<AIImageGenerationResponse>> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    if (!adapter.generateImage) throw new Error(`Provider ${providerId} does not support image generation`);
    let keys: Array<ProviderManagedKey | ManagedKey> = [];
    try { keys = await orderedKeys(provider); } catch (error) { /* Media can use the adapter's keyless community fallback. */ }
    const candidates = keys.length ? keys : [undefined];
    let lastError: unknown;
    for (const key of candidates) {
      const started = Date.now();
      try {
        const result = await adapter.generateImage(request, provider, key ? keyValue(key) : undefined);
        // A community fallback succeeding does not mean the authenticated HF key succeeded.
        // Keep the key's health metrics honest so adaptive routing can learn from real HF failures.
        if (key && result.route === "inference_provider") recordSuccess(provider, keyId(key), Date.now() - started);
        return { provider: providerId, model: result.model, result };
      } catch (error) {
        lastError = error;
        if (key) recordFailure(provider, keyId(key), error);
      }
    }
    throw new Error(`Hugging Face image generation failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async generateVideo(providerId: AIProviderId, request: AIVideoGenerationRequest): Promise<AIProviderExecutionResult<AIVideoGenerationResponse>> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    if (!adapter.generateVideo) throw new Error(`Provider ${providerId} does not support video generation`);
    let keys: Array<ProviderManagedKey | ManagedKey> = [];
    try { keys = await orderedKeys(provider); } catch (error) { /* Media can use the adapter's keyless community fallback. */ }
    const candidates = keys.length ? keys : [undefined];
    let lastError: unknown;
    for (const key of candidates) {
      const started = Date.now();
      try {
        const result = await adapter.generateVideo(request, provider, key ? keyValue(key) : undefined);
        // Only count authenticated HF inference as a key success; community fallback is keyless.
        if (key && result.route === "inference_provider") recordSuccess(provider, keyId(key), Date.now() - started);
        return { provider: providerId, model: result.model, result };
      } catch (error) {
        lastError = error;
        if (key) recordFailure(provider, keyId(key), error);
      }
    }
    throw new Error(`Hugging Face video generation failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

export const aiProviderGatewayService = new AIProviderGatewayService();