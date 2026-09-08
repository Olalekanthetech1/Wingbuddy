import { describe, it, expect, beforeEach } from "vitest";
import {
  GraphValidator,
  type ExecutionGraph,
  type GraphNode,
  CURRENT_GRAPH_SCHEMA_VERSION,
} from "../src/planner";
import { ToolRegistry } from "../src/tools/tool-registry";

function createValidBaseGraph(): ExecutionGraph {
  const nodeA: GraphNode = {
    id: "step_fetch_data",
    title: "Fetch user activity data",
    type: "tool_call",
    actionSpec: {
      toolName: "read_user_data",
      parameters: { format: "json" },
    },
    inputBindings: {},
    status: "pending",
    approval: {
      status: "not_required",
      reason: "Read-only operation",
    },
    verification: {
      required: false,
      strategy: "none",
    },
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    timeoutMs: 15000,
  };

  const nodeB: GraphNode = {
    id: "step_analyze",
    title: "Synthesize insights from data",
    type: "llm_reasoning",
    reasoningSpec: {
      prompt: "Analyze user activity metrics and highlight outliers",
      targetFormat: "json",
    },
    inputBindings: {
      rawData: {
        source: {
          type: "node_output",
          nodeId: "step_fetch_data",
          path: "records",
        },
      },
    },
    status: "pending",
    approval: {
      status: "not_required",
      reason: "Pure computation",
    },
    verification: {
      required: true,
      strategy: "schema",
      schemaOrRule: { type: "object", required: ["summary", "outliers"] },
    },
    retryPolicy: { maxAttempts: 1, backoffMs: 500 },
    timeoutMs: 30000,
  };

  const nodeC: GraphNode = {
    id: "step_store_insight",
    title: "Persist summary to memory",
    type: "memory_write",
    memorySpec: {
      key: "user_metrics_summary",
      content: "Computed activity summary",
      category: "metrics",
    },
    inputBindings: {
      summaryContent: {
        source: {
          type: "node_output",
          nodeId: "step_analyze",
          path: "summary",
        },
      },
    },
    status: "pending",
    approval: {
      status: "not_required",
      reason: "Memory commit",
    },
    verification: {
      required: false,
      strategy: "none",
    },
    retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    timeoutMs: 10000,
  };

  return {
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
    graphId: "plan_activity_analysis_001",
    planRevision: 1,
    revisionId: "plan_activity_analysis_001:r1",
    telegramUserId: 123456,
    goal: "Analyze weekly activity logs and store insights",
    status: "ready",
    nodes: {
      step_fetch_data: nodeA,
      step_analyze: nodeB,
      step_store_insight: nodeC,
    },
    edges: [
      {
        fromNodeId: "step_fetch_data",
        toNodeId: "step_analyze",
        dependencyType: "hard",
      },
      {
        fromNodeId: "step_analyze",
        toNodeId: "step_store_insight",
        dependencyType: "hard",
      },
    ],
    metadata: {
      derivedStepCount: 3,
      advisoryEstimatedSteps: 3,
      requiresApproval: false,
      createdAt: "2026-09-08T12:00:00Z",
      updatedAt: "2026-09-08T12:00:00Z",
    },
  };
}

