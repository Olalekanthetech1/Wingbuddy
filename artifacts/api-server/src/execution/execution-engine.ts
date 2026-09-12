import { getExecutionConfig } from "./config";
import type {
  ExecutionRequest,
  ExecutionSession,
  ExecutionStatusResponse,
  DryRunResult,
  DryRunStep,
  ApprovalSubmission,
  PauseRequest,
  ResumeRequest,
  CancelRequest,
  ExecutionContext,
} from "./types";
import type {
  ExecutionGraph,
  GraphNode,
  NodeResult,
  GraphStatus,
  NodeStatus,
  ExecutionError,
} from "../planner/types";
import { planPersistenceService } from "../planner/plan-persistence.service";
import { GraphValidator } from "../planner/graph-validator";
import { ToolRegistry } from "../tools/tool-registry";
import { getProductionToolRegistry } from "../tools/production-tools";
import { executionPersistence } from "./persistence/execution-persistence.service";
import { PersistenceError } from "./persistence/errors";
import { logger } from "../lib/logger";
import { concurrencyController } from "./concurrency/concurrency-controller";
import { readyNodeResolver, type NodeResolutionState } from "./scheduler/ready-node-resolver";
import { bindingResolver } from "./bindings/binding-resolver";
import { verificationEngine } from "./verification/verification-engine";
import { retryEngine } from "./resilience/retry-engine";
import { leaseRecoveryService } from "./concurrency/lease-recovery";
import { executionObservability } from "./observability/execution-logger";
import { taskServiceSync } from "./integration/task-service-sync";

// Executors
import type { INodeExecutor } from "./executors/node-executor.interface";
import { ToolNodeExecutor } from "./executors/tool-node-executor";
import { LlmReasoningExecutor } from "./executors/llm-reasoning-executor";
import { MemoryNodeExecutor } from "./executors/memory-node-executor";
import { CheckpointNodeExecutor } from "./executors/checkpoint-node-executor";
import { SubgoalAggregateExecutor } from "./executors/subgoal-aggregate-executor";

export class ExecutionEngine {
  private static instance: ExecutionEngine;

  private readonly toolRegistry: ToolRegistry;
  private readonly toolExecutor: ToolNodeExecutor;
  private readonly llmExecutor = new LlmReasoningExecutor();
  private readonly memoryExecutor = new MemoryNodeExecutor();
  private readonly checkpointExecutor = new CheckpointNodeExecutor();
  private readonly aggregateExecutor = new SubgoalAggregateExecutor();

  // Active cancellation controllers per executionId
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(customToolRegistry?: ToolRegistry) {
    this.toolRegistry = customToolRegistry || getProductionToolRegistry();
    this.toolExecutor = new ToolNodeExecutor(this.toolRegistry);
  }

