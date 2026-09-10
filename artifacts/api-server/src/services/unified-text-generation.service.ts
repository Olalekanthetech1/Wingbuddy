import { adaptiveAIRouterService } from "./adaptive-ai-router.service";
import type { AIChatRequest, AIProviderId } from "./ai-provider.types";

export interface UnifiedTextGenerationContext {
  mode?: string;
  isDeepReasoning?: boolean;
  isExtraction?: boolean;
  enableSearch?: boolean;
  requiresVision?: boolean;
  requiresTools?: boolean;
  preferredProvider?: AIProviderId;
  preferredModelId?: string;
}

export interface UnifiedTextGenerationResult {
  text: string;
  provider: AIProviderId;
  model: string;
  attempts: string[];
}

export class UnifiedTextGenerationService {
  async generate(
    request: AIChatRequest,
    context: UnifiedTextGenerationContext = {},
  ): Promise<UnifiedTextGenerationResult> {
    const routed = await adaptiveAIRouterService.route(request, context);
    return {
      text: routed.response.text.trim(),
      provider: routed.response.provider,
      model: routed.response.model,
      attempts: routed.attempts,
    };
  }
}

export const unifiedTextGenerationService = new UnifiedTextGenerationService();
