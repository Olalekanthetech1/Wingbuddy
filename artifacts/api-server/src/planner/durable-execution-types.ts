import { ExecutionGraph, GraphNode } from "./types";

export type SessionState =
  | "QUEUED"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "WAITING_FOR_TOOL"
  | "pending"
  | "REPLANNING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "expired"
  | "BUDGET_EXCEEDED";

export type NodeExecutionState =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

export type ExecutionEventType =
  // Session lifecycle
  | "SESSION_CREATED"
  | "PLAN_COMPILED"
  | "SESSION_STARTED"
  | "SESSION_PAUSED"
  | "SESSION_RESUMED"
  | "SESSION_COMPLETED"
  | "SESSION_FAILED"
  | "SESSION_CANCEL_REQUESTED"
  | "SESSION_CANCELLED"
  | "SESSION_EXPIRED"
  | "SESSION_BUDGET_EXCEEDED"
  // Node lifecycle
  | "NODE_CREATED"
  | "NODE_STARTED"
  | "NODE_COMPLETED"
  | "NODE_FAILED"
  | "NODE_SKIPPED"
  | "NODE_RETRY_REQUESTED"
  // Tool lifecycle
  | "TOOL_INVOKED"
  | "TOOL_COMPLETED"
  | "TOOL_FAILED"
  // Worker leases
  | "WORKER_LEASE_ACQUIRED"
  | "WORKER_HEARTBEAT"
  | "WORKER_LEASE_EXPIRED"
  | "WORKER_LEASE_RELEASED"
  // Future-compatible markers
  | "REPLAN_STARTED"
  | "REPLAN_COMPLETED"
  | "HITL_REQUESTED"
  | "HITL_APPROVED"
  | "HITL_REJECTED"
  | "HITL_EXPIRED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_COMPLETED"
  | "VERIFICATION_FAILED";

export interface ExecutionBudget {
  maxExecutionTimeMs: number;
  maxNodes: number;
  maxAttemptsPerNode: number;
  maxToolCalls: number;
  maxTotalTokens?: number;
}

export interface ExecutionUsage {
  totalExecutionTimeMs: number;
  totalNodesExecuted: number;
  totalToolCalls: number;
  totalTokensUsed: number;
  attemptsCount: Record<string, number>;
}

export interface DurableExecutionEvent {
  id: string;
  executionId: string;
  graphId?: string;
  planRevision?: number;
  nodeId?: string;
  eventType: ExecutionEventType;
  sequenceNumber: number;
  actor: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ConcurrencyLimits {
  maxGlobalConcurrentSessions: number;
  maxUserConcurrentSessions: number;
  maxUserActiveToolCalls: number;
}

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  maxExecutionTimeMs: 180_000, // 3 minutes
  maxNodes: 20,
  maxAttemptsPerNode: 3,
  maxToolCalls: 25,
  maxTotalTokens: 100_000,
};

export const DEFAULT_CONCURRENCY_LIMITS: ConcurrencyLimits = {
  maxGlobalConcurrentSessions: 20,
  maxUserConcurrentSessions: 3,
  maxUserActiveToolCalls: 5,
};
