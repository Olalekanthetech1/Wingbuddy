import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExecutionEngine } from "../src/execution/execution-engine";
import { executionPersistence } from "../src/execution/persistence/execution-persistence.service";
import { planPersistenceService } from "../src/planner/plan-persistence.service";
import { ToolRegistry, type AssistantTool } from "../src/tools/tool-registry";
import { retryEngine } from "../src/execution/resilience/retry-engine";
import { bindingResolver } from "../src/execution/bindings/binding-resolver";
import { concurrencyController } from "../src/execution/concurrency/concurrency-controller";
import { executionObservability } from "../src/execution/observability/execution-logger";
import { CURRENT_GRAPH_SCHEMA_VERSION, type ExecutionGraph } from "../src/planner/types";

describe("Autonomous Execution Engine", () => {
  let toolRegistry: ToolRegistry;
  let engine: ExecutionEngine;

  beforeEach(() => {
    process.env.EXECUTION_ENGINE_ENABLED = "true";
    toolRegistry = new ToolRegistry();
    engine = new ExecutionEngine(toolRegistry);
    executionPersistence.clearForTesting();
    planPersistenceService.clearForTesting();
    concurrencyController.reset();
    executionObservability.resetMetrics();
  });

  // Helper: constructs a valid ExecutionGraph for testing
  function createTestGraph(overrides: Partial<ExecutionGraph> = {}): ExecutionGraph {
    const graphId = overrides.graphId || `test_graph_${Date.now()}`;
    const planRevision = overrides.planRevision || 1;
    const revisionId = `${graphId}:r${planRevision}`;

    const defaultNodes: Record<string, any> = {
      step_1: {
        id: "step_1",
        title: "First Step Reasoning",
        type: "llm_reasoning",
        reasoningSpec: {
          prompt: "Synthesize preliminary context",
        },
        verification: { required: false, strategy: "none" },
        retryPolicy: {
          maxAttempts: 2,
          initialIntervalMs: 50,
          backoffMultiplier: 1.5,
          maxIntervalMs: 200,
        },
        timeoutMs: 5000,
      },
      step_2: {
        id: "step_2",
        title: "Second Step Reasoning",
        type: "llm_reasoning",
        reasoningSpec: {
          prompt: "Conclude based on prior steps",
        },
        inputBindings: {
          priorConclusion: {
            source: {
              type: "node_output",
              nodeId: "step_1",
              path: "conclusion",
            },
          },
        },
        verification: { required: false, strategy: "none" },
        retryPolicy: {
          maxAttempts: 2,
          initialIntervalMs: 50,
          backoffMultiplier: 1.5,
          maxIntervalMs: 200,
        },
        timeoutMs: 5000,
      },
    };

    const mergedNodes = overrides.nodes ? { ...overrides.nodes } : defaultNodes;
    for (const node of Object.values(mergedNodes) as any[]) {
      if (!node.verification) {
        node.verification = { required: false, strategy: "none" };
      }
    }

    const defaultEdges = [
      {
        id: "edge_1_2",
        fromNodeId: "step_1",
        toNodeId: "step_2",
        dependencyType: "hard" as const,
      },
    ];

    const defaultGraph: ExecutionGraph = {
      schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
      graphId,
      planRevision,
      revisionId,
      telegramUserId: 1001,
      goal: "Test autonomous execution workflow",
      status: "ready",
      nodes: mergedNodes,
      edges: overrides.edges !== undefined ? overrides.edges : defaultEdges,
      metadata: {
        plannerModel: "gemini-test",
        generatedAt: new Date().toISOString(),
        derivedStepCount: Object.keys(mergedNodes).length,
        isLinearChain: true,
        hasApprovalGates: false,
        ...(overrides.metadata || {}),
      },
    };

    return {
      ...defaultGraph,
      ...overrides,
      nodes: mergedNodes,
      metadata: {
        ...defaultGraph.metadata,
        ...(overrides.metadata || {}),
        derivedStepCount: Object.keys(mergedNodes).length,
      },
    };
  }

  describe("Topological Execution & Binding Resolution", () => {
    it("should execute a 2-step linear DAG in topological order and pass bound outputs", async () => {
      const graph = createTestGraph();
      await planPersistenceService.saveGraph(graph);

      const session = await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_exec_linear_01",
        executionContext: {
          telegramUserId: 1001,
          availableCapabilities: [],
        },
      });

      expect(session.status).toBe("completed");
      expect(session.completedNodes).toContain("step_1");
      expect(session.completedNodes).toContain("step_2");
      expect(session.failedNodes).toHaveLength(0);

      const status = await engine.getExecutionStatus(session.executionId);
      expect(status?.completedCount).toBe(2);
      expect(status?.failedCount).toBe(0);
      expect(status?.nodeResults["step_1"].success).toBe(true);
      expect(status?.nodeResults["step_2"].success).toBe(true);

      // Verify binding resolution
      const step2Output = status?.nodeResults["step_2"].output as any;
      expect(step2Output.structuredOutput.priorConclusion).toContain(
        "Reasoning completed for: First Step Reasoning",
      );
    });

    it("should reject binding referencing a non-ancestor forward node", () => {
      const graph = createTestGraph({
        nodes: {
          step_a: {
            id: "step_a",
            title: "First",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "test" },
            inputBindings: {
              invalidData: {
                source: {
                  type: "node_output",
                  nodeId: "step_b", // forward node, not ancestor
                  path: "output.data",
                },
              },
            },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1.5, maxIntervalMs: 100 },
            timeoutMs: 5000,
          },
          step_b: {
            id: "step_b",
            title: "Second",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "test" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1.5, maxIntervalMs: 100 },
            timeoutMs: 5000,
          },
        },
        edges: [
          {
            id: "e_a_b",
            fromNodeId: "step_a",
            toNodeId: "step_b",
            dependencyType: "hard",
          },
        ],
      });

      expect(() => {
        bindingResolver.resolveNodeInputs(
          graph.nodes["step_a"],
          graph,
          {},
          { telegramUserId: 1001 },
          new Set(), // no ancestors for step_a
        );
      }).toThrow(/forward or non-ancestor reference/i);
    });
  });

  describe("Tool Execution & Authoritative Policy Enforcement", () => {
    it("should execute registered tool and return verified output", async () => {
      let toolCalledWith: any = null;

      const mockTool: AssistantTool = {
        name: "search_data",
        description: "Searches structured database",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        execute: async (params, context) => {
          toolCalledWith = { params, context };
          return { matches: ["result_alpha", "result_beta"], count: 2 };
        },
      };

      toolRegistry.register(mockTool, {
        destructive: false,
        confirmationRequired: false,
        timeoutMs: 5000,
        requiredCapabilities: ["SEARCH_ACCESS"],
      });

      const graph = createTestGraph({
        nodes: {
          search_node: {
            id: "search_node",
            title: "Search Knowledge Base",
            type: "tool_call",
            actionSpec: {
              toolName: "search_data",
              parameters: {
                query: "quantum computing trends",
              },
            },
            retryPolicy: {
              maxAttempts: 2,
              initialIntervalMs: 50,
              backoffMultiplier: 1.5,
              maxIntervalMs: 100,
            },
            timeoutMs: 5000,
          },
        },
        edges: [],
      });

      await planPersistenceService.saveGraph(graph);

      const session = await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_tool_01",
        executionContext: {
          telegramUserId: 1001,
          availableCapabilities: ["SEARCH_ACCESS"],
        },
      });

      expect(session.status).toBe("completed");
      expect(toolCalledWith.params.query).toBe("quantum computing trends");
      expect(toolCalledWith.context.idempotencyKey).toContain("search_node:att1");

      const status = await engine.getExecutionStatus(session.executionId);
      expect(status?.nodeResults["search_node"].success).toBe(true);
      const out = status?.nodeResults["search_node"].output as any;
      expect(out.count).toBe(2);
      expect(out.matches).toEqual(["result_alpha", "result_beta"]);
    });

    it("should fail tool execution immediately if user lacks required capability", async () => {
      const mockTool: AssistantTool = {
        name: "admin_action",
        description: "Requires privileged capability",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ status: "ok" }),
      };

      toolRegistry.register(mockTool, {
        destructive: false,
        confirmationRequired: false,
        requiredCapabilities: ["SUPER_ADMIN"],
      });

      const graph = createTestGraph({
        nodes: {
          admin_node: {
            id: "admin_node",
            title: "Admin Node",
            type: "tool_call",
            actionSpec: {
              toolName: "admin_action",
              parameters: {},
            },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1.5, maxIntervalMs: 100 },
            timeoutMs: 5000,
          },
        },
        edges: [],
      });

      await planPersistenceService.saveGraph(graph);

      // Start execution without SUPER_ADMIN capability
      await expect(
        engine.startExecution({
          graphId: graph.graphId,
          planRevision: graph.planRevision,
          requestId: "req_tool_unauthorized",
          executionContext: {
            telegramUserId: 1001,
            availableCapabilities: ["BASIC_USER"],
          },
        }),
      ).rejects.toThrow(/User lacks required capabilities|insufficient runtime capabilities/i);
    });
  });

  describe("Resilience, Error Classification & Retry Policy", () => {
    it("should classify 429 / 503 network errors as retryable with exponential backoff", () => {
      const err429 = new Error("Rate limit exceeded (status: 429)");
      const classified429 = retryEngine.classifyError(err429);
      expect(classified429.retryable).toBe(true);
      expect(classified429.category).toBe("rate_limit");

      const err503 = new Error("Service Unavailable (status: 503)");
      const classified503 = retryEngine.classifyError(err503);
      expect(classified503.retryable).toBe(true);
      expect(classified503.category).toBe("provider");

      const evalRetry = retryEngine.evaluateRetry({
        node: {
          id: "test_n",
          title: "Test",
          type: "llm_reasoning",
          retryPolicy: {
            maxAttempts: 3,
            initialIntervalMs: 100,
            backoffMultiplier: 2.0,
            maxIntervalMs: 1000,
          },
          timeoutMs: 5000,
        },
        currentAttempt: 1,
        error: classified429,
        isDestructiveTool: false,
        isCancelled: false,
      });

      expect(evalRetry.shouldRetry).toBe(true);
      expect(evalRetry.attempt).toBe(2);
      expect(evalRetry.delayMs).toBeGreaterThanOrEqual(100);
    });

    it("should NOT retry validation or authorization errors", () => {
      const validationErr = {
        code: "INVALID_INPUT_SCHEMA",
        message: "Missing parameter 'id'",
        retryable: false,
        category: "validation" as const,
      };

      const evalRetry = retryEngine.evaluateRetry({
        node: {
          id: "val_n",
          title: "Val Node",
          type: "llm_reasoning",
          retryPolicy: { maxAttempts: 5, initialIntervalMs: 100, backoffMultiplier: 2, maxIntervalMs: 1000 },
          timeoutMs: 5000,
        },
        currentAttempt: 1,
        error: validationErr,
        isDestructiveTool: false,
        isCancelled: false,
      });

      expect(evalRetry.shouldRetry).toBe(false);
      expect(evalRetry.attempt).toBe(1);
    });

    it("should NOT retry destructive tools even on transient network errors", () => {
      const networkErr = {
        code: "NETWORK_TIMEOUT",
        message: "Connection timed out",
        retryable: true,
        category: "network" as const,
      };

      const evalRetry = retryEngine.evaluateRetry({
        node: {
          id: "delete_n",
          title: "Delete DB",
          type: "tool_call",
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 100, backoffMultiplier: 2, maxIntervalMs: 1000 },
          timeoutMs: 5000,
        },
        currentAttempt: 1,
        error: networkErr,
        isDestructiveTool: true, // DESTRUCTIVE tool
        isCancelled: false,
      });

      expect(evalRetry.shouldRetry).toBe(false);
    });
  });

  describe("Human-in-the-Loop & Approval Checkpoints", () => {
    it("should pause on user_checkpoint node, then resume on approval", async () => {
      const graph = createTestGraph({
        nodes: {
          step_pre: {
            id: "step_pre",
            title: "Pre-computation",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Gather info" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
          step_checkpoint: {
            id: "step_checkpoint",
            title: "Confirm Before Proceeding",
            type: "user_checkpoint",
            approval: {
              status: "pending",
              reason: "Do you agree to publish?",
            },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
          step_post: {
            id: "step_post",
            title: "Post-approval Publication",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Publish final report" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
        },
        edges: [
          { id: "e1", fromNodeId: "step_pre", toNodeId: "step_checkpoint", dependencyType: "hard" },
          { id: "e2", fromNodeId: "step_checkpoint", toNodeId: "step_post", dependencyType: "hard" },
        ],
      });

      await planPersistenceService.saveGraph(graph);

      // Start execution: should run step_pre, hit step_checkpoint, and pause
      const session = await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_checkpoint_01",
        executionContext: {
          telegramUserId: 1001,
          availableCapabilities: [],
        },
      });

      expect(session.status).toBe("paused_for_approval");
      expect(session.waitingApprovalNodes).toContain("step_checkpoint");
      expect(session.completedNodes).toContain("step_pre");
      expect(session.completedNodes).not.toContain("step_post");

      // Now submit approval
      const approvalResult = await engine.submitApproval({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        nodeId: "step_checkpoint",
        approved: true,
        reason: "Looks great, please publish",
        telegramUserId: 1001,
      });

      expect(approvalResult.approved).toBe(true);
      expect(approvalResult.session?.status).toBe("completed");
      expect(approvalResult.session?.completedNodes).toContain("step_checkpoint");
      expect(approvalResult.session?.completedNodes).toContain("step_post");
    });

    it("should pause on user_checkpoint and fail graph if approval is denied", async () => {
      const graph = createTestGraph({
        nodes: {
          step_gate: {
            id: "step_gate",
            title: "Critical Decision Gate",
            type: "user_checkpoint",
            approval: {
              status: "pending",
              reason: "Authorize deploy?",
            },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
          step_deploy: {
            id: "step_deploy",
            title: "Production Deploy",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Deploy code" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
        },
        edges: [
          { id: "e1", fromNodeId: "step_gate", toNodeId: "step_deploy", dependencyType: "hard" },
        ],
      });

      await planPersistenceService.saveGraph(graph);

      await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_checkpoint_deny_01",
        executionContext: { telegramUserId: 1001 },
      });

      // Submit denial
      const approvalResult = await engine.submitApproval({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        nodeId: "step_gate",
        approved: false,
        reason: "Code has critical vulnerability",
        telegramUserId: 1001,
      });

      expect(approvalResult.approved).toBe(false);

      // Verify approval record is denied
      const approval = await executionPersistence.getApproval(
        graph.graphId,
        graph.planRevision,
        "step_gate",
      );
      expect(approval?.status).toBe("denied");
      expect(approval?.reason).toBe("Code has critical vulnerability");
    });
  });

  describe("Subgoal Aggregation", () => {
    it("should aggregate results from upstream completed nodes", async () => {
      const graph = createTestGraph({
        nodes: {
          worker_1: {
            id: "worker_1",
            title: "Worker One",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Analyze sector A" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
          worker_2: {
            id: "worker_2",
            title: "Worker Two",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Analyze sector B" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
          aggregator: {
            id: "aggregator",
            title: "Consolidate Analysis",
            type: "subgoal_aggregate",
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
        },
        edges: [
          { id: "e1", fromNodeId: "worker_1", toNodeId: "aggregator", dependencyType: "hard" },
          { id: "e2", fromNodeId: "worker_2", toNodeId: "aggregator", dependencyType: "hard" },
        ],
      });

      await planPersistenceService.saveGraph(graph);

      const session = await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_agg_01",
        executionContext: { telegramUserId: 1001 },
      });

      expect(session.status).toBe("completed");
      expect(session.completedNodes).toContain("aggregator");

      const status = await engine.getExecutionStatus(session.executionId);
      const aggOutput = status?.nodeResults["aggregator"].output as any;
      expect(aggOutput.summary).toContain("Aggregated results for Consolidate Analysis");
      expect(aggOutput.nodeResults["worker_1"]).toBeDefined();
      expect(aggOutput.nodeResults["worker_2"]).toBeDefined();
    });
  });

  describe("Deterministic Dry Run Simulation", () => {
    it("should simulate execution order, identify approvals, and verify capabilities without executing", async () => {
      const mockDestructiveTool: AssistantTool = {
        name: "format_disk",
        description: "Dangerous format",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ done: true }),
      };

      toolRegistry.register(mockDestructiveTool, {
        destructive: true,
        confirmationRequired: true,
        requiredCapabilities: ["STORAGE_ADMIN"],
      });

      const graph = createTestGraph({
        nodes: {
          step_a: {
            id: "step_a",
            title: "Step A",
            type: "llm_reasoning",
            reasoningSpec: { prompt: "Intro" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 10000,
          },
          step_b: {
            id: "step_b",
            title: "Format Drive",
            type: "tool_call",
            actionSpec: {
              toolName: "format_disk",
              parameters: {},
            },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 15000,
          },
        },
        edges: [
          { id: "e_ab", fromNodeId: "step_a", toNodeId: "step_b", dependencyType: "hard" },
        ],
      });

      await planPersistenceService.saveGraph(graph);

      const dryRun = await engine.dryRunExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_dryrun_test",
        executionContext: {
          telegramUserId: 1001,
          availableCapabilities: ["STORAGE_ADMIN"],
        },
      });

      expect(dryRun.graphId).toBe(graph.graphId);
      expect(dryRun.simulatedExecutionOrder).toEqual(["step_a", "step_b"]);
      expect(dryRun.approvalsRequired).toContain("step_b");
      expect(dryRun.allCapabilitiesSatisfied).toBe(true);
      expect(dryRun.estimatedTotalTimeoutMs).toBe(25000);
      expect(dryRun.steps).toHaveLength(2);
      expect(dryRun.steps[1].approvalRequired).toBe(true);
      expect(dryRun.steps[1].simulatedStatus).toBe("waiting_approval");

      // Verify NO side effects / executions were persisted
      const historicalAttempts = await executionPersistence.getCompletedExecutionsForGraph(
        graph.graphId,
        graph.planRevision,
      );
      expect(historicalAttempts).toHaveLength(0);
    });
  });

  describe("Observability & Structured Telemetry", () => {
    it("should emit structured execution events and compute metrics accurately", async () => {
      const graph = createTestGraph();
      await planPersistenceService.saveGraph(graph);

      await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_obs_test",
        executionContext: { telegramUserId: 1001 },
      });

      const metrics = executionObservability.getMetrics();
      expect(metrics.totalNodeExecutions).toBeGreaterThanOrEqual(2);
      expect(metrics.completedNodeExecutions).toBeGreaterThanOrEqual(2);
      expect(metrics.failedNodeExecutions).toBe(0);

      const events = executionObservability.getRecentEvents(20);
      const eventTypes = events.map((e) => e.event);
      expect(eventTypes).toContain("EXECUTION_STARTED");
      expect(eventTypes).toContain("NODE_STARTED");
      expect(eventTypes).toContain("NODE_COMPLETED");
      expect(eventTypes).toContain("GRAPH_COMPLETED");
    });
  });

  describe("Cancellation & AbortSignal Propagation", () => {
    it("should cancel active execution and transition status to cancelled", async () => {
      const graph = createTestGraph({
        nodes: {
          step_checkpoint: {
            id: "step_checkpoint",
            title: "Wait user approval",
            type: "user_checkpoint",
            approval: { status: "pending" },
            retryPolicy: { maxAttempts: 1, initialIntervalMs: 50, backoffMultiplier: 1, maxIntervalMs: 50 },
            timeoutMs: 5000,
          },
        },
        edges: [],
      });
      await planPersistenceService.saveGraph(graph);

      const session = await engine.startExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        requestId: "req_cancel_test",
        executionContext: { telegramUserId: 1001 },
      });

      expect(session.status).toBe("paused_for_approval");

      // Cancel execution
      const cancelled = await engine.cancelExecution({
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        reason: "User cancelled task",
      });

      expect(cancelled.status).toBe("cancelled");
      const stored = await executionPersistence.getExecutionSession(session.executionId);
      expect(stored?.status).toBe("cancelled");
    });
  });
});
