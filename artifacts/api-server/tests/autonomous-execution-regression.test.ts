import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionEngine } from "../src/execution/execution-engine";
import { executionPersistence } from "../src/execution/persistence/execution-persistence.service";
import { planPersistenceService } from "../src/planner/plan-persistence.service";
import { ToolRegistry } from "../src/tools/tool-registry";
import { concurrencyController } from "../src/execution/concurrency/concurrency-controller";
import { executionObservability } from "../src/execution/observability/execution-logger";
import { AgentPlannerService } from "../src/planner/agent-planner.service";
import { ASSISTANT_ARCHITECTURE_FACTS, AI_SYSTEM_INSTRUCTION } from "../src/config/env";
import { contextManagerService } from "../src/services/context-manager.service";

describe("Autonomous Execution Smoke-Test Regression", () => {
  let toolRegistry: ToolRegistry;
  let engine: ExecutionEngine;
  let planner: AgentPlannerService;

  beforeEach(() => {
    process.env.EXECUTION_ENGINE_ENABLED = "true";
    toolRegistry = new ToolRegistry();
    engine = new ExecutionEngine(toolRegistry);
    planner = new AgentPlannerService(planPersistenceService, toolRegistry);
    executionPersistence.clearForTesting();
    planPersistenceService.clearForTesting();
    concurrencyController.reset();
    executionObservability.resetMetrics();
  });

  it("should preserve accurate Wingbuddy / Lekzy Fx Pro architecture identity in context and reject travel-platform hallucinations", async () => {
    // 1. Verify constant definition
    expect(ASSISTANT_ARCHITECTURE_FACTS).toContain("Wingbuddy / Lekzy Fx Pro AI Assistant");
    expect(ASSISTANT_ARCHITECTURE_FACTS).toContain("NOT A Travel/Tour Platform");
    expect(ASSISTANT_ARCHITECTURE_FACTS).toContain("Autonomous DAG Planner & Compiler");
    expect(ASSISTANT_ARCHITECTURE_FACTS).toContain("PostgreSQL State Persistence");
    expect(ASSISTANT_ARCHITECTURE_FACTS).toContain("Distributed Row-Level Leases");
    expect(AI_SYSTEM_INSTRUCTION).toContain("Wingbuddy / Lekzy Fx Pro AI Assistant");
    expect(AI_SYSTEM_INSTRUCTION).toContain("NOT a travel agency or tour booking platform");

    // 2. Verify ContextManagerService assembles the architecture facts
    const context = await contextManagerService.assembleContext({
      telegramUserId: 999888,
      userMessage: "Describe the Wingbuddy architecture and execution flow",
      effectiveModeInstruction: "Mode: Assistant Default",
    });

    expect(context.effectiveSystemPrompt).toContain("Wingbuddy / Lekzy Fx Pro AI Assistant");
    expect(context.effectiveSystemPrompt).toContain("NOT A Travel/Tour Platform");
    expect(context.effectiveSystemPrompt).toContain("Distributed Row-Level Leases");
  });

  it(
    "should plan, compile, and execute a 4-step autonomous task with independent nodes, persisted attempts, and authoritative aggregation",
    async () => {
    const multiStepGoal =
      "Step 1: Inspect the Wingbuddy AI assistant system architecture. " +
      "Step 2: Compare against conventional single-turn bot platforms. " +
      "Step 3: Analyze distributed leasing and DAG compilation benefits. " +
      "Step 4: Aggregate all findings into a complete architectural assessment.";

    // 1. Generate and compile the plan
    const planResult = await planner.plan({
      goal: multiStepGoal,
      telegramUserId: 123456,
      context: {
        effectiveModeInstruction: "Mode: Technical Architecture Analysis",
      },
    });

    if (!planResult.success) {
      console.error("Plan compilation failed:", JSON.stringify(planResult, null, 2));
    }

    expect(planResult.success).toBe(true);
    expect(planResult.graph).toBeDefined();
    expect(planResult.isDirectResponse).toBe(false);

    const graph = planResult.graph!;
    const nodeKeys = Object.keys(graph.nodes);

    // Verify 4 distinct nodes were planned
    expect(nodeKeys.length).toBe(4);
    expect(graph.edges.length).toBe(3);

    // Verify graph is saved to persistence by planner
    const persistedGraph = await planPersistenceService.getGraph(graph.graphId);
    expect(persistedGraph).toBeDefined();
    expect(persistedGraph?.graphId).toBe(graph.graphId);

    // 2. Execute the graph autonomously through the engine
    const session = await engine.startExecution({
      graphId: graph.graphId,
      planRevision: 1,
      requestId: `req_smoke_test_${Date.now()}`,
      taskId: 1234567,
      executionContext: {
        telegramUserId: 123456,
        chatId: 123456,
        conversationId: "conv_smoke_test",
      },
    });

    // 3. Verify execution status is completed
    expect(session.status).toBe("completed");

    // 4. Verify that ALL 4 nodes were independently executed and recorded in persistence
    const completedExecutions = await executionPersistence.getCompletedExecutionsForGraph(
      graph.graphId,
      1,
    );

    expect(completedExecutions.length).toBe(4);
    const executedNodeIds = completedExecutions.map((e) => e.nodeId);
    expect(executedNodeIds).toContain("step_1_reasoning");
    expect(executedNodeIds).toContain("step_2_reasoning");
    expect(executedNodeIds).toContain("step_3_reasoning");
    expect(executedNodeIds).toContain("step_4_synthesize");

    // 5. Verify every node has non-empty successful output
    for (const attempt of completedExecutions) {
      expect(attempt.status).toBe("completed");
      expect(attempt.result).toBeDefined();
      expect(attempt.result?.success).toBe(true);
      expect(attempt.result?.output).toBeDefined();
    }

    // 6. Verify terminal synthesis / aggregation node output exists and aggregates
    const synthesisAttempt = completedExecutions.find((e) => e.nodeId === "step_4_synthesize");
    expect(synthesisAttempt).toBeDefined();
    const finalOutput = synthesisAttempt!.result?.output as any;
    expect(finalOutput).toBeDefined();
    const responseText = typeof finalOutput === "string" ? finalOutput : (finalOutput.response || finalOutput.summary || "");
    expect(responseText.length).toBeGreaterThan(10);

    // 7. Verify no manual question marks or requests to continue
    expect(responseText.toLowerCase()).not.toContain("would you like to proceed to step");
  }, 15000);
});