describe("Agent Planner & Execution Graph Contracts", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register({
      name: "read_user_data",
      description: "Fetches user records",
      policy: {
        sideEffect: false,
        destructive: false,
        confirmationRequired: false,
        requiredCapabilities: ["read_data"],
        timeoutMs: 20000,
      },
      execute: async () => ({ records: [1, 2, 3] }),
    });

    registry.register({
      name: "delete_database_table",
      description: "Destructive table deletion",
      policy: {
        sideEffect: true,
        destructive: true,
        confirmationRequired: true,
        requiredCapabilities: ["admin_db"],
        timeoutMs: 30000,
      },
      execute: async () => ({ success: true }),
    });
  });

  describe("1. Valid Graph Baseline & Topological Sorting", () => {
    it("validates a compliant multi-step DAG and computes topological order", () => {
      const graph = createValidBaseGraph();
      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["read_data"],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.topologicalOrder).toEqual([
        "step_fetch_data",
        "step_analyze",
        "step_store_insight",
      ]);
      expect(result.derivedStepCount).toBe(3);
    });

    it("correctly handles branching parallel DAG flows (diamond pattern)", () => {
      const graph = createValidBaseGraph();

      // Add parallel branch node
      const nodeB2: GraphNode = {
        id: "step_parallel_stats",
        title: "Compute statistical variance",
        type: "llm_reasoning",
        reasoningSpec: { prompt: "Compute variance" },
        inputBindings: {
          data: {
            source: {
              type: "node_output",
              nodeId: "step_fetch_data",
              path: "records",
            },
          },
        },
        status: "pending",
        approval: { status: "not_required", reason: "Pure calculation" },
        verification: { required: false, strategy: "none" },
        retryPolicy: { maxAttempts: 1, backoffMs: 500 },
        timeoutMs: 15000,
      };

      graph.nodes["step_parallel_stats"] = nodeB2;

      // step_fetch_data -> step_parallel_stats -> step_store_insight
      graph.edges.push(
        {
          fromNodeId: "step_fetch_data",
          toNodeId: "step_parallel_stats",
          dependencyType: "hard",
        },
        {
          fromNodeId: "step_parallel_stats",
          toNodeId: "step_store_insight",
          dependencyType: "hard",
        },
      );

      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["read_data"],
      });

      expect(result.valid).toBe(true);
      expect(result.derivedStepCount).toBe(4);
      expect(result.topologicalOrder![0]).toBe("step_fetch_data");
      expect(result.topologicalOrder![3]).toBe("step_store_insight");
    });
  });

  describe("2. Acyclicity & Kahn's Algorithm (Invariants 1 & 10)", () => {
    it("detects and rejects direct 2-node cycles", () => {
      const graph = createValidBaseGraph();
      // Add back-edge from store_insight to fetch_data
      graph.edges.push({
        fromNodeId: "step_store_insight",
        toNodeId: "step_fetch_data",
        dependencyType: "hard",
      });

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
    });

    it("detects and rejects self-directed edges", () => {
      const graph = createValidBaseGraph();
      graph.edges.push({
        fromNodeId: "step_analyze",
        toNodeId: "step_analyze",
        dependencyType: "hard",
      });

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SELF_EDGE_DETECTED")).toBe(true);
    });

    it("detects and rejects duplicate edges", () => {
      const graph = createValidBaseGraph();
      graph.edges.push({
        fromNodeId: "step_fetch_data",
        toNodeId: "step_analyze",
        dependencyType: "hard",
      });

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "DUPLICATE_EDGE_DETECTED")).toBe(true);
    });
  });

  describe("3. Graph Versioning & Bounds", () => {
    it("rejects unsupported schema versions", () => {
      const graph = createValidBaseGraph();
      (graph as any).schemaVersion = 99;

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
    });

    it("rejects invalid graph IDs", () => {
      const graph = createValidBaseGraph();
      graph.graphId = "invalid id with spaces!";

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_GRAPH_ID")).toBe(true);
    });

    it("rejects invalid plan revisions", () => {
      const graph = createValidBaseGraph();
      graph.planRevision = 0;

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_PLAN_REVISION")).toBe(true);
    });

    it("rejects an empty graph", () => {
      const graph = createValidBaseGraph();
      graph.nodes = {};
      graph.edges = [];

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "EMPTY_GRAPH")).toBe(true);
    });
  });

  describe("4. Reachability, Sources & Sinks", () => {
    it("detects disconnected unreachable orphan nodes", () => {
      const graph = createValidBaseGraph();
      // Add floating node with no connected edges
      graph.nodes["orphan_node"] = {
        id: "orphan_node",
        title: "Floating node",
        type: "llm_reasoning",
        reasoningSpec: { prompt: "Isolated action" },
        inputBindings: {},
        status: "pending",
        approval: { status: "not_required", reason: "test" },
        verification: { required: false, strategy: "none" },
        retryPolicy: { maxAttempts: 1, backoffMs: 500 },
        timeoutMs: 10000,
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNREACHABLE_NODE_DETECTED")).toBe(true);
    });
  });

  describe("5. Typed Input Bindings & Ancestry Validation (Invariant 3 & 10)", () => {
    it("rejects input binding if source node does not exist", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].inputBindings["missingData"] = {
        source: {
          type: "node_output",
          nodeId: "non_existent_node",
          path: "output",
        },
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "BINDING_TARGET_NODE_NOT_FOUND")).toBe(true);
    });

    it("rejects input binding if node attempts self-reference", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].inputBindings["selfRef"] = {
        source: {
          type: "node_output",
          nodeId: "step_analyze",
          path: "my_own_output",
        },
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "BINDING_SELF_REFERENCE")).toBe(true);
    });

    it("rejects input binding if source node is a downstream descendant (forward binding)", () => {
      const graph = createValidBaseGraph();
      // step_fetch_data tries to bind to downstream step_store_insight
      graph.nodes["step_fetch_data"].inputBindings = {
        illegalForwardData: {
          source: {
            type: "node_output",
            nodeId: "step_store_insight",
            path: "result",
          },
        },
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "BINDING_SOURCE_NOT_ANCESTOR")).toBe(true);
    });

    it("rejects binding with invalid path format", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].inputBindings["badPath"] = {
        source: {
          type: "node_output",
          nodeId: "step_fetch_data",
          path: "bad path with spaces & punctuation ;;",
        },
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_BINDING_PATH")).toBe(true);
    });
  });

  describe("6. Strict Boundaries on llm_reasoning (Invariant 11)", () => {
    it("rejects llm_reasoning node that attempts to specify a tool actionSpec", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].actionSpec = {
        toolName: "unauthorized_tool",
        parameters: {},
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.code === "LLM_REASONING_CANNOT_HAVE_TOOL_ACTION"),
      ).toBe(true);
    });

    it("rejects llm_reasoning node missing a reasoning prompt", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].reasoningSpec = { prompt: "   " };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_REASONING_SPEC")).toBe(true);
    });
  });

  describe("7. Tool Registry, Security Policies & Capabilities (Invariants 6 & 7)", () => {
    it("rejects plan if tool does not exist in ToolRegistry (PLAN_REJECTED)", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_fetch_data"].actionSpec = {
        toolName: "fictional_unregistered_tool",
        parameters: {},
      };

      const result = GraphValidator.validate(graph, { toolRegistry: registry });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNKNOWN_TOOL_IN_PLAN")).toBe(true);
    });

    it("rejects plan if user lacks required tool capabilities", () => {
      const graph = createValidBaseGraph();
      // User only has "read_calendar", but tool requires "read_data"
      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["read_calendar"],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "UNAUTHORIZED_TOOL_CAPABILITY")).toBe(true);
    });

    it("rejects plan if destructive tool lacks an explicit approval gate", () => {
      const graph = createValidBaseGraph();
      // Swap tool with destructive one
      graph.nodes["step_fetch_data"].actionSpec = {
        toolName: "delete_database_table",
        parameters: { table: "logs" },
      };
      // Node incorrectly claims approval is not_required
      graph.nodes["step_fetch_data"].approval.status = "not_required";

      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["admin_db"],
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.code === "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE"),
      ).toBe(true);
    });

    it("accepts destructive tool when approval gate is properly configured as pending", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_fetch_data"].actionSpec = {
        toolName: "delete_database_table",
        parameters: { table: "logs" },
      };
      graph.nodes["step_fetch_data"].approval = {
        status: "pending",
        reason: "Requires user confirmation before deleting table",
      };

      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["admin_db"],
      });

      expect(result.valid).toBe(true);
      expect(result.effectivePolicies!["step_fetch_data"].destructive).toBe(true);
    });
  });

  describe("8. Bounded Retries & Timeouts (Invariant 10)", () => {
    it("rejects excessive maxAttempts (> 5)", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_fetch_data"].retryPolicy.maxAttempts = 10;

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_RETRY_POLICY")).toBe(true);
    });

    it("rejects invalid timeout values (< 100ms or > 300,000ms)", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_fetch_data"].timeoutMs = 50;

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_TIMEOUT")).toBe(true);
    });
  });

  describe("9. Verification Strategy Validation (Invariant 12)", () => {
    it("rejects required verification with strategy 'none'", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].verification = {
        required: true,
        strategy: "none",
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_VERIFICATION_STRATEGY")).toBe(true);
    });

    it("rejects schema verification strategy without schemaOrRule", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].verification = {
        required: true,
        strategy: "schema",
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_VERIFICATION_SCHEMA")).toBe(true);
    });

    it("rejects assertion verification strategy with empty assertion expression", () => {
      const graph = createValidBaseGraph();
      graph.nodes["step_analyze"].verification = {
        required: true,
        strategy: "assertion",
        assertionExpression: "   ",
      };

      const result = GraphValidator.validate(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_VERIFICATION_ASSERTION")).toBe(true);
    });
  });

  describe("10. Derived Metadata & Plan Revision Chains (Invariants 1, 4 & 5)", () => {
    it("normalizes derived step count and warns if advisory metadata disagrees", () => {
      const graph = createValidBaseGraph();
      graph.metadata.derivedStepCount = 999;
      graph.metadata.advisoryEstimatedSteps = 10;

      const result = GraphValidator.validate(graph, {
        toolRegistry: registry,
        userCapabilities: ["read_data"],
      });

      expect(result.valid).toBe(true);
      expect(result.derivedStepCount).toBe(3);
      expect(
        result.warnings.some((w) => w.code === "DERIVED_STEP_COUNT_NORMALIZED"),
      ).toBe(true);
      expect(
        result.warnings.some((w) => w.code === "ADVISORY_METADATA_MISMATCH"),
      ).toBe(true);
    });

    it("supports revision chains across replanning without mutable cyclic rewrites", () => {
      const originalGraph = createValidBaseGraph();

      // Next revision generated upon replan:
      const replannedGraph: ExecutionGraph = {
        ...originalGraph,
        planRevision: 2,
        revisionId: `${originalGraph.graphId}:r2`,
        parentRevisionId: originalGraph.revisionId,
        goal: "Analyze weekly activity logs with fallback heuristic",
      };

      const result = GraphValidator.validate(replannedGraph, {
        toolRegistry: registry,
        userCapabilities: ["read_data"],
      });

      expect(result.valid).toBe(true);
      expect(replannedGraph.planRevision).toBe(2);
      expect(replannedGraph.parentRevisionId).toBe("plan_activity_analysis_001:r1");
    });
  });
});
