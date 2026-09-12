import { describe, expect, it, vi } from "vitest";
import { AdaptiveAIRouterService, type AIRoutingCandidate } from "./adaptive-ai-router.service";
import type { UnifiedModelRecord } from "./unified-model-registry.service";
import type { AIProviderId } from "./ai-provider.types";

const model = (provider: AIProviderId, modelId: string, overrides: Partial<UnifiedModelRecord> = {}): UnifiedModelRecord => ({
  id: `${provider}:${modelId}`,
  provider,
  modelId,
  name: modelId,
  roles: [],
  enabled: true,
  priority: 0,
  capabilities: ["generate", "chat", "streaming"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("AdaptiveAIRouterService provider-neutral routing", () => {
  it("does not give a legacy primary role an adaptive-routing advantage", async () => {
    const service = new AdaptiveAIRouterService();
    const gemini = model("gemini", "gemini-primary", { roles: ["primary"], priority: 5 });
    const groq = model("groq", "groq-fast", { priority: 0 });

    (service as any).loadPolicy = vi.fn().mockResolvedValue({
      strategy: "adaptive",
      capabilityWeight: 50,
      healthWeight: 25,
      latencyWeight: 15,
      priorityWeight: 10,
      maxAttempts: 3,
      updatedAt: new Date().toISOString(),
    });
    const { aiProviderRegistryService } = await import("./ai-provider-registry.service");
    const { unifiedModelRegistryService } = await import("./unified-model-registry.service");
    vi.spyOn(aiProviderRegistryService, "list").mockResolvedValue([
      { id: "gemini", name: "Gemini", adapter: "gemini", enabled: true, baseUrl: "", apiKeyEnv: "GEMINI_API_KEY", capabilities: ["chat", "streaming", "reasoning", "web_search"], createdAt: "", updatedAt: "", configured: true, adapterAvailable: true, keyCount: 1 },
      { id: "groq", name: "Groq", adapter: "groq", enabled: true, baseUrl: "", apiKeyEnv: "GROQ_API_KEY", capabilities: ["chat", "streaming"], createdAt: "", updatedAt: "", configured: true, adapterAvailable: true, keyCount: 1 },
      { id: "mistral", name: "Mistral", adapter: "mistral", enabled: true, baseUrl: "", apiKeyEnv: "MISTRAL_API_KEY", capabilities: ["chat", "streaming"], createdAt: "", updatedAt: "", configured: true, adapterAvailable: true, keyCount: 1 },
    ]);
    vi.spyOn(unifiedModelRegistryService, "list").mockResolvedValue([gemini, groq]);

    const candidates = await service.candidates();
    expect(candidates.map((item) => item.model.id)).toEqual(["gemini:gemini-primary", "groq:groq-fast"]);
    expect(candidates.find((item) => item.model.id === "gemini:gemini-primary")?.reasons).toContain("primary");
  });

  it("moves from a failing Gemini candidate to another provider for streaming", async () => {
    const service = new AdaptiveAIRouterService();
    const gemini = model("gemini", "gemini-available");
    const groq = model("groq", "groq-available");
    const candidates: AIRoutingCandidate[] = [
      { model: gemini, score: 100, reasons: [], healthScore: 100, latencyMs: 100 },
      { model: groq, score: 90, reasons: [], healthScore: 100, latencyMs: 120 },
    ];
    (service as any).loadPolicy = vi.fn().mockResolvedValue({
      strategy: "adaptive",
      capabilityWeight: 50,
      healthWeight: 25,
      latencyWeight: 15,
      priorityWeight: 10,
      maxAttempts: 3,
      updatedAt: new Date().toISOString(),
    });
    (service as any).candidates = vi.fn().mockResolvedValue(candidates);

    const { aiProviderGatewayService } = await import("./ai-provider-gateway.service");
    const gateway = vi.spyOn(aiProviderGatewayService, "stream").mockImplementation(async function* (provider) {
      if (provider === "gemini") throw Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 });
      yield { provider: "groq", model: "groq-available", delta: "fallback", done: false };
      yield { provider: "groq", model: "groq-available", delta: "", done: true };
    });
    const observability = await import("./ai-observability.service");
    vi.spyOn(observability.aiObservabilityService, "recordStart").mockImplementation(() => {});
    vi.spyOn(observability.aiObservabilityService, "recordSuccess").mockImplementation(() => {});
    vi.spyOn(observability.aiObservabilityService, "recordFailure").mockImplementation(() => {});

    const output: string[] = [];
    for await (const chunk of service.routeStream({ model: "unused", messages: [{ role: "user", content: "hello" }] }, {})) output.push(chunk.delta);

    expect(output).toContain("fallback");
    expect(gateway).toHaveBeenCalledWith("gemini", expect.objectContaining({ model: "gemini-available" }));
    expect(gateway).toHaveBeenCalledWith("groq", expect.objectContaining({ model: "groq-available" }));
    gateway.mockRestore();
  });
});
