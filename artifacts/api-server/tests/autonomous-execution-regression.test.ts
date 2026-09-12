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
        mode: "autonomous",
        effectiveModeInstruction: "Mode: Technical Architecture Analysis",
        activeTask: { id: 1234567, goal: multiStepGoal },
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

    // Verify multi-step distinct nodes were planned
    expect(nodeKeys.length).toBeGreaterThanOrEqual(3);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);

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

    if (session.status !== "completed") {
      console.error("SESSION_FAILED_DETAILS:", {
        status: session.status,
        error: session.error,
        completedNodes: session.completedNodes,
        failedNodes: session.failedNodes,
      });
    }

    // 3. Verify execution status is completed
    expect(session.status).toBe("completed");

    // 4. Verify that ALL 4 nodes were independently executed and recorded in persistence
    const completedExecutions = await executionPersistence.getCompletedExecutionsForGraph(
      graph.graphId,
      1,
    );

    expect(completedExecutions.length).toBe(nodeKeys.length);
    const executedNodeIds = completedExecutions.map((e) => e.nodeId);
    for (const key of nodeKeys) {
      expect(executedNodeIds).toContain(key);
    }

    // 5. Verify every node has non-empty successful output
    for (const attempt of completedExecutions) {
      expect(attempt.status).toBe("completed");
      expect(attempt.result).toBeDefined();
      expect(attempt.result?.success).toBe(true);
      expect(attempt.result?.output).toBeDefined();
    }

    // 6. Verify terminal synthesis / aggregation node output exists and aggregates
    const synthesisAttempt = completedExecutions.find((e) => e.nodeId === nodeKeys[nodeKeys.length - 1]) || completedExecutions[completedExecutions.length - 1];
    expect(synthesisAttempt).toBeDefined();
    const finalOutput = synthesisAttempt!.result?.output as any;
    expect(finalOutput).toBeDefined();
    const responseText = typeof finalOutput === "string" ? finalOutput : (finalOutput.response || finalOutput.summary || "");
    expect(responseText.length).toBeGreaterThan(10);

    // 7. Verify no manual question marks or requests to continue
    expect(responseText.toLowerCase()).not.toContain("would you like to proceed to step");
  }, 180000);

  describe("Phase 5: Evaluation & Regression Testing Suite", () => {
    it("should provide configurable test fixtures for tool accuracy, budget compliance, and verification rules", async () => {
      const { regressionSuiteService } = await import("../src/execution/evaluation/regression-suite.service");
      const fixtures = regressionSuiteService.listFixtures();

      expect(fixtures.length).toBeGreaterThanOrEqual(4);
      const categories = fixtures.map((f) => f.category);
      expect(categories).toContain("tool_accuracy");
      expect(categories).toContain("budget_compliance");
      expect(categories).toContain("verification_rules");
      expect(categories).toContain("resilience_recovery");

      for (const f of fixtures) {
        expect(f.assertionCount).toBeGreaterThan(0);
      }
    }, 15000);

    it("should evaluate tool invocation accuracy assertions with capability and schema enforcement", async () => {
      const { regressionSuiteService } = await import("../src/execution/evaluation/regression-suite.service");
      const report = await regressionSuiteService.runFixture("fixture_tool_accuracy_search_calc");

      expect(report.status).toBe("passed");
      expect(report.totalAssertions).toBeGreaterThanOrEqual(2);
      expect(report.failedAssertions).toBe(0);

      const assertionIds = report.assertions.map((a) => a.id);
      expect(assertionIds).toContain("assert_tool_registered");
      expect(assertionIds).toContain("assert_tool_capabilities_guarded");
      expect(assertionIds).toContain("assert_tool_input_schema_validation");

      for (const a of report.assertions) {
        expect(a.passed).toBe(true);
      }
    }, 20000);

    it("should enforce autonomous budget compliance: step count ceiling, latency bounds, and retry limit", async () => {
      const { regressionSuiteService } = await import("../src/execution/evaluation/regression-suite.service");
      const report = await regressionSuiteService.runFixture("fixture_budget_compliance_dag", {
        maxBudgetMs: 25000,
        maxSteps: 8,
      });

      expect(report.status).toBe("passed");
      expect(report.failedAssertions).toBe(0);

      const stepAssert = report.assertions.find((a) => a.id === "assert_step_limit_compliance");
      expect(stepAssert?.passed).toBe(true);

      const latencyAssert = report.assertions.find((a) => a.id === "assert_latency_budget_compliance");
      expect(latencyAssert?.passed).toBe(true);

      const retryAssert = report.assertions.find((a) => a.id === "assert_retry_budget_compliance");
      expect(retryAssert?.passed).toBe(true);
    }, 20000);

    it("should execute verification rules: output schema validation, deterministic rejection, and checkpoint invariant", async () => {
      const { regressionSuiteService } = await import("../src/execution/evaluation/regression-suite.service");
      const report = await regressionSuiteService.runFixture("fixture_verification_rules_invariants");

      expect(report.status).toBe("passed");
      expect(report.failedAssertions).toBe(0);

      const schemaAssert = report.assertions.find((a) => a.id === "assert_schema_verification_rule");
      expect(schemaAssert?.passed).toBe(true);

      const rejectionAssert = report.assertions.find((a) => a.id === "assert_semantic_invariant_rejection");
      expect(rejectionAssert?.passed).toBe(true);

      const checkpointAssert = report.assertions.find((a) => a.id === "assert_human_checkpoint_invariant");
      expect(checkpointAssert?.passed).toBe(true);
    }, 20000);

    it("should run full regression test suite and compute accuracy, budget compliance, and verification scores", async () => {
      const { regressionSuiteService } = await import("../src/execution/evaluation/regression-suite.service");
      const summary = await regressionSuiteService.runAll({ maxBudgetMs: 20000 });

      expect(summary.totalFixtures).toBeGreaterThanOrEqual(4);
      expect(summary.passedFixtures).toBe(summary.totalFixtures);
      expect(summary.failedFixtures).toBe(0);
      expect(summary.passRatePercent).toBe(100);
      expect(summary.toolInvocationAccuracyPercent).toBe(100);
      expect(summary.budgetCompliancePercent).toBe(100);
      expect(summary.verificationRulesPercent).toBe(100);
      expect(summary.fixtureReports.length).toBe(summary.totalFixtures);

      // Verify persisted in service
      const latest = regressionSuiteService.getLatestSummary();
      expect(latest?.suiteId).toBe(summary.suiteId);
    }, 30000);
  });
});
