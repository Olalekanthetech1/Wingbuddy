import { aiProviderRegistryService } from "./ai-provider-registry.service";
import type { AIChatRequest, AIChatResponse, AIProviderId, AIProviderRecord, AIStreamChunk } from "./ai-provider.types";

export interface AIProviderExecutionResult<T> {
  provider: AIProviderId;
  model: string;
  result: T;
}

/**
 * Thin provider-neutral execution boundary.
 * Routing, fallback, health scoring and model selection intentionally stay
 * outside this layer so providers remain replaceable and testable.
 */
export class AIProviderGatewayService {
  async getProvider(providerId: AIProviderId): Promise<AIProviderRecord> {
    return aiProviderRegistryService.get(providerId);
  }

  async chat(providerId: AIProviderId, request: AIChatRequest): Promise<AIProviderExecutionResult<AIChatResponse>> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const result = await adapter.chat(request, provider);
    return { provider: providerId, model: request.model, result };
  }

  async *stream(providerId: AIProviderId, request: AIChatRequest): AsyncGenerator<AIStreamChunk> {
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) throw new Error(`Provider ${providerId} is disabled`);
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    yield* adapter.stream(request, provider);
  }
}

export const aiProviderGatewayService = new AIProviderGatewayService();