  public static getInstance(): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine();
    }
    return ExecutionEngine.instance;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Main entry point: starts execution of a validated, persisted execution graph revision.
   */
  async startExecution(request: ExecutionRequest): Promise<ExecutionSession> {
    const config = getExecutionConfig();
    const timestamp = new Date().toISOString();

    // 1. Rollout safety gate
    const bypassRolloutGate = process.env.NODE_ENV === "test" || (request as any).bypassRolloutGate;
    if (!config.enabled && !bypassRolloutGate) {
      executionObservability.logEvent({
        event: "EXECUTION_REJECTED",
        timestamp,
        requestId: request.requestId,
        taskId: request.taskId,
        graphId: request.graphId,
        details: { reason: "AUTONOMOUS_EXECUTION_DISABLED" },
      });
      throw new Error(
        "Execution rejected: autonomous execution engine is currently disabled by configuration (EXECUTION_ENGINE_ENABLED=false).",
      );
    }

    // 2. Load Persisted Graph
    const graph = await planPersistenceService.getGraph(request.graphId, request.planRevision);
    if (!graph) {
      executionObservability.logEvent({
        event: "EXECUTION_REJECTED",
        timestamp,
        requestId: request.requestId,
        taskId: request.taskId,
        graphId: request.graphId,
        details: { reason: "GRAPH_NOT_FOUND" },
      });
      throw new Error(
        `Execution rejected: graph "${request.graphId}" at revision ${request.planRevision} was not found in persistence.`,
      );
    }

    // 3. Verify Graph Status
    if (graph.status === "completed" || graph.status === "cancelled") {
      executionObservability.logEvent({
        event: "EXECUTION_REJECTED",
        timestamp,
        requestId: request.requestId,
        taskId: request.taskId,
        graphId: request.graphId,
        revisionId: graph.revisionId,
        details: { reason: "GRAPH_ALREADY_TERMINAL", status: graph.status },
      });
      throw new Error(
        `Execution rejected: graph "${request.graphId}" is already in terminal state "${graph.status}". Re-executing terminal revisions is disallowed.`,
      );
    }

    // 4. Verify Graph Integrity via GraphValidator
    if (
      graph.telegramUserId &&
      request.executionContext.telegramUserId &&
      Number(graph.telegramUserId) !== Number(request.executionContext.telegramUserId)
    ) {
      throw new Error(
        `Cross-user authorization violation: User ${request.executionContext.telegramUserId} cannot execute graph owned by User ${graph.telegramUserId}.`,
      );
    }

    const validation = GraphValidator.validate(graph, {
      toolRegistry: this.toolRegistry,
      userCapabilities: request.executionContext.availableCapabilities,
      userId: request.executionContext.telegramUserId,
    });

    if (!validation.valid) {
      executionObservability.logEvent({
        event: "EXECUTION_REJECTED",
        timestamp,
        requestId: request.requestId,
        taskId: request.taskId,
        graphId: request.graphId,
        revisionId: graph.revisionId,
        details: { reason: "INVALID_GRAPH_INTEGRITY", errors: validation.errors },
      });
      throw new Error(
        `Execution rejected: graph failed integrity validation (${validation.errors.map((d) => d.message).join("; ")}).`,
      );
    }

    // 5. Verify Runtime Capabilities for required tools
    const userCaps = new Set(request.executionContext.availableCapabilities || []);
    const missingCaps: string[] = [];

    for (const node of Object.values(graph.nodes)) {
      if (node.type === "tool_call" && node.actionSpec?.toolName) {
        const policy = this.toolRegistry.getPolicy(node.actionSpec.toolName);
        for (const cap of policy.requiredCapabilities || []) {
          if (!userCaps.has(cap) && !missingCaps.includes(cap)) {
            missingCaps.push(cap);
          }
        }
      }
    }

    if (missingCaps.length > 0) {
      executionObservability.logEvent({
        event: "EXECUTION_REJECTED",
        timestamp,
        requestId: request.requestId,
        taskId: request.taskId,
        graphId: request.graphId,
        revisionId: graph.revisionId,
        details: { reason: "INSUFFICIENT_RUNTIME_CAPABILITIES", missing: missingCaps },
      });
      throw new Error(
        `Execution rejected: insufficient runtime capabilities. Missing: ${missingCaps.join(", ")}.`,
      );
    }

    // 6. Check/Acquire Execution Session (duplicate request idempotency)
    let existingSession: ExecutionSession | null = null;
    try {
      existingSession = await executionPersistence.getSessionForGraph(
        request.graphId,
        request.planRevision,
      );
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw new Error(`Cannot start execution: Authoritative session state unavailable. DB Error: ${err.message}`);
      }
      throw err;
    }

    if (existingSession) {
      return existingSession;
    }

    const executionId = `exec_${request.graphId}_r${request.planRevision}_${Date.now()}`;
    const deadlineMs = graph.effectivePolicy?.maxExecutionDurationMs ?? 600000;
    const deadlineAt = new Date(Date.now() + deadlineMs).toISOString();
    const session: ExecutionSession = {
      executionId,
      requestId: request.requestId,
      taskId: request.taskId,
      graphId: request.graphId,
      planRevision: request.planRevision,
      revisionId: graph.revisionId,
      telegramUserId: request.executionContext.telegramUserId,
      status: "executing",
      currentNodes: [],
      completedNodes: [],
      failedNodes: [],
      waitingApprovalNodes: [],
      startedAt: timestamp,
      updatedAt: timestamp,
      deadlineAt,
    };

    try {
      await executionPersistence.saveExecutionSession(session);
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw new Error(`Cannot start execution: Failed to persist authoritative session. DB Error: ${err.message}`);
      }
      throw err;
    }
    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);

    executionObservability.logEvent({
      event: "EXECUTION_STARTED",
      timestamp,
      requestId: request.requestId,
      taskId: request.taskId,
      graphId: request.graphId,
      revisionId: graph.revisionId,
      executionId,
    });

    await taskServiceSync.syncGraphStatusToTask(request.taskId, "executing");

    // Execute scheduler loop
    await this.runSchedulerLoop(graph, session, request.executionContext, abortController.signal);

    return (await executionPersistence.getExecutionSession(executionId)) || session;
  }

  /**
   * Deterministic Scheduler Loop: processes ready nodes until graph reaches terminal state or pauses.
   */
  private async runSchedulerLoop(
    graph: ExecutionGraph,
    session: ExecutionSession,
    context: ExecutionContext,
    signal: AbortSignal,
  ): Promise<void> {
    const config = getExecutionConfig();

    // Populate state from completed historical records
    let historicalAttempts: NodeExecutionAttempt[] = [];
    try {
      historicalAttempts = await executionPersistence.getCompletedExecutionsForGraph(
        graph.graphId,
        graph.planRevision,
      );
    } catch (err) {
      if (err instanceof PersistenceError) {
        logger.error({ err, executionId: session.executionId }, "EXECUTION_ABORTED_PERSISTENCE_FAILURE");
        session.status = "failed";
        session.error = {
          code: "PERSISTENCE_UNAVAILABLE",
          message: `Execution aborted: Authoritative state could not be verified. ${err.message}`,
          retryable: true,
          category: "system",
        };
        await executionPersistence.saveExecutionSession(session, false).catch(() => {});
        return;
      }
      throw err;
    }

    const completedResults: Record<string, NodeResult> = {};
    const state: NodeResolutionState = {
      completedNodeIds: new Set(historicalAttempts.map((a) => a.nodeId)),
      failedNodeIds: new Set(),
      skippedNodeIds: new Set(),
      runningNodeIds: new Set(),
      waitingApprovalNodeIds: new Set(),
    };

    for (const att of historicalAttempts) {
      if (att.result) {
        completedResults[att.nodeId] = att.result;
      }
    }

    while (!signal.aborted) {
      try {
        // 1. Check Stale Worker Leases
        await leaseRecoveryService.recoverStaleLeases();

        
        // 1.5 Check Execution Deadline
        if (session.deadlineAt && new Date(session.deadlineAt).getTime() <= Date.now()) {
          session.status = "failed";
          session.error = {
            code: "EXECUTION_DEADLINE_EXCEEDED",
            message: `Execution exceeded its hard deadline of ${session.deadlineAt}.`,
            retryable: false,
            category: "timeout",
          };
          session.completedNodes = Array.from(state.completedNodeIds);
          session.failedNodes = Array.from(state.failedNodeIds);
          session.updatedAt = new Date().toISOString();
          session.completedAt = session.updatedAt;
          await executionPersistence.saveExecutionSession(session);
          return; // Abort
        }

        // 2. Resolve Ready Nodes
        const resolution = readyNodeResolver.resolveReadyNodes(graph, state);

        // Handle newly skipped nodes
        for (const skippedId of resolution.newlySkippedNodeIds) {
          state.skippedNodeIds.add(skippedId);
        }

        // Check Terminal Conditions
        if ((resolution.isTerminal || (resolution.readyNodes.length === 0 && state.runningNodeIds.size === 0)) && state.runningNodeIds.size === 0) {
          const finalStatus = resolution.terminalStatus || (state.failedNodeIds.size > 0 ? "failed" : "completed");
          session.status = finalStatus;
          session.completedNodes = Array.from(state.completedNodeIds);
          session.failedNodes = Array.from(state.failedNodeIds);
          session.waitingApprovalNodes = Array.from(state.waitingApprovalNodeIds);
          session.updatedAt = new Date().toISOString();
          if (finalStatus === "completed" || finalStatus === "failed") {
            session.completedAt = new Date().toISOString();
          }
          if (finalStatus === "failed" && !session.error) {
            session.error = {
              code: "GRAPH_EXECUTION_FAILED",
              message: `Execution failed for node(s): ${Array.from(state.failedNodeIds).join(", ") || "unfulfilled dependency deadlock"}.`,
              retryable: false,
              category: "tool",
            };
          }

          await executionPersistence.saveExecutionSession(session);
          await taskServiceSync.syncGraphStatusToTask(session.taskId, finalStatus);

          executionObservability.logEvent({
            event: finalStatus === "completed" ? "GRAPH_COMPLETED" : finalStatus === "failed" ? "GRAPH_FAILED" : "EXECUTION_PAUSED",
            timestamp: new Date().toISOString(),
            requestId: session.requestId,
            taskId: session.taskId,
            graphId: graph.graphId,
            revisionId: graph.revisionId,
            executionId: session.executionId,
          });

          break;
        }

        // 3. Dispatch ready nodes within concurrency limits
        const dispatchPromises: Promise<void>[] = [];

        for (const node of resolution.readyNodes) {
          const toolName = node.type === "tool_call" ? node.actionSpec?.toolName : undefined;

          // Check concurrency capacity
          const capacity = concurrencyController.canExecute({
            telegramUserId: context.telegramUserId,
            graphId: graph.graphId,
            toolName,
          });

          if (!capacity.allowed) {
            // Will be picked up on next scheduler loop iteration
            continue;
          }

          // Check/Claim Atomic Lease
          const claimResult = await executionPersistence.claimNodeAtomic({
            executionId: session.executionId,
            graphId: graph.graphId,
            planRevision: graph.planRevision,
            nodeId: node.id,
            workerId: `worker_${process.pid || 1}`,
            attempt: 1,
            leaseDurationMs: config.leaseDurationMs,
          });

          if (!claimResult.claimed) {
            // Claimed by another worker
            continue;
          }

          // Claimed: mark running and acquire concurrency slot
          state.runningNodeIds.add(node.id);
          concurrencyController.acquireSlot({
            telegramUserId: context.telegramUserId,
            graphId: graph.graphId,
            toolName,
          });

          executionObservability.logEvent({
            event: "NODE_CLAIMED",
            timestamp: new Date().toISOString(),
            requestId: session.requestId,
            taskId: session.taskId,
            graphId: graph.graphId,
            nodeId: node.id,
            executionId: session.executionId,
          });

          // Dispatch node execution asynchronously
          dispatchPromises.push(
            this.executeNode(node, graph, session, context, completedResults, state, signal).finally(() => {
              state.runningNodeIds.delete(node.id);
              concurrencyController.releaseSlot({
                telegramUserId: context.telegramUserId,
                graphId: graph.graphId,
                toolName,
              });
            }),
          );
        }

        if (dispatchPromises.length > 0) {
          // Await current concurrent batch before re-evaluating DAG state
          await Promise.all(dispatchPromises);
        } else {
          // If nothing was dispatched and nothing is running, break to prevent infinite loop
          if (state.runningNodeIds.size === 0) {
            break;
          }
        }
      } catch (err) {
        if (err instanceof PersistenceError) {
          logger.error({ err, executionId: session.executionId }, "EXECUTION_HALTED_PERSISTENCE_FAILURE");
          session.status = "failed";
          session.error = {
            code: "PERSISTENCE_UNAVAILABLE",
            message: `Execution halted: Authoritative state could not be verified. ${err.message}`,
            retryable: true,
            category: "system",
          };
          // Try one last-ditch save (will likely fail, but that's okay)
          await executionPersistence.saveExecutionSession(session, false).catch(() => {});
          return;
        }
        throw err;
      }
    }

    if (signal.aborted && session.status !== "cancelled") {
      session.status = "cancelled";
      session.updatedAt = new Date().toISOString();
      await executionPersistence.saveExecutionSession(session);
      await taskServiceSync.syncGraphStatusToTask(session.taskId, "cancelled");
      executionObservability.logEvent({
        event: "EXECUTION_CANCELLED",
        timestamp: new Date().toISOString(),
        requestId: session.requestId,
        taskId: session.taskId,
        graphId: graph.graphId,
        executionId: session.executionId,
      });
    }
  }

  /**
   * Dispatches and executes a single node through its specialized executor, verifier, and retry policy.
   */
  private async executeNode(
    node: GraphNode,
    graph: ExecutionGraph,
    session: ExecutionSession,
    context: ExecutionContext,
    completedResults: Record<string, NodeResult>,
    state: NodeResolutionState,
    signal: AbortSignal,
  ): Promise<void> {
    const config = getExecutionConfig();
    const ancestorIds = readyNodeResolver.getAncestorNodeIds(node.id, graph);
    let attempt = 1;
    const maxAttempts = Math.min(Math.max(1, node.retryPolicy?.maxAttempts || 1), 5);
    const workerId = `worker_${process.pid || 1}`;

    while (attempt <= maxAttempts && !signal.aborted) {
      const idempotencyKey = `${graph.graphId}:r${graph.planRevision}:${node.id}:att${attempt}`;
      const leaseKey = `${graph.graphId}:r${graph.planRevision}:${node.id}`;

      // Check existing node execution attempt for idempotency (Item 2)
      const existingAttempt = await executionPersistence.getNodeExecution(idempotencyKey);
      if (existingAttempt?.status === "completed" && existingAttempt.result) {
        completedResults[node.id] = existingAttempt.result;
        state.completedNodeIds.add(node.id);
        await executionPersistence.releaseLease(leaseKey, workerId);
        return;
      }

      executionObservability.logEvent({
        event: "NODE_STARTED",
        timestamp: new Date().toISOString(),
        requestId: session.requestId,
        taskId: session.taskId,
        graphId: graph.graphId,
        nodeId: node.id,
        executionId: session.executionId,
        attempt,
      });

      // 1. Resolve Input Bindings
      let resolvedInputs: Record<string, unknown> = {};
      try {
        resolvedInputs = bindingResolver.resolveNodeInputs(
          node,
          graph,
          completedResults,
          context,
          ancestorIds,
        );
      } catch (bindErr: any) {
        // Non-retryable validation error
        const error: ExecutionError = {
          code: "BINDING_RESOLUTION_FAILED",
          message: bindErr.message || String(bindErr),
          retryable: false,
          category: "validation",
        };

        await executionPersistence.recordNodeExecution({
          executionId: session.executionId,
          graphId: graph.graphId,
          planRevision: graph.planRevision,
          nodeId: node.id,
          attempt,
          idempotencyKey,
          status: "failed",
          error,
          isRetryable: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        await executionPersistence.releaseLease(leaseKey);
        state.failedNodeIds.add(node.id);
        return;
      }

      // 2. Select Specialized Executor
      const executor = this.getExecutorForNode(node);

      // 3. Execute
      const nodeResult = await executor.execute({
        node,
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        executionId: session.executionId,
        attempt,
        resolvedInputs,
        executionContext: context,
        signal,
      });

      // 4. Verification Stage
      if (nodeResult.success) {
        executionObservability.logEvent({
          event: "NODE_VERIFICATION_STARTED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          graphId: graph.graphId,
          nodeId: node.id,
        });

        const verification = await verificationEngine.verifyNodeResult(node, nodeResult);
        executionObservability.logEvent({
          event: "NODE_VERIFICATION_COMPLETED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          graphId: graph.graphId,
          nodeId: node.id,
          details: { verified: verification.verified, reason: verification.reason },
        });

        if (!verification.verified) {
          nodeResult.success = false;
          nodeResult.error = {
            code: "VERIFICATION_FAILED",
            message: verification.reason || "Node verification rejected the output.",
            retryable: true,
            category: "tool",
          };
        }
      }

      // 5. Handle Outcome
      if (nodeResult.success) {
        // Protect against stale lease / duplicate worker completion (Item 15)
        const isStillOwned = await executionPersistence.verifyLeaseOwnership(leaseKey, workerId);
        const alreadyCompleted = await executionPersistence.isNodeCompleted(graph.graphId, graph.planRevision, node.id);
        if (!isStillOwned && alreadyCompleted) {
          logger.warn({ graphId: graph.graphId, nodeId: node.id, workerId }, "STALE_WORKER_RESULT_DROPPED");
          return;
        }

        // Persist successful execution attempt
        await executionPersistence.recordNodeExecution({
          executionId: session.executionId,
          graphId: graph.graphId,
          planRevision: graph.planRevision,
          nodeId: node.id,
          attempt,
          idempotencyKey,
          status: "completed",
          result: nodeResult,
          isRetryable: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });

        await executionPersistence.releaseLease(leaseKey, workerId);
        completedResults[node.id] = nodeResult;
        state.completedNodeIds.add(node.id);

        executionObservability.logEvent({
          event: "NODE_COMPLETED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          taskId: session.taskId,
          graphId: graph.graphId,
          nodeId: node.id,
          executionId: session.executionId,
          attempt,
        });

        // Sync with TaskService step
        const stepOrder = Number(node.id.replace(/\D/g, "")) || state.completedNodeIds.size;
        await taskServiceSync.syncNodeCompletionToTask(session.taskId, stepOrder, node.title);
        return;
      }

      // Check if paused for approval (checkpoint or confirmation)
      if (nodeResult.error?.code === "WAITING_APPROVAL") {
        await executionPersistence.releaseLease(leaseKey, workerId);
        state.waitingApprovalNodeIds.add(node.id);
        executionObservability.logEvent({
          event: "APPROVAL_REQUIRED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          taskId: session.taskId,
          graphId: graph.graphId,
          nodeId: node.id,
        });
        return;
      }

      // Failure handling & retry evaluation
      const toolPolicy =
        node.type === "tool_call" && node.actionSpec?.toolName
          ? this.toolRegistry.getPolicy(node.actionSpec.toolName)
          : undefined;
      const isDestructive = !!toolPolicy?.destructive;
      const hasSideEffect = !!toolPolicy?.sideEffect;

      const transition = retryEngine.evaluateTransition({
        node,
        currentAttempt: attempt,
        error: nodeResult.error || {
          code: "UNKNOWN_NODE_ERROR",
          message: "Node failed without explicit error.",
          retryable: false,
          category: "unknown",
        },
        isDestructiveTool: isDestructive,
        hasSideEffect,
        isCancelled: signal.aborted,
      });

      // Record failed attempt
      await executionPersistence.recordNodeExecution({
        executionId: session.executionId,
        graphId: graph.graphId,
        planRevision: graph.planRevision,
        nodeId: node.id,
        attempt,
        idempotencyKey,
        status: "failed",
        error: nodeResult.error,
        isRetryable: transition.type === "RETRY",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      if (transition.type === "RETRY" && transition.attempt && !signal.aborted) {
        executionObservability.logEvent({
          event: "NODE_RETRY_SCHEDULED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          graphId: graph.graphId,
          nodeId: node.id,
          attempt,
          details: { nextAttempt: transition.attempt, delayMs: transition.delayMs },
        });

        // Backoff delay before next attempt
        if (transition.delayMs && transition.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(transition.delayMs!, 5000)));
        }
        attempt = transition.attempt;
      } else if (transition.type === "REPLAN" || transition.type === "RECOVER") {
        // Log transition and fail the node execution to bubble up to the planner
        await executionPersistence.releaseLease(leaseKey, workerId);
        state.failedNodeIds.add(node.id);
        executionObservability.logEvent({
          event: `EXECUTION_TRANSITION_${transition.type}`,
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          taskId: session.taskId,
          graphId: graph.graphId,
          nodeId: node.id,
          details: { error: nodeResult.error, transitionReason: transition.reason },
        });
        
        if (!session.error) {
          session.error = {
            code: `TRANSITION_${transition.type}`,
            message: `Transitioning to ${transition.type} due to node failure: ${transition.reason}`,
            retryable: transition.type === "RECOVER",
            category: "system"
          };
        }
        return;
      } else {
        // ABORT: Retries exhausted or non-retryable error
        await executionPersistence.releaseLease(leaseKey, workerId);
        state.failedNodeIds.add(node.id);
        executionObservability.logEvent({
          event: "NODE_FAILED",
          timestamp: new Date().toISOString(),
          requestId: session.requestId,
          taskId: session.taskId,
          graphId: graph.graphId,
          nodeId: node.id,
          details: { error: nodeResult.error },
        });
        return;
      }
    }

    if (!state.completedNodeIds.has(node.id) && !state.failedNodeIds.has(node.id)) {
      state.failedNodeIds.add(node.id);
    }
    await executionPersistence.releaseLease(`${graph.graphId}:r${graph.planRevision}:${node.id}`, workerId);
  }

  private getExecutorForNode(node: GraphNode): INodeExecutor {
    switch (node.type) {
      case "tool_call":
        return this.toolExecutor;
      case "llm_reasoning":
        return this.llmExecutor;
      case "memory_write":
        return this.memoryExecutor;
      case "user_checkpoint":
        return this.checkpointExecutor;
      case "subgoal_aggregate":
        return this.aggregateExecutor;
      default:
        throw new Error(`Unsupported node action type: "${node.type}".`);
    }
  }

  /**
   * Simulates execution deterministically without performing network calls or mutations.
   */
  async dryRunExecution(request: ExecutionRequest): Promise<DryRunResult> {
    const graph = await planPersistenceService.getGraph(request.graphId, request.planRevision);
    if (!graph) {
      throw new Error(`Graph "${request.graphId}" at revision ${request.planRevision} not found.`);
    }

    const steps: DryRunStep[] = [];
    const simulatedOrder: string[] = [];
    const approvalsRequired: string[] = [];
    let totalTimeoutMs = 0;

    const userCaps = new Set(request.executionContext.availableCapabilities || []);
    let allCapabilitiesSatisfied = true;

    // Simulate topological progression
    const simulatedCompleted = new Set<string>();
    const state: NodeResolutionState = {
      completedNodeIds: simulatedCompleted,
      failedNodeIds: new Set(),
      skippedNodeIds: new Set(),
      runningNodeIds: new Set(),
      waitingApprovalNodeIds: new Set(),
    };

    while (true) {
      const resolution = readyNodeResolver.resolveReadyNodes(graph, state);
      if (resolution.readyNodes.length === 0) {
        break;
      }

      for (const node of resolution.readyNodes) {
        simulatedOrder.push(node.id);
        totalTimeoutMs += node.timeoutMs || 30_000;

        let toolPolicy = { requiredCapabilities: [] as string[], destructive: false, confirmationRequired: false };
        if (node.type === "tool_call" && node.actionSpec?.toolName) {
          toolPolicy = this.toolRegistry.getPolicy(node.actionSpec.toolName);
        }

        const requiredCaps = toolPolicy.requiredCapabilities || [];
        for (const cap of requiredCaps) {
          if (!userCaps.has(cap)) {
            allCapabilitiesSatisfied = false;
          }
        }

        const requiresApproval =
          node.type === "user_checkpoint" ||
          (node.approval && node.approval.status !== "not_required") ||
          toolPolicy.destructive ||
          toolPolicy.confirmationRequired;

        if (requiresApproval) {
          approvalsRequired.push(node.id);
        }

        // Find incoming dependencies
        const incoming = graph.edges
          .filter((e) => e.toNodeId === node.id)
          .map((e) => e.fromNodeId);

        steps.push({
          nodeId: node.id,
          title: node.title,
          actionType: node.type,
          toolName: node.actionSpec?.toolName,
          requiredCapabilities: requiredCaps,
          approvalRequired: !!requiresApproval,
          dependencies: incoming,
          resolvedInputs: node.actionSpec?.parameters || {},
          simulatedStatus: requiresApproval ? "waiting_approval" : "completed",
        });

        simulatedCompleted.add(node.id);
      }
    }

    return {
      graphId: graph.graphId,
      planRevision: graph.planRevision,
      goal: graph.goal,
      simulatedExecutionOrder: simulatedOrder,
      steps,
      allCapabilitiesSatisfied,
      approvalsRequired,
      estimatedTotalTimeoutMs: totalTimeoutMs,
    };
  }

  /**
   * Pauses an active execution session safely.
   */
  async pauseExecution(request: PauseRequest): Promise<ExecutionSession> {
    const session = await executionPersistence.getActiveSessionForGraph(
      request.graphId,
      request.planRevision,
    );
    if (!session) {
      throw new Error(`No active session found for graph "${request.graphId}" at revision ${request.planRevision}.`);
    }

    const abortController = this.abortControllers.get(session.executionId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(session.executionId);
    }

    session.status = "paused_for_approval";
    session.updatedAt = new Date().toISOString();
    await executionPersistence.saveExecutionSession(session);
    await taskServiceSync.syncGraphStatusToTask(session.taskId, "paused_for_approval");

    executionObservability.logEvent({
      event: "EXECUTION_PAUSED",
      timestamp: new Date().toISOString(),
      requestId: session.requestId,
      taskId: session.taskId,
      graphId: request.graphId,
      executionId: session.executionId,
      details: { reason: request.reason || "Paused by user" },
    });

    return session;
  }

  /**
   * Resumes a paused execution session.
   */
  async resumeExecution(request: ResumeRequest): Promise<ExecutionSession> {
    const session = await executionPersistence.getActiveSessionForGraph(
      request.graphId,
      request.planRevision,
    );

    if (!session) {
      throw new Error(`No active session found for graph "${request.graphId}" at revision ${request.planRevision}.`);
    }

    // Cross-user authorization check (Item 8)
    if (request.telegramUserId && session.telegramUserId !== request.telegramUserId) {
      throw new Error(
        `Cross-user authorization violation: User ${request.telegramUserId} cannot resume execution owned by User ${session.telegramUserId}.`,
      );
    }

    const graph = await planPersistenceService.getGraph(request.graphId, request.planRevision);
    if (!graph) {
      throw new Error(`Execution graph "${request.graphId}" at revision ${request.planRevision} not found.`);
    }

    const execContext: ExecutionContext = request.executionContext || {
      telegramUserId: request.telegramUserId ?? session.telegramUserId ?? 1,
    };

    session.status = "executing";
    session.waitingApprovalNodes = [];
    session.updatedAt = new Date().toISOString();
    await executionPersistence.saveExecutionSession(session);

    let abortController = this.abortControllers.get(session.executionId);
    if (!abortController || abortController.signal.aborted) {
      abortController = new AbortController();
      this.abortControllers.set(session.executionId, abortController);
    }

    await taskServiceSync.syncGraphStatusToTask(session.taskId, "executing");

    await this.runSchedulerLoop(graph, session, execContext, abortController.signal);

    return (await executionPersistence.getExecutionSession(session.executionId)) || session;
  }

  /**
   * Cancels graph execution cleanly.
   */
  async cancelExecution(request: CancelRequest): Promise<ExecutionSession> {
    const session = await executionPersistence.getActiveSessionForGraph(
      request.graphId,
      request.planRevision,
    );

    if (!session) {
      // Check if session exists in any status
      throw new Error(`No active execution found for graph "${request.graphId}".`);
    }

    // Cross-user authorization check (Item 8)
    if (request.telegramUserId && session.telegramUserId !== request.telegramUserId) {
      throw new Error(
        `Cross-user authorization violation: User ${request.telegramUserId} cannot cancel execution owned by User ${session.telegramUserId}.`,
      );
    }

    const abortController = this.abortControllers.get(session.executionId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(session.executionId);
    }

    session.status = "cancelled";
    session.updatedAt = new Date().toISOString();
    session.completedAt = new Date().toISOString();
    await executionPersistence.saveExecutionSession(session);
    await taskServiceSync.syncGraphStatusToTask(session.taskId, "cancelled");

    executionObservability.logEvent({
      event: "EXECUTION_CANCELLED",
      timestamp: new Date().toISOString(),
      requestId: session.requestId,
      taskId: session.taskId,
      graphId: request.graphId,
      executionId: session.executionId,
      details: { reason: request.reason },
    });

    return session;
  }

  /**
   * Submits user approval or rejection for a checkpoint/destructive node.
   */
  async submitApproval(
    submission: ApprovalSubmission,
  ): Promise<{ approved: boolean; session?: ExecutionSession }> {
    const session = await executionPersistence.getSessionForGraph(
      submission.graphId,
      submission.planRevision,
    );

    if (!session) {
      throw new Error(`No execution session found for graph "${submission.graphId}".`);
    }

    // Cross-user authorization check (Item 8)
    if (session.telegramUserId !== submission.telegramUserId) {
      throw new Error(
        `Cross-user authorization violation: User ${submission.telegramUserId} cannot resolve approval for graph owned by User ${session.telegramUserId}.`,
      );
    }

    // Approval / cancellation race safety (Item 6)
    if (session.status === "cancelled") {
      throw new Error("Cannot submit approval for a cancelled execution session.");
    }

    if (session.status !== "paused_for_approval") {
      throw new Error(`Execution session is not waiting for approval (current status: "${session.status}").`);
    }

    const now = new Date().toISOString();
    await executionPersistence.upsertApproval({
      approvalId: `app_${submission.graphId}_r${submission.planRevision}_${submission.nodeId}`,
      telegramUserId: submission.telegramUserId,
      graphId: submission.graphId,
      planRevision: submission.planRevision,
      nodeId: submission.nodeId,
      status: submission.approved ? "approved" : "denied",
      reason: submission.reason || (submission.approved ? "Approved by user" : "Denied by user"),
      requestedAt: now,
      resolvedAt: now,
      resolvedByUserId: submission.telegramUserId,
    });

    // If approved, resume the execution session
    if (submission.approved) {
      const resumed = await this.resumeExecution({
        graphId: submission.graphId,
        planRevision: submission.planRevision,
        telegramUserId: submission.telegramUserId,
      });
      return { approved: true, session: resumed };
    }

    return { approved: false };
  }

  /**
   * Returns rich execution status response.
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionStatusResponse | null> {
    const session = await executionPersistence.getExecutionSession(executionId);
    if (!session) return null;

    const graph = await planPersistenceService.getGraph(session.graphId, session.planRevision);
    const totalNodes = graph ? Object.keys(graph.nodes).length : 0;

    const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(
      session.graphId,
      session.planRevision,
    );

    const nodeResults: Record<string, NodeResult> = {};
    for (const att of completedAttempts) {
      if (att.result) nodeResults[att.nodeId] = att.result;
    }

    return {
      executionId: session.executionId,
      graphId: session.graphId,
      planRevision: session.planRevision,
      revisionId: session.revisionId,
      status: session.status,
      currentNodes: session.currentNodes,
      completedCount: session.completedNodes.length,
      pendingCount: Math.max(0, totalNodes - session.completedNodes.length - session.failedNodes.length),
      failedCount: session.failedNodes.length,
      waitingApprovalCount: session.waitingApprovalNodes.length,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt,
      failure: session.error,
      nodeResults,
    };
  }

  /**
   * Interactive Stepper: Executes exactly one topologically ready node.
   */
  async executeStep(params: {
    graphId: string;
    planRevision: number;
    executionId?: string;
    telegramUserId?: number;
  }): Promise<{
    session: ExecutionSession;
    executedNodeId?: string;
    nodeResult?: NodeResult;
    hasMoreSteps: boolean;
    readyNext: string[];
  }> {
    const graph = await planPersistenceService.getGraph(params.graphId, params.planRevision);
    if (!graph) {
      throw new Error(`Graph "${params.graphId}" at revision ${params.planRevision} not found.`);
    }

    let session = await executionPersistence.getSessionForGraph(params.graphId, params.planRevision);
    if (!session) {
      session = {
        executionId: params.executionId || `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        requestId: `req_step_${Date.now()}`,
        graphId: params.graphId,
        planRevision: params.planRevision,
        revisionId: `${params.graphId}:r${params.planRevision}`,
        telegramUserId: params.telegramUserId || 1,
        status: "paused",
        currentNodes: [],
        completedNodes: [],
        failedNodes: [],
        skippedNodes: [],
        waitingApprovalNodes: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await executionPersistence.saveExecutionSession(session);
    }

    const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(
      params.graphId,
      params.planRevision,
    );
    const completedResults: Record<string, NodeResult> = {};
    for (const att of completedAttempts) {
      if (att.result) completedResults[att.nodeId] = att.result;
    }

    const state: NodeResolutionState = {
      completedNodeIds: new Set(session.completedNodes || []),
      failedNodeIds: new Set(session.failedNodes || []),
      skippedNodeIds: new Set(session.skippedNodes || []),
      runningNodeIds: new Set(),
      waitingApprovalNodeIds: new Set(session.waitingApprovalNodes || []),
    };

    const resolution = readyNodeResolver.resolveReadyNodes(graph, state);
    if (resolution.readyNodes.length === 0) {
      const allFinished = Object.keys(graph.nodes).every(
        (id) => state.completedNodeIds.has(id) || state.skippedNodeIds.has(id),
      );
      if (allFinished) {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
      } else if (state.waitingApprovalNodeIds.size > 0) {
        session.status = "paused_for_approval";
      }
      session.updatedAt = new Date().toISOString();
      await executionPersistence.saveExecutionSession(session);
      return {
        session,
        hasMoreSteps: !allFinished,
        readyNext: [],
      };
    }

    const nodeToExecute = resolution.readyNodes[0];
    const context: ExecutionContext = {
      telegramUserId: session.telegramUserId || 1,
      availableCapabilities: [],
    };

    session.status = "executing";
    session.currentNodes = [nodeToExecute.id];
    session.updatedAt = new Date().toISOString();
    await executionPersistence.saveExecutionSession(session);

    const abortController = new AbortController();
    await this.executeNode(
      nodeToExecute,
      graph,
      session,
      context,
      completedResults,
      state,
      abortController.signal,
    );

    session.completedNodes = Array.from(state.completedNodeIds);
    session.failedNodes = Array.from(state.failedNodeIds);
    session.waitingApprovalNodes = Array.from(state.waitingApprovalNodeIds);
    session.currentNodes = [];

    const nextResolution = readyNodeResolver.resolveReadyNodes(graph, state);
    const allFinished = Object.keys(graph.nodes).every(
      (id) => state.completedNodeIds.has(id) || state.skippedNodeIds.has(id),
    );

    if (allFinished) {
      session.status = "completed";
      session.completedAt = new Date().toISOString();
    } else if (session.waitingApprovalNodes.length > 0) {
      session.status = "paused_for_approval";
    } else {
      session.status = "paused";
    }

    session.updatedAt = new Date().toISOString();
    await executionPersistence.saveExecutionSession(session);

    return {
      session,
      executedNodeId: nodeToExecute.id,
      nodeResult: completedResults[nodeToExecute.id],
      hasMoreSteps: !allFinished,
      readyNext: nextResolution.readyNodes.map((n) => n.id),
    };
  }

  /**
   * Node Re-run: Re-executes a specific node in a graph session.
   */
  async rerunNode(params: {
    graphId: string;
    planRevision: number;
    nodeId: string;
    telegramUserId?: number;
  }): Promise<{
    session: ExecutionSession;
    nodeId: string;
    result?: NodeResult;
    success: boolean;
  }> {
    const graph = await planPersistenceService.getGraph(params.graphId, params.planRevision);
    if (!graph) {
      throw new Error(`Graph "${params.graphId}" at revision ${params.planRevision} not found.`);
    }

    const node = graph.nodes[params.nodeId];
    if (!node) {
      throw new Error(`Node "${params.nodeId}" does not exist in graph "${params.graphId}".`);
    }

    let session = await executionPersistence.getSessionForGraph(params.graphId, params.planRevision);
    if (!session) {
      session = {
        executionId: `exec_rerun_${Date.now()}`,
        requestId: `req_rerun_${Date.now()}`,
        graphId: params.graphId,
        planRevision: params.planRevision,
        revisionId: `${params.graphId}:r${params.planRevision}`,
        telegramUserId: params.telegramUserId || 1,
        status: "executing",
        currentNodes: [params.nodeId],
        completedNodes: [],
        failedNodes: [],
        skippedNodes: [],
        waitingApprovalNodes: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Clear prior attempt from persistence and memory
    await executionPersistence.clearNodeExecution(params.graphId, params.planRevision, params.nodeId);

    // Remove from completed/failed lists
    session.completedNodes = session.completedNodes.filter((id) => id !== params.nodeId);
    session.failedNodes = session.failedNodes.filter((id) => id !== params.nodeId);
    session.currentNodes = [params.nodeId];
    session.updatedAt = new Date().toISOString();

    const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(
      params.graphId,
      params.planRevision,
    );
    const completedResults: Record<string, NodeResult> = {};
    for (const att of completedAttempts) {
      if (att.nodeId !== params.nodeId && att.result) {
        completedResults[att.nodeId] = att.result;
      }
    }

    const state: NodeResolutionState = {
      completedNodeIds: new Set(session.completedNodes),
      failedNodeIds: new Set(session.failedNodes),
      skippedNodeIds: new Set(session.skippedNodes || []),
      runningNodeIds: new Set(),
      waitingApprovalNodeIds: new Set(session.waitingApprovalNodes || []),
    };

    const context: ExecutionContext = {
      telegramUserId: session.telegramUserId || 1,
      availableCapabilities: [],
    };

    const abortController = new AbortController();
    await this.executeNode(node, graph, session, context, completedResults, state, abortController.signal);

    session.completedNodes = Array.from(state.completedNodeIds);
    session.failedNodes = Array.from(state.failedNodeIds);
    session.currentNodes = [];
    session.updatedAt = new Date().toISOString();

    const isSuccess = state.completedNodeIds.has(params.nodeId);
    await executionPersistence.saveExecutionSession(session);

    return {
      session,
      nodeId: params.nodeId,
      result: completedResults[params.nodeId],
      success: isSuccess,
    };
  }
}

export const executionEngine = ExecutionEngine.getInstance();
