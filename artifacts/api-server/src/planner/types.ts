import type { ToolRegistry, ToolSecurityPolicy } from "../tools/tool-registry";

/**
 * Execution Graph & Agent Planner Contract Definitions
 * Version: 1.0.0
 */

export const CURRENT_GRAPH_SCHEMA_VERSION = 1;
export const MAX_GRAPH_NODES = 50;
export const MAX_NODE_RETRIES = 5;
export const MIN_NODE_TIMEOUT_MS = 100;
export const MAX_NODE_TIMEOUT_MS = 300_000; // 5 minutes

export type GraphStatus =
  | "draft"
  | "ready"
  | "executing"
  | "paused_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "waiting_approval";

export type NodeActionType =
  | "llm_reasoning"       // Pure reasoning/synthesis/transformation. Zero side effects, zero tool execution.
  | "tool_call"           // Invocation of a registered tool from ToolRegistry.
  | "memory_write"        // Explicit commit to long-term memory store.
  | "user_checkpoint"     // Human-in-the-loop checkpoint or explicit user decision.
  | "subgoal_aggregate";  // Deterministic reduction/merging of parallel branch outputs.

export type ApprovalStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export interface NodeApprovalInfo {
  status: ApprovalStatus;
  reason: string;
  requestedAt?: string;
  resolvedAt?: string;
  expiresAt?: string;
  resolvedByUserId?: number;
}

export type ExecutionErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "timeout"
  | "provider"
  | "tool"
  | "network"
  | "unknown";

export interface ExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  category: ExecutionErrorCategory;
  details?: unknown;
}

