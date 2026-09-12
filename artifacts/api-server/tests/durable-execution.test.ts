import { describe, it, expect } from "vitest";
import { modelRouter } from "../src/services/model-router.interface";
import { sanitizeEventMetadata } from "../src/execution/persistence/durable-event-store.service";

describe("Phase 1: Durable Autonomous Execution Foundation", () => {
  it("sanitizes sensitive authorization and credential fields from event metadata", () => {
    const raw = {
      apiKey: "tvly-secret-12345",
      authorization: "Bearer my-secret-token",
      normalField: "test-query",
      nested: {
        password: "supersecretpassword",
        status: "ok",
      },
    };

    const sanitized = sanitizeEventMetadata(raw);
    expect(sanitized).toBeDefined();
    expect(sanitized?.apiKey).toBe("[REDACTED]");
    expect(sanitized?.authorization).toBe("[REDACTED]");
    expect(sanitized?.normalField).toBe("test-query");
    expect((sanitized?.nested as any)?.password).toBe("[REDACTED]");
    expect((sanitized?.nested as any)?.status).toBe("ok");
  });

  it("maintains authoritative registry-first model resolution", () => {
    expect(modelRouter.resolveModel("reasoning")).toBeDefined();
    expect(typeof modelRouter.resolveModel("reasoning")).toBe("string");
    expect(modelRouter.resolveModel("fast_tool_use")).toBeDefined();
    expect(typeof modelRouter.resolveModel("fast_tool_use")).toBe("string");
    expect(modelRouter.resolveModel("extraction")).toBeDefined();
    expect(typeof modelRouter.resolveModel("extraction")).toBe("string");
    expect(modelRouter.resolveModel("synthesis")).toBeDefined();
    expect(typeof modelRouter.resolveModel("synthesis")).toBe("string");
  });
});
