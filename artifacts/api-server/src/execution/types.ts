import type {
  ExecutionGraph,
  GraphNode,
  NodeResult,
  ApprovalStatus,
  ExecutionError,
  ExecutionErrorCategory,
  NodeStatus,
  GraphStatus,
} from "../planner/types";

/**
 * Execution Engine V1 Contract Definitions
 */

export interface ExecutionEngineConfig {
  enabled: boolean;
  maxConcurrency: number;
  maxPerUser: number;
  maxPerGraph: number;
  maxPerTool: number;
  leaseDurationMs: number;
  staleLeaseThresholdMs: number;
  defaultTimeoutMs: number;
  maxRetries: number;
}

export interface ExecutionContext {
  telegramUserId: number;
  chatId?: number;
  conversationId?: number;
  userMode?: string;
  userPersonality?: string;
  availableCapabilities?: string[];
}

export interface ExecutionRequest {
  graphId: string;
  planRevision: number;
  requestId: string;
  taskId?: number;
  executionContext: ExecutionContext;
  dryRun?: boolean;
}

export interface ExecutionSession {
  executionId: string;
  requestId: string;
  taskId?: number;
  graphId: string;
  planRevision: number;
  revisionId: string;
  telegramUserId: number;
  status: GraphStatus;
  currentNodes: string[];
  completedNodes: string[];
  failedNodes: string[];
  waitingApprovalNodes: string[];
  error?: ExecutionError;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  deadlineAt?: string;
}

export interface NodeExecutionAttempt {
  executionId: string;
  graphId: string;
  planRevision: number;
  nodeId: string;
  attempt: number;
  idempotencyKey: string;
  status: NodeStatus;
  workerId?: string;
  result?: NodeResult;
  error?: ExecutionError;
  isRetryable: boolean;
  startedAt: string;
  completedAt?: string;
  deadlineAt?: string;
}

export interface ExecutionLease {
  leaseKey: string;
  executionId: string;
  graphId: string;
  planRevision: number;
  nodeId: string;
  workerId: string;
  attempt: number;
  claimedAt: string;
  leaseExpiresAt: string;
}

export interface StoredApproval {
  approvalId: string;
  telegramUserId: number;
  graphId: string;
  planRevision: number;
  nodeId: string;
  status: ApprovalStatus;
  reason: string;
  requestedAt: string;
  resolvedAt?: string;
  expiresAt?: string;
  resolvedByUserId?: number;
}

export interface ApprovalSubmission {
  graphId: string;
  planRevision: number;
  nodeId: string;
  telegramUserId: number;
  approved: boolean;
  reason?: string;
}

export interface PauseRequest {
  graphId: string;
  planRevision: number;
  telegramUserId?: number;
  reason?: string;
}

export interface ResumeRequest {
  graphId: string;
  planRevision: number;
  telegramUserId?: number;
  requestId?: string;
  executionContext?: ExecutionContext;
}

export interface CancelRequest {
  graphId: string;
  planRevision: number;
  telegramUserId?: number;
  reason: string;
}

export interface ExecutionStatusResponse {
  executionId: string;
  graphId: string;
  planRevision: number;
  revisionId: string;
  status: GraphStatus;
  currentNodes: string[];
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  waitingApprovalCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  deadlineAt?: string;
  failure?: ExecutionError;
  nodeResults: Record<string, NodeResult>;
}

export interface DryRunStep {
  nodeId: string;
  title: string;
  actionType: string;
  toolName?: string;
  requiredCapabilities: string[];
  approvalRequired: boolean;
  dependencies: string[];
  resolvedInputs: Record<string, unknown>;
  simulatedStatus: NodeStatus;
}

export interface DryRunResult {
  graphId: string;
  planRevision: number;
  goal: string;
  simulatedExecutionOrder: string[];
  steps: DryRunStep[];
  allCapabilitiesSatisfied: boolean;
  approvalsRequired: string[];
  estimatedTotalTimeoutMs: number;
}

export type ExecutionEventName =
  | "EXECUTION_STARTED"
  | "EXECUTION_REJECTED"
  | "GRAPH_EXECUTING"
  | "NODE_READY"
  | "NODE_CLAIMED"
  | "NODE_STARTED"
  | "NODE_COMPLETED"
  | "NODE_FAILED"
  | "NODE_RETRY_SCHEDULED"
  | "NODE_TIMEOUT"
  | "NODE_VERIFICATION_STARTED"
  | "NODE_VERIFICATION_COMPLETED"
  | "APPROVAL_REQUIRED"
  | "EXECUTION_PAUSED"
  | "EXECUTION_RESUMED"
  | "EXECUTION_CANCELLED"
  | "GRAPH_COMPLETED"
  | "GRAPH_FAILED"
  | "GRAPH_RECOVERY_REQUIRED";

export interface ExecutionEventPayload {
  event: ExecutionEventName;
  timestamp: string;
  requestId?: string;
  taskId?: number;
  graphId?: string;
  revisionId?: string;
  nodeId?: string;
  executionId?: string;
  attempt?: number;
  details?: Record<string, unknown>;
}
