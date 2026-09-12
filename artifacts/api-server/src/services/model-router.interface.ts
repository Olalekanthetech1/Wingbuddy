import { AIChatRequest, AIChatResponse } from "./ai-provider.adapters";
import { aiProviderRegistryService } from "./ai-provider-registry.service";
import { unifiedModelRegistryService, type UnifiedModelRole } from "./unified-model-registry.service";
import { adaptiveAIRouterService } from "./adaptive-ai-router.service";

export type ModelCapabilityRequirement =
  | "reasoning"
  | "fast_tool_use"
  | "synthesis"
  | "extraction";

export interface ModelRoutingRequest extends AIChatRequest {
  capability?: ModelCapabilityRequirement;
  maxCostCents?: number;
  maxLatencyMs?: number;
}

export interface IModelRouter {
  routeAndExecute(request: ModelRoutingRequest, apiKey?: string): Promise<AIChatResponse>;
  resolveModel(capability?: ModelCapabilityRequirement): string;
}

export class RegistryFirstModelRouter implements IModelRouter {
  resolveModel(capability?: ModelCapabilityRequirement): string {
    let role: UnifiedModelRole = "primary";
    if (capability === "reasoning") role = "reasoning";
    else if (capability === "fast_tool_use") role = "fast";
    else if (capability === "extraction") role = "extraction";

    const modelRecord = unifiedModelRegistryService.getModelForRole(role);
    if (modelRecord?.modelId) {
      return modelRecord.modelId;
    }
    const defaultModels = unifiedModelRegistryService.getDefaultModels();
    const fallback = defaultModels.find((m) => m.roles.includes(role)) || defaultModels[0];
    return fallback?.modelId || "gemini-3.8-flash";
  }

  async routeAndExecute(request: ModelRoutingRequest, _apiKey?: string): Promise<AIChatResponse> {
    const isDeepReasoning = request.capability === "reasoning";
    const isExtraction = request.capability === "extraction";

    const routed = await adaptiveAIRouterService.route(request, {
      isDeepReasoning,
      isExtraction,
      preferredModelId: request.model,
    });

    return routed.response;
  }
}

export const modelRouter: IModelRouter = new RegistryFirstModelRouter();
