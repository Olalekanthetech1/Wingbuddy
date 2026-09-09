import { describe, expect, it } from "vitest";
import { AIObservabilityService } from "../src/services/ai-observability.service";

describe("AIObservabilityService", () => {
  it("tracks request outcomes, streaming metrics, latency and success rate", () => {
    const service = new AIObservabilityService();
    service.recordStart("groq", "test-model");
    service.recordSuccess("groq", "test-model", 100);
    service.recordStart("mistral", "stream-model", true);
    service.recordFailure("mistral", "stream-model", 250, new Error("rate limited"), true);

    const snapshot = service.snapshot();
    expect(snapshot.totals.requests).toBe(2);
    expect(snapshot.totals.successes).toBe(1);
    expect(snapshot.totals.failures).toBe(1);
    expect(snapshot.totals.streamedRequests).toBe(1);
    expect(snapshot.totals.streamedFailures).toBe(1);
    expect(snapshot.totals.avgLatencyMs).toBe(175);
    expect(snapshot.totals.successRate).toBe(50);
    expect(snapshot.models.find((item) => item.provider === "groq")?.ewmaLatencyMs).toBe(100);
    expect(snapshot.models.find((item) => item.provider === "mistral")?.lastError).toBe("rate limited");
  });

  it("supports provider-only, model-only and global resets", () => {
    const service = new AIObservabilityService();
    service.recordStart("groq", "a");
    service.recordStart("groq", "b");
    service.recordStart("mistral", "b");

    service.reset(undefined, "b");
    expect(service.snapshot().models.map((item) => item.provider + "/" + item.modelId)).toEqual(["groq/a"]);

    service.recordStart("mistral", "c");
    service.reset("mistral");
    expect(service.snapshot().models.map((item) => item.provider + "/" + item.modelId)).toEqual(["groq/a"]);

    service.reset();
    expect(service.snapshot().models).toHaveLength(0);
  });
});
