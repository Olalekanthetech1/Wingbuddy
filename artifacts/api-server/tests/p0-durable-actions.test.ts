import { describe, expect, it, vi } from "vitest";
import { getProductionToolRegistry } from "../src/tools/production-tools";
import { ToolRegistry } from "../src/tools/tool-registry";
import { ToolNodeExecutor } from "../src/execution/executors/tool-node-executor";

describe("P0 durable action contracts", () => {
  it("registers real durable task and reminder tools with non-idempotent side-effect policy", () => {
    const registry = getProductionToolRegistry();
    const taskPolicy = registry.getPolicy("create_task");
    const reminderPolicy = registry.getPolicy("create_reminder");

    expect(registry.get("create_task")).toBeDefined();
    expect(registry.get("create_reminder")).toBeDefined();
    expect(taskPolicy.sideEffect).toBe(true);
    expect(taskPolicy.idempotent).toBe(false);
    expect(reminderPolicy.sideEffect).toBe(true);
    expect(reminderPolicy.idempotent).toBe(false);
  });

  it("blocks replay of a non-idempotent side-effecting tool on a later attempt", async () => {
    const execute = vi.fn(async () => ({ persisted: true }));
    const registry = new ToolRegistry();
    registry.register({
      name: "durable_test_action",
      description: "test durable side effect",
      policy: {
        sideEffect: true,
        destructive: false,
        confirmationRequired: false,
        idempotent: false,
        requiredCapabilities: [],
        timeoutMs: 1000,
      },
      execute,
    });

    const executor = new ToolNodeExecutor(registry);
    const result = await executor.execute({
      node: {
        id: "n1",
        title: "Durable test action",
        type: "tool_call",
        actionSpec: { toolName: "durable_test_action", parameters: {} },
        inputBindings: {},
        status: "ready",
        approval: { status: "not_required", reason: "test" },
        verification: { required: false, strategy: "none" },
        retryPolicy: { maxAttempts: 3, backoffMs: 10 },
        timeoutMs: 1000,
      },
      graphId: "g1",
      planRevision: 1,
      attempt: 1,
      resolvedInputs: {},
      executionContext: {
        telegramUserId: 123,
        chatId: 456,
        conversationId: 789,
        availableCapabilities: [],
      },
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NON_IDEMPOTENT_RETRY_BLOCKED");
    expect(execute).not.toHaveBeenCalled();
  });
});
