import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentPlannerService,
  PlannerCompiler,
  PlanPersistenceService,
  GraphValidator,
  type ExecutionGraph,
  type CandidatePlan,
  type CandidateNode,
  CURRENT_GRAPH_SCHEMA_VERSION,
  MAX_GRAPH_NODES,
  MAX_NODE_RETRIES,
  MIN_NODE_TIMEOUT_MS,
  MAX_NODE_TIMEOUT_MS,
} from "../src/planner";
import { ToolRegistry } from "../src/tools/tool-registry";

/**
 * Reusable Invariant Testing Helper (Section 16)
 * Enforces all 10 core invariant properties across any compiled ExecutionGraph.
 */
export function assertGraphInvariants(
  graph: ExecutionGraph,
  options?: { registry?: ToolRegistry; userCapabilities?: string[] },
): void {
  // 1. Schema & identities
  expect(graph.schemaVersion).toBe(CURRENT_GRAPH_SCHEMA_VERSION);
  expect(graph.graphId).toMatch(/^[a-zA-Z0-9_-]{3,64}$/);
  expect(graph.planRevision).toBeGreaterThanOrEqual(1);
  expect(graph.revisionId).toBe(`${graph.graphId}:r${graph.planRevision}`);

  // 2. Node count & bounds
  const nodeEntries = Object.entries(graph.nodes);
  expect(nodeEntries.length).toBeGreaterThan(0);
  expect(nodeEntries.length).toBeLessThanOrEqual(MAX_GRAPH_NODES);
  expect(graph.metadata.derivedStepCount).toBe(nodeEntries.length);

  // 3. Unique node IDs and dictionary keys
  const nodeIds = new Set<string>();
  for (const [key, node] of nodeEntries) {
    expect(key).toBe(node.id);
    expect(nodeIds.has(node.id)).toBe(false);
    nodeIds.add(node.id);

    // Bounded retries and timeouts
    expect(node.retryPolicy.maxAttempts).toBeGreaterThanOrEqual(0);
    expect(node.retryPolicy.maxAttempts).toBeLessThanOrEqual(MAX_NODE_RETRIES);
    expect(node.timeoutMs).toBeGreaterThanOrEqual(MIN_NODE_TIMEOUT_MS);
    expect(node.timeoutMs).toBeLessThanOrEqual(MAX_NODE_TIMEOUT_MS);

    // Pure reasoning check
    if (node.type === "llm_reasoning") {
      expect(node.actionSpec).toBeUndefined();
      expect(node.reasoningSpec?.prompt).toBeDefined();
    }

    // Tool checks
    if (node.type === "tool_call" && options?.registry) {
      expect(node.actionSpec?.toolName).toBeDefined();
      const tool = options.registry.get(node.actionSpec!.toolName);
      expect(tool).toBeDefined();
      const policy = options.registry.getPolicy(node.actionSpec!.toolName);
      if (options.userCapabilities && policy.requiredCapabilities.length > 0) {
        for (const cap of policy.requiredCapabilities) {
          expect(options.userCapabilities).toContain(cap);
        }
      }
      if (policy.destructive || policy.confirmationRequired) {
        expect(node.approval.status).not.toBe("not_required");
      }
    }
  }

  // 4. Edges check
  for (const edge of graph.edges) {
    expect(nodeIds.has(edge.fromNodeId)).toBe(true);
    expect(nodeIds.has(edge.toNodeId)).toBe(true);
    expect(edge.fromNodeId).not.toBe(edge.toNodeId);
  }

  // 5. Kahn / Topological sort & validator check
  const validation = GraphValidator.validate(graph, {
    toolRegistry: options?.registry,
    userCapabilities: options?.userCapabilities,
  });
  expect(validation.valid).toBe(true);
  expect(validation.topologicalOrder).toBeDefined();
}

