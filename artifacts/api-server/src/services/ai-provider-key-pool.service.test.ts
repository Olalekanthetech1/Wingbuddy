import { describe, expect, it } from "vitest";
import type { AIProviderId } from "./ai-provider.types";
import type { ProviderManagedKey } from "./ai-provider-key-pool.service";
import { AIProviderKeyPoolService } from "./ai-provider-key-pool.service";

function seed(service: AIProviderKeyPoolService, rows: ProviderManagedKey[]): void {
  const internals = service as unknown as { keys: Map<string, ProviderManagedKey>; providerIndexes: Map<AIProviderId, number> };
  internals.keys.clear();
  internals.providerIndexes.clear();
  for (const row of rows) internals.keys.set(row.id, row);
}

const key = (id: string, provider: AIProviderId, status: ProviderManagedKey["status"] = "healthy"): ProviderManagedKey => ({
  id, provider, name: id, key: `${id}-secret-key`, status, totalSuccess: 0, totalErrors: 0, source: "dashboard", createdAt: new Date().toISOString(),
});

describe("AIProviderKeyPoolService", () => {
  it("rotates independently per provider in round-robin mode", () => {
    const service = new AIProviderKeyPoolService();
    seed(service, [key("g1", "groq"), key("g2", "groq"), key("m1", "mistral"), key("m2", "mistral")]);
    const firstGroq = service.getOrderedKeys("groq").map((item) => item.id);
    const secondGroq = service.getOrderedKeys("groq").map((item) => item.id);
    const firstMistral = service.getOrderedKeys("mistral").map((item) => item.id);
    expect(firstGroq).toEqual(["g1", "g2"]);
    expect(secondGroq).toEqual(["g2", "g1"]);
    expect(firstMistral).toEqual(["m1", "m2"]);
  });

  it("excludes disabled and invalid keys from selection", () => {
    const service = new AIProviderKeyPoolService();
    seed(service, [key("g1", "groq"), key("g2", "groq", "disabled"), key("g3", "groq", "invalid")]);
    expect(service.getOrderedKeys("groq").map((item) => item.id)).toEqual(["g1"]);
  });

  it("preserves healthy keys ahead of cooldown keys in rotation mode", () => {
    const service = new AIProviderKeyPoolService();
    seed(service, [key("g1", "groq", "cooldown"), key("g2", "groq"), key("g3", "groq")]);
    expect(service.getOrderedKeys("groq").map((item) => item.id)).toEqual(["g2", "g3"]);
  });

  it("masks credentials in public summaries", () => {
    const service = new AIProviderKeyPoolService();
    seed(service, [key("g1", "groq")]);
    const summary = service.getSummary("groq");
    expect(summary.keys[0]?.maskedKey).toContain("...");
    expect(summary.keys[0]?.maskedKey).not.toContain("g1-secret-key");
  });
});