export interface ArtifactRef {
  id: string;
  type: "file" | "image" | "memory_item" | "json" | "text";
  uriOrRef: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface NodeResult {
  success: boolean;
  output?: unknown;
  error?: ExecutionError;
  artifacts?: ArtifactRef[];
  metadata?: Record<string, unknown>;
}

export type InputBindingSource =
  | {
      type: "node_output";
      nodeId: string;
      path: string;
    }
  | {
      type: "literal";
      value: unknown;
    }
  | {
      type: "context";
      path: string;
    };

export interface InputBinding {
  source: InputBindingSource;
}

export interface ToolInvocationSpec {
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface LLMReasoningSpec {
  prompt: string;
  systemInstruction?: string;
  targetFormat?: "text" | "json" | "markdown";
  jsonSchema?: Record<string, unknown>;
}

export interface MemoryWriteSpec {
  key: string;
  content: string;
  category?: string;
}

export type VerificationStrategy =
  | "none"
  | "schema"
  | "assertion"
  | "tool_result"
  | "llm_review";

export interface NodeVerificationSpec {
  required: boolean;
  strategy: VerificationStrategy;
  schemaOrRule?: Record<string, unknown>;
  assertionExpression?: string;
  reviewPrompt?: string;
}

export interface NodeRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface GraphNode {
  id: string;
  title: string;
  type: NodeActionType;
  /** Explicit spec for tool_call. Forbidden on llm_reasoning. */
  actionSpec?: ToolInvocationSpec;
  /** Explicit spec for llm_reasoning. Forbidden on tool_call. */
  reasoningSpec?: LLMReasoningSpec;
  /** Explicit spec for memory_write. */
  memorySpec?: MemoryWriteSpec;
  /** Strongly typed parameter bindings */
  inputBindings: Record<string, InputBinding>;
  status: NodeStatus;
  approval: NodeApprovalInfo;
  verification: NodeVerificationSpec;
  retryPolicy: NodeRetryPolicy;
  timeoutMs: number;
  result?: NodeResult;
}

export type EdgeDependencyType =
  | "hard"          // Target node cannot run unless source node completes successfully
  | "soft"          // Target node can run if source completes or fails (fall-through / recovery)
  | "conditional";   // Target node runs only if source output matches predicate

export interface EdgeCondition {
  field: string;
  operator: "eq" | "neq" | "exists" | "truthy";
  value?: unknown;
}

export interface GraphEdge {
  fromNodeId: string;
  toNodeId: string;
  dependencyType: EdgeDependencyType;
  condition?: EdgeCondition;
}

export interface GraphCancellationSignal {
  isCancelled: boolean;
  reason?: string;
  cancelledAt?: string;
  cancelledByUserId?: number;
}

export interface GraphMetadata {
  model?: string;
  /** Derived strictly by validator from node count, never trusted blindly from model */
  derivedStepCount: number;
  /** Advisory estimate provided by planner model */
  advisoryEstimatedSteps?: number;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionGraph {
  schemaVersion: number;
  graphId: string;
  planRevision: number;
  revisionId: string;
  parentRevisionId?: string;
  telegramUserId: number;
  goal: string;
  status: GraphStatus;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  cancellation?: GraphCancellationSignal;
  metadata: GraphMetadata;
}

/**
 * Execution record for auditability & multi-worker idempotency
 */
export interface NodeExecution {
  executionId: string;
  graphId: string;
  planRevision: number;
  nodeId: string;
  attempt: number;
  status: NodeStatus;
  idempotencyKey: string; // `${graphId}:r${planRevision}:${nodeId}:att${attempt}`
  startedAt?: string;
  finishedAt?: string;
  result?: NodeResult;
}

export interface ValidationDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edge?: { from: string; to: string };
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationDiagnostic[];
  warnings: ValidationDiagnostic[];
  topologicalOrder?: string[];
  derivedStepCount: number;
  effectivePolicies?: Record<string, ToolSecurityPolicy>;
}

/**
 * Candidate Plan Types (Proposed by LLM or planner generator before compilation)
 */

export interface CandidateNode {
  id?: string;
  title: string;
  type: NodeActionType;
  actionSpec?: ToolInvocationSpec;
  reasoningSpec?: LLMReasoningSpec;
  memorySpec?: MemoryWriteSpec;
  inputBindings?: Record<string, InputBinding>;
  status?: NodeStatus;
  approval?: Partial<NodeApprovalInfo>;
  verification?: Partial<NodeVerificationSpec>;
  retryPolicy?: Partial<NodeRetryPolicy>;
  timeoutMs?: number;
  dependsOn?: string[];
}


export interface CandidateEdge {
  fromNodeId: string;
  toNodeId: string;
  dependencyType?: EdgeDependencyType;
  condition?: EdgeCondition;
}

export interface CandidatePlan {
  graphId?: string;
  goal: string;
  strategy?: string;
  advisoryEstimatedSteps?: number;
  advisoryRequiresApproval?: boolean;
  nodes: CandidateNode[];
  edges?: CandidateEdge[];
}

export type PlannerErrorCode =
  | "PLAN_GENERATION_FAILED"
  | "PLAN_COMPILATION_FAILED"
  | "PLAN_VALIDATION_FAILED"
  | "UNAUTHORIZED_TOOL_CAPABILITY"
  | "PLAN_REJECTED"
  | "INVALID_INPUT_BINDING"
  | "INVALID_DEPENDENCY"
  | "APPROVAL_REQUIRED";

export interface CompilerContext {
  telegramUserId: number;
  requestId: string;
  taskId?: number;
  graphId?: string;
  planRevision?: number;
  parentRevisionId?: string;
  toolRegistry?: ToolRegistry;
  userCapabilities?: string[];
  plannerModel?: string;
  timestamp?: string;
}

export interface CompilationResult {
  success: boolean;
  graph?: ExecutionGraph;
  diagnostics: ValidationDiagnostic[];
  errorCode?: PlannerErrorCode;
  topologicalOrder?: string[];
}

export interface PlannerUserContext {
  mode?: string;
  capabilities?: string[];
  memories?: Array<{ key: string; content: string; category?: string }>;
  activeTask?: { id: number; title: string; goal: string };
  conversationContext?: string;
  userPreferences?: Record<string, unknown>;
}

export interface PlannerRequest {
  requestId: string;
  telegramUserId: number;
  goal: string;
  context?: PlannerUserContext;
  toolRegistry?: ToolRegistry;
  taskId?: number;
  graphId?: string;
  plannerModel?: string;
}

export interface ReplannerRequest {
  requestId: string;
  telegramUserId: number;
  previousGraphId: string;
  previousRevision: number;
  replanReason: string;
  failedNodeId?: string;
  context?: PlannerUserContext;
  toolRegistry?: ToolRegistry;
  taskId?: number;
  plannerModel?: string;
}

export interface PlannerResult {
  success: boolean;
  graph?: ExecutionGraph;
  errorCode?: PlannerErrorCode;
  errorMessage?: string;
  diagnostics: ValidationDiagnostic[];
  isDirectResponse?: boolean;
}