describe("Planner Compiler & Deterministic Agent Planner (Tests 1–18)", () => {
  let registry: ToolRegistry;
  let persistence: PlanPersistenceService;
  let planner: AgentPlannerService;

  beforeEach(() => {
    registry = new ToolRegistry();

    // Register test tools
    registry.register({
      name: "fetch_topic_research",
      description: "Searches literature on a topic",
      policy: {
        sideEffect: false,
        destructive: false,
        confirmationRequired: false,
        requiredCapabilities: ["read_research"],
        timeoutMs: 25000,
      },
      execute: async () => ({ results: ["Paper 1", "Paper 2"] }),
    });

    registry.register({
      name: "delete_user_session",
      description: "Destructive session wipe",
      policy: {
        sideEffect: true,
        destructive: true,
        confirmationRequired: true,
        requiredCapabilities: ["admin_session"],
        timeoutMs: 30000,
      },
      execute: async () => ({ wiped: true }),
    });

    persistence = new PlanPersistenceService();
    persistence.clear();

    planner = new AgentPlannerService(persistence, registry);
  });

  // TEST 1 — Simple Direct Answer Optimization
  it("Test 1 — Simple direct answer generates minimal 1-node reasoning graph without bloat", async () => {
    const result = await planner.plan({
      requestId: "req_direct_001",
      telegramUserId: 1001,
      goal: "What is Young's modulus?",
      context: { capabilities: ["read_research"] },
      toolRegistry: registry,
    });

    expect(result.success).toBe(true);
    expect(result.isDirectResponse).toBe(true);
    expect(result.graph).toBeDefined();

    const graph = result.graph!;
    expect(graph.metadata.derivedStepCount).toBe(1);
    expect(graph.edges).toHaveLength(0);

    const nodes = Object.values(graph.nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("llm_reasoning");
    expect(nodes[0].actionSpec).toBeUndefined(); // Zero tool specs
    expect(nodes[0].approval.status).toBe("not_required");
    expect(graph.metadata.requiresApproval).toBe(false);

    assertGraphInvariants(graph, { registry, userCapabilities: ["read_research"] });
  });

  // TEST 2 — Multi-Step Objective (Research -> Analyze -> Synthesize -> Verify)
  it("Test 2 — Multi-step objective compiles with sequential dependencies and verification", async () => {
    const candidate: CandidatePlan = {
      goal: "Research quantum cryptography, analyze security protocols, and synthesize verified summary",
      nodes: [
        {
          id: "step_research",
          title: "Research topic literature",
          type: "tool_call",
          actionSpec: {
            toolName: "fetch_topic_research",
            parameters: { query: "quantum cryptography" },
          },
        },
        {
          id: "step_analyze",
          title: "Analyze research findings",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Analyze findings for vulnerabilities" },
          dependsOn: ["step_research"],
          inputBindings: {
            researchData: {
              source: {
                type: "node_output",
                nodeId: "step_research",
                path: "results",
              },
            },
          },
        },
        {
          id: "step_synthesize",
          title: "Synthesize executive report",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Synthesize findings into executive briefing" },
          dependsOn: ["step_analyze"],
          verification: {
            required: true,
            strategy: "schema",
            schemaOrRule: { type: "object", required: ["briefing"] },
          },
        },
      ],
    };

    const result = await planner.plan(
      {
        requestId: "req_multistep_002",
        telegramUserId: 1001,
        goal: candidate.goal,
        context: { capabilities: ["read_research"] },
        toolRegistry: registry,
      },
      candidate,
    );

    expect(result.success).toBe(true);
    const graph = result.graph!;
    expect(graph.metadata.derivedStepCount).toBe(3);
    expect(graph.edges).toHaveLength(2);

    // Verify sequential edge flow: step_research -> step_analyze -> step_synthesize
    expect(graph.edges[0].fromNodeId).toBe("step_research");
    expect(graph.edges[0].toNodeId).toBe("step_analyze");
    expect(graph.edges[1].fromNodeId).toBe("step_analyze");
    expect(graph.edges[1].toNodeId).toBe("step_synthesize");

    // Verify verification spec on terminal node
    expect(graph.nodes["step_synthesize"].verification.required).toBe(true);
    expect(graph.nodes["step_synthesize"].verification.strategy).toBe("schema");

    assertGraphInvariants(graph, { registry, userCapabilities: ["read_research"] });
  });

  // TEST 3 — Parallel Branches (Research A, Research B, Research C -> Aggregate)
  it("Test 3 — Parallel branches compile cleanly into an aggregation sink", async () => {
    const candidate: CandidatePlan = {
      goal: "Analyze multi-domain risk factors across A, B, and C in parallel",
      nodes: [
        {
          id: "research_a",
          title: "Research Domain A",
          type: "tool_call",
          actionSpec: { toolName: "fetch_topic_research", parameters: { domain: "A" } },
        },
        {
          id: "research_b",
          title: "Research Domain B",
          type: "tool_call",
          actionSpec: { toolName: "fetch_topic_research", parameters: { domain: "B" } },
        },
        {
          id: "research_c",
          title: "Research Domain C",
          type: "tool_call",
          actionSpec: { toolName: "fetch_topic_research", parameters: { domain: "C" } },
        },
        {
          id: "aggregate_findings",
          title: "Aggregate cross-domain findings",
          type: "subgoal_aggregate",
          dependsOn: ["research_a", "research_b", "research_c"],
          inputBindings: {
            dataA: { source: { type: "node_output", nodeId: "research_a", path: "results" } },
            dataB: { source: { type: "node_output", nodeId: "research_b", path: "results" } },
            dataC: { source: { type: "node_output", nodeId: "research_c", path: "results" } },
          },
        },
      ],
    };

    const result = await planner.plan(
      {
        requestId: "req_parallel_003",
        telegramUserId: 1001,
        goal: candidate.goal,
        context: { capabilities: ["read_research"] },
        toolRegistry: registry,
      },
      candidate,
    );

    expect(result.success).toBe(true);
    const graph = result.graph!;
    expect(graph.metadata.derivedStepCount).toBe(4);
    expect(graph.edges).toHaveLength(3);

    // Three parallel in-edges to aggregate_findings
    const incomingToAggregate = graph.edges.filter((e) => e.toNodeId === "aggregate_findings");
    expect(incomingToAggregate).toHaveLength(3);

    assertGraphInvariants(graph, { registry, userCapabilities: ["read_research"] });
  });

  // TEST 4 — Explicit Dependency Ancestry Enforcement
  it("Test 4 — Explicit dependency: B cannot consume A's output unless A is an actual ancestor", () => {
    // Two disconnected nodes where B attempts to bind to A without an edge
    const candidate: CandidatePlan = {
      goal: "Attempt unlinked data consumption",
      nodes: [
        {
          id: "node_a",
          title: "Source node",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Generate A" },
        },
        {
          id: "node_b",
          title: "Target node",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Generate B" },
          inputBindings: {
            inputA: { source: { type: "node_output", nodeId: "node_a", path: "data" } },
          },
        },
      ],
      edges: [], // No edge between node_a and node_b!
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_ancestry_004",
      telegramUserId: 1001,
      graphId: "plan_ancestry_test",
    });

    expect(compiled.success).toBe(false);
    expect(
      compiled.diagnostics.some(
        (d) => d.code === "BINDING_SOURCE_NOT_ANCESTOR" || d.code === "UNREACHABLE_NODE_DETECTED",
      ),
    ).toBe(true);
  });

  // TEST 5 — Invalid Cycle Rejection (A -> B -> C -> A)
  it("Test 5 — Invalid cycle (A -> B -> C -> A) is strictly rejected", () => {
    const candidate: CandidatePlan = {
      goal: "Cyclic proposal",
      nodes: [
        { id: "node_a", title: "Node A", type: "llm_reasoning", reasoningSpec: { prompt: "A" } },
        { id: "node_b", title: "Node B", type: "llm_reasoning", reasoningSpec: { prompt: "B" } },
        { id: "node_c", title: "Node C", type: "llm_reasoning", reasoningSpec: { prompt: "C" } },
      ],
      edges: [
        { fromNodeId: "node_a", toNodeId: "node_b" },
        { fromNodeId: "node_b", toNodeId: "node_c" },
        { fromNodeId: "node_c", toNodeId: "node_a" }, // Back-edge causing cycle
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_cycle_005",
      telegramUserId: 1001,
      graphId: "plan_cycle_test",
    });

    expect(compiled.success).toBe(false);
    expect(compiled.diagnostics.some((d) => d.code === "CYCLE_DETECTED")).toBe(true);
    expect(compiled.errorCode).toBe("INVALID_DEPENDENCY");
  });

  // TEST 6 — Unauthorized Capability Preflight Rejection
  it("Test 6 — Tool requiring unavailable capability is rejected before persistence", async () => {
    const candidate: CandidatePlan = {
      goal: "Execute privileged action",
      nodes: [
        {
          id: "step_privileged",
          title: "Delete session records",
          type: "tool_call",
          actionSpec: { toolName: "delete_user_session", parameters: {} },
          approval: { status: "pending", reason: "Gated" },
        },
      ],
    };

    // User only has "read_research", lacks "admin_session"
    const result = await planner.plan(
      {
        requestId: "req_unauth_006",
        telegramUserId: 1001,
        goal: candidate.goal,
        context: { capabilities: ["read_research"] },
        toolRegistry: registry,
      },
      candidate,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_TOOL_CAPABILITY");
    expect(
      result.diagnostics.some((d) => d.code === "UNAUTHORIZED_TOOL_CAPABILITY"),
    ).toBe(true);

    // Verify nothing was persisted
    const stored = await persistence.getGraph("plan_unauth_test");
    expect(stored).toBeNull();
  });

  // TEST 7 — Destructive Tool without Approval Requirement
  it("Test 7 — Attempting a destructive tool without approval produces approval rejection", async () => {
    const candidate: CandidatePlan = {
      goal: "Delete sessions without confirmation gate",
      nodes: [
        {
          id: "step_wipe",
          title: "Wipe user records",
          type: "tool_call",
          actionSpec: { toolName: "delete_user_session", parameters: {} },
          approval: { status: "not_required" }, // Model claims no approval needed!
        },
      ],
    };

    const result = await planner.plan(
      {
        requestId: "req_destruct_007",
        telegramUserId: 1001,
        goal: candidate.goal,
        context: { capabilities: ["admin_session"] },
        toolRegistry: registry,
      },
      candidate,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("APPROVAL_REQUIRED");
    expect(
      result.diagnostics.some((d) => d.code === "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE"),
    ).toBe(true);
  });

  // TEST 8 — Model Lies about Tool Safety (Registry Must Win)
  it("Test 8 — Model claims destructive tool is safe; Tool Registry policy strictly wins", () => {
    const candidate: CandidatePlan = {
      goal: "Deceptive plan claiming tool is safe",
      nodes: [
        {
          id: "step_wipe",
          title: "Delete database table",
          type: "tool_call",
          actionSpec: { toolName: "delete_user_session", parameters: {} },
          approval: {
            status: "not_required", // Model falsely claims no confirmation needed
            reason: "Safe non-destructive query",
          },
        },
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_liar_008",
      telegramUserId: 1001,
      graphId: "plan_deceptive_test",
      toolRegistry: registry,
      userCapabilities: ["admin_session"],
    });

    expect(compiled.success).toBe(false);
    // Model claim is rejected, registry policy wins
    expect(
      compiled.diagnostics.some(
        (d) => d.code === "DESTRUCTIVE_TOOL_MISSING_APPROVAL_GATE",
      ),
    ).toBe(true);
  });

  // TEST 9 — Invalid Input Binding to Future / Unrelated Node
  it("Test 9 — Input binding referencing a future downstream node is rejected", () => {
    const candidate: CandidatePlan = {
      goal: "Forward binding violation",
      nodes: [
        {
          id: "step_first",
          title: "First step",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "First step reasoning" },
          inputBindings: {
            // step_first references future step_second!
            futureData: {
              source: { type: "node_output", nodeId: "step_second", path: "summary" },
            },
          },
        },
        {
          id: "step_second",
          title: "Second step",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Second step reasoning" },
          dependsOn: ["step_first"],
        },
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_future_009",
      telegramUserId: 1001,
      graphId: "plan_future_bind_test",
    });

    expect(compiled.success).toBe(false);
    expect(
      compiled.diagnostics.some((d) => d.code === "BINDING_SOURCE_NOT_ANCESTOR"),
    ).toBe(true);
    expect(compiled.errorCode).toBe("INVALID_INPUT_BINDING");
  });

  // TEST 10 — Replanning & Immutable Revision Chains
  it("Test 10 — Replanning generates revision 2 with parent link while revision 1 remains immutable", async () => {
    // 1. Create and persist revision 1
    const initialPlanResult = await planner.plan({
      requestId: "req_plan_010",
      telegramUserId: 1001,
      graphId: "plan_immutable_chain_010",
      goal: "Execute initial research",
      context: { capabilities: ["read_research"] },
      toolRegistry: registry,
    });

    expect(initialPlanResult.success).toBe(true);
    const rev1 = initialPlanResult.graph!;
    expect(rev1.planRevision).toBe(1);
    expect(rev1.revisionId).toBe("plan_immutable_chain_010:r1");

    // 2. Perform replan generating revision 2
    const replanResult = await planner.replan({
      requestId: "req_replan_010",
      telegramUserId: 1001,
      previousGraphId: "plan_immutable_chain_010",
      previousRevision: 1,
      replanReason: "Upstream literature service returned empty findings",
      failedNodeId: "step_1_direct_response",
      context: { capabilities: ["read_research"] },
      toolRegistry: registry,
    });

    expect(replanResult.success).toBe(true);
    const rev2 = replanResult.graph!;
    expect(rev2.planRevision).toBe(2);
    expect(rev2.revisionId).toBe("plan_immutable_chain_010:r2");
    expect(rev2.parentRevisionId).toBe("plan_immutable_chain_010:r1");

    // 3. Confirm revision 1 was NOT mutated
    const fetchedRev1 = await persistence.getGraph("plan_immutable_chain_010", 1);
    expect(fetchedRev1).toBeDefined();
    expect(fetchedRev1!.planRevision).toBe(1);
    expect(fetchedRev1!.revisionId).toBe("plan_immutable_chain_010:r1");
    expect(fetchedRev1!.parentRevisionId).toBeUndefined();

    // 4. Overwrite attempt on revision 1 throws error
    await expect(persistence.saveGraph(rev1)).rejects.toThrow(
      /plan revisions are strictly immutable/,
    );
  });

  // TEST 11 — Idempotent Compilation
  it("Test 11 — Compiling the same normalized candidate twice yields equivalent structures", () => {
    const candidate: CandidatePlan = {
      graphId: "plan_idempotent_011",
      goal: "Analyze environmental sustainability factors",
      nodes: [
        {
          id: "step_research",
          title: "Fetch sustainability metrics",
          type: "tool_call",
          actionSpec: { toolName: "fetch_topic_research", parameters: { topic: "energy" } },
        },
        {
          id: "step_synthesize",
          title: "Synthesize report",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Synthesize report" },
          dependsOn: ["step_research"],
        },
      ],
    };

    const compilerContext = {
      telegramUserId: 1001,
      requestId: "req_idem_011",
      graphId: "plan_idempotent_011",
      planRevision: 1,
      timestamp: "2026-09-08T12:00:00Z",
      toolRegistry: registry,
      userCapabilities: ["read_research"],
    };

    const run1 = PlannerCompiler.compile(candidate, compilerContext);
    const run2 = PlannerCompiler.compile(candidate, compilerContext);

    expect(run1.success).toBe(true);
    expect(run2.success).toBe(true);
    expect(run1.graph).toEqual(run2.graph);
    expect(run1.topologicalOrder).toEqual(run2.topologicalOrder);
  });

  // TEST 12 — Graph Size Limit Enforcement
  it("Test 12 — Oversized candidate graph exceeding MAX_GRAPH_NODES is rejected", () => {
    const nodes: CandidateNode[] = [];
    for (let i = 0; i < MAX_GRAPH_NODES + 5; i++) {
      nodes.push({
        id: `step_${i}`,
        title: `Action step ${i}`,
        type: "llm_reasoning",
        reasoningSpec: { prompt: `Reason step ${i}` },
      });
    }

    const candidate: CandidatePlan = {
      goal: "Excessive node flood",
      nodes,
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_oversized_012",
      telegramUserId: 1001,
      graphId: "plan_oversized_test",
    });

    expect(compiled.success).toBe(false);
    expect(compiled.diagnostics.some((d) => d.code === "GRAPH_SIZE_EXCEEDED")).toBe(true);
  });

  // TEST 13 — Invalid Retry Policy & Timeouts Bounded
  it("Test 13 — Unbounded retries and timeouts out of bounds are rejected", () => {
    const candidate: CandidatePlan = {
      goal: "Test unbounded retries",
      nodes: [
        {
          id: "step_bad_retry",
          title: "Step with invalid retry limits",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Reason" },
          retryPolicy: { maxAttempts: 99 }, // Exceeds MAX_NODE_RETRIES (5)
          timeoutMs: 10, // Below MIN_NODE_TIMEOUT_MS (100)
        },
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_bounds_013",
      telegramUserId: 1001,
      graphId: "plan_bounds_test",
    });

    expect(compiled.success).toBe(false);
    expect(compiled.diagnostics.some((d) => d.code === "INVALID_RETRY_POLICY")).toBe(true);
    expect(compiled.diagnostics.some((d) => d.code === "INVALID_TIMEOUT")).toBe(true);
  });

  // TEST 14 — Pure Reasoning Boundary
  it("Test 14 — llm_reasoning cannot specify external actionSpec", () => {
    const candidate: CandidatePlan = {
      goal: "Pure reasoning boundary test",
      nodes: [
        {
          id: "step_hybrid_forbidden",
          title: "Attempted hybrid reasoning with tool call",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Reason about data" },
          actionSpec: {
            toolName: "fetch_topic_research",
            parameters: {},
          },
        },
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_pure_014",
      telegramUserId: 1001,
      graphId: "plan_pure_test",
    });

    expect(compiled.success).toBe(false);
    expect(
      compiled.diagnostics.some(
        (d) => d.code === "LLM_REASONING_CANNOT_HAVE_TOOL_ACTION",
      ),
    ).toBe(true);
  });

  // TEST 15 — Approval Lifecycle Semantics
  it("Test 15 — Approval lifecycle (pending, approved, denied, expired) governs execution readiness", () => {
    // 1. Pending approval -> canExecuteNode: false, isExecutionReady: false
    const pendingNode = {
      id: "node_destruct",
      title: "Delete table",
      type: "tool_call" as const,
      actionSpec: { toolName: "delete_user_session", parameters: {} },
      inputBindings: {},
      status: "pending" as const,
      approval: { status: "pending" as const, reason: "Gated" },
      verification: { required: false, strategy: "none" as const },
      retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
      timeoutMs: 30000,
    };

    expect(GraphValidator.canExecuteNode(pendingNode)).toBe(false);

    // 2. Denied approval -> canExecuteNode: false
    const deniedNode = {
      ...pendingNode,
      approval: { status: "denied" as const, reason: "Rejected by human operator" },
    };
    expect(GraphValidator.canExecuteNode(deniedNode)).toBe(false);

    // 3. Expired approval -> canExecuteNode: false
    const expiredNode = {
      ...pendingNode,
      approval: { status: "expired" as const, reason: "Approval window timed out" },
    };
    expect(GraphValidator.canExecuteNode(expiredNode)).toBe(false);

    // 4. Approved -> canExecuteNode: true
    const approvedNode = {
      ...pendingNode,
      approval: { status: "approved" as const, reason: "Confirmed by authorized admin" },
    };
    expect(GraphValidator.canExecuteNode(approvedNode)).toBe(true);
  });

  // TEST 16 — Reachability & Disconnected Node Detection
  it("Test 16 — Disconnected isolated node is detected and rejected", () => {
    const candidate: CandidatePlan = {
      goal: "Plan with disconnected orphan node",
      nodes: [
        { id: "node_entry", title: "Entry", type: "llm_reasoning", reasoningSpec: { prompt: "Entry" } },
        { id: "node_exit", title: "Exit", type: "llm_reasoning", reasoningSpec: { prompt: "Exit" }, dependsOn: ["node_entry"] },
        { id: "orphan_isolated", title: "Orphan", type: "llm_reasoning", reasoningSpec: { prompt: "Orphan" } }, // 0 edges
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_reach_016",
      telegramUserId: 1001,
      graphId: "plan_reach_test",
    });

    expect(compiled.success).toBe(false);
    expect(
      compiled.diagnostics.some((d) => d.code === "UNREACHABLE_NODE_DETECTED"),
    ).toBe(true);
  });

  // TEST 17 — Sink & Source Node Validation
  it("Test 17 — Graph without valid source or sink is rejected", () => {
    // Pure cycle has no source and no terminal sink
    const cyclicGraph: ExecutionGraph = {
      schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION,
      graphId: "plan_nosink_test",
      planRevision: 1,
      revisionId: "plan_nosink_test:r1",
      telegramUserId: 1001,
      goal: "Cycle with no entry/exit",
      status: "ready",
      nodes: {
        node_1: {
          id: "node_1",
          title: "Node 1",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Prompt 1" },
          inputBindings: {},
          status: "pending",
          approval: { status: "not_required", reason: "none" },
          verification: { required: false, strategy: "none" },
          retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
          timeoutMs: 10000,
        },
        node_2: {
          id: "node_2",
          title: "Node 2",
          type: "llm_reasoning",
          reasoningSpec: { prompt: "Prompt 2" },
          inputBindings: {},
          status: "pending",
          approval: { status: "not_required", reason: "none" },
          verification: { required: false, strategy: "none" },
          retryPolicy: { maxAttempts: 1, backoffMs: 1000 },
          timeoutMs: 10000,
        },
      },
      edges: [
        { fromNodeId: "node_1", toNodeId: "node_2", dependencyType: "hard" },
        { fromNodeId: "node_2", toNodeId: "node_1", dependencyType: "hard" },
      ],
      metadata: {
        derivedStepCount: 2,
        requiresApproval: false,
        createdAt: "2026-09-08T12:00:00Z",
        updatedAt: "2026-09-08T12:00:00Z",
      },
    };

    const validation = GraphValidator.validate(cyclicGraph);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some(
        (e) => e.code === "NO_SOURCE_NODE" || e.code === "NO_TERMINAL_NODE" || e.code === "CYCLE_DETECTED",
      ),
    ).toBe(true);
  });

  // TEST 18 — Metadata Derivation (Application Derived rather than Blindly Trusted)
  it("Test 18 — Graph metadata (step count, approval) is derived authoritatively by application", () => {
    const candidate: CandidatePlan = {
      goal: "Check metadata derivation",
      advisoryEstimatedSteps: 42, // Model claims 42 steps
      advisoryRequiresApproval: false, // Model claims no approval needed
      nodes: [
        {
          id: "step_destruct",
          title: "Delete user sessions",
          type: "tool_call",
          actionSpec: { toolName: "delete_user_session", parameters: {} },
          approval: { status: "pending", reason: "Gated action" },
        },
      ],
    };

    const compiled = PlannerCompiler.compile(candidate, {
      requestId: "req_meta_018",
      telegramUserId: 1001,
      graphId: "plan_meta_test",
      toolRegistry: registry,
      userCapabilities: ["admin_session"],
    });

    expect(compiled.success).toBe(true);
    const graph = compiled.graph!;

    // Derived step count must be actual node count (1), NOT model's claim (42)
    expect(graph.metadata.derivedStepCount).toBe(1);
    expect(graph.metadata.advisoryEstimatedSteps).toBe(42);

    // requiresApproval must be derived as TRUE due to destructive tool
    expect(graph.metadata.requiresApproval).toBe(true);
    expect(graph.status).toBe("paused_for_approval");
  });
});
