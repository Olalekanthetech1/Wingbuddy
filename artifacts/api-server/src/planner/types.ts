import type { ToolRegistry, ToolSecurityPolicy } from "../tools/tool-registry";

/**
 * Execution Graph & Agent Planner Contract Definitions
 * Version: 1.0.1
 */

export const CURRENT_GRAPH_SCHEMA_VERSION = 1;
export const MAX_GRAPH_NODES = 50;
export const MAX_GRAPH_EDGES = 150;
export const MAX_NODE_RETRIES = 5;
export const MIN_NODE_TIMEOUT_MS = 100;
export const MAX_NODE_TIMEOUT_MS = 300_000; // 5 minutes
export const MAX_TOOL_CALLS = 30;
export const MAX_PLAN_REVISIONS = 5;
export const MAX_EXECUTION_DURATION_MS = 600_000; // 10 minutes

export type GraphStatus = "draft" | "ready" | "executing" | "paused_for_approval" | "completed" | "failed" | "cancelled";
export type NodeStatus = "pending" | "ready" | "running" | "completed" | "failed" | "skipped" | "waiting_approval";
export type NodeActionType = "llm_reasoning" | "tool_call" | "memory_write" | "user_checkpoint" | "subgoal_aggregate";
export type ApprovalStatus = "not_required" | "pending" | "approved" | "denied" | "expired";
export type ExecutionErrorCategory = "validation" | "authentication" | "authorization" | "rate_limit" | "timeout" | "provider" | "tool" | "network" | "unknown";
export interface NodeApprovalInfo { status: ApprovalStatus; reason: string; requestedAt?: string; resolvedAt?: string; expiresAt?: string; resolvedByUserId?: number; }
export interface ExecutionError { code: string; message: string; retryable: boolean; category: ExecutionErrorCategory; details?: unknown; }
export interface ArtifactRef { id: string; type: "file" | "image" | "memory_item" | "json" | "text"; uriOrRef: string; mimeType?: string; sizeBytes?: number; }
export interface NodeResult { success: boolean; output?: unknown; error?: ExecutionError; artifacts?: ArtifactRef[]; metadata?: Record<string, unknown>; }
export type InputBindingSource = { type: "node_output"; nodeId: string; path: string } | { type: "literal"; value: unknown } | { type: "context"; path: string };
export interface InputBinding { source: InputBindingSource; }
export interface ToolInvocationSpec { toolName: string; parameters: Record<string, unknown>; }
export interface LLMReasoningSpec { prompt: string; systemInstruction?: string; targetFormat?: "text" | "json" | "markdown"; jsonSchema?: Record<string, unknown>; }
export interface MemoryWriteSpec { key: string; content: string; category?: string; }
export type VerificationStrategy = "none" | "schema" | "assertion" | "tool_result" | "llm_review";
export interface NodeVerificationSpec { required: boolean; strategy: VerificationStrategy; schemaOrRule?: Record<string, unknown>; assertionExpression?: string; reviewPrompt?: string; }
export interface NodeRetryPolicy { maxAttempts: number; backoffMs: number; }
export interface GraphNode { id: string; title: string; type: NodeActionType; actionSpec?: ToolInvocationSpec; reasoningSpec?: LLMReasoningSpec; memorySpec?: MemoryWriteSpec; inputBindings: Record<string, InputBinding>; status: NodeStatus; approval: NodeApprovalInfo; verification: NodeVerificationSpec; retryPolicy: NodeRetryPolicy; timeoutMs: number; result?: NodeResult; }
export type EdgeDependencyType = "hard" | "soft" | "conditional";
export interface EdgeCondition { field: string; operator: "eq" | "neq" | "exists" | "truthy"; value?: unknown; }
export interface GraphEdge { fromNodeId: string; toNodeId: string; dependencyType: EdgeDependencyType; condition?: EdgeCondition; }
export interface GraphCancellationSignal { isCancelled: boolean; reason?: string; cancelledAt?: string; cancelledByUserId?: number; }
export interface GraphMetadata { model?: string; derivedStepCount: number; advisoryEstimatedSteps?: number; requiresApproval: boolean; createdAt: string; updatedAt: string; }
export interface EffectiveExecutionPolicy { maxNodes: number; maxEdges: number; maxToolCalls: number; maxPlanRevisions: number; maxExecutionDurationMs: number; }
export interface ExecutionGraph { schemaVersion: number; graphId: string; planRevision: number; revisionId: string; parentRevisionId?: string; telegramUserId: number; goal: string; status: GraphStatus; nodes: Record<string, GraphNode>; edges: GraphEdge[]; cancellation?: GraphCancellationSignal; metadata: GraphMetadata; effectivePolicy?: EffectiveExecutionPolicy; }
export interface NodeExecution { executionId: string; graphId: string; planRevision: number; nodeId: string; attempt: number; status: NodeStatus; idempotencyKey: string; startedAt?: string; finishedAt?: string; result?: NodeResult; }
export interface ValidationDiagnostic { severity: "error" | "warning"; code: string; message: string; nodeId?: string; edge?: { from: string; to: string }; }
export interface ValidationResult { valid: boolean; errors: ValidationDiagnostic[]; warnings: ValidationDiagnostic[]; topologicalOrder?: string[]; derivedStepCount: number; effectivePolicies?: Record<string, ToolSecurityPolicy>; }
export interface CandidateNode { id?: string; title: string; type: NodeActionType; actionSpec?: ToolInvocationSpec; reasoningSpec?: LLMReasoningSpec; memorySpec?: MemoryWriteSpec; inputBindings?: Record<string, InputBinding>; status?: NodeStatus; approval?: Partial<NodeApprovalInfo>; verification?: Partial<NodeVerificationSpec>; retryPolicy?: Partial<NodeRetryPolicy>; timeoutMs?: number; dependsOn?: string[]; }
export interface CandidateEdge { fromNodeId: string; toNodeId: string; dependencyType?: EdgeDependencyType; condition?: EdgeCondition; }
export interface CandidatePlan { graphId?: string; goal: string; strategy?: string; advisoryEstimatedSteps?: number; advisoryRequiresApproval?: boolean; nodes: CandidateNode[]; edges?: CandidateEdge[]; }
export type PlannerErrorCode = "PLAN_GENERATION_FAILED" | "PLAN_COMPILATION_FAILED" | "PLAN_VALIDATION_FAILED" | "UNAUTHORIZED_TOOL_CAPABILITY" | "PLAN_REJECTED" | "INVALID_INPUT_BINDING" | "INVALID_DEPENDENCY" | "APPROVAL_REQUIRED";
export interface CompilerContext { telegramUserId: number; requestId: string; taskId?: number; graphId?: string; planRevision?: number; parentRevisionId?: string; toolRegistry?: ToolRegistry; userCapabilities?: string[]; plannerModel?: string; timestamp?: string; effectivePolicy?: EffectiveExecutionPolicy; }
export interface PlannerUserContext {
  mode?: string;
  capabilities?: string[];
  memories?: Array<{ key: string; content: string; category?: string }>;
  activeTask?: { id: number; title: string; goal: string };
  conversationContext?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  userPreferences?: Record<string, unknown>;
  mediaPresent?: boolean;
  requiresExternalEvidence?: boolean;
}
export interface PlannerRequest { requestId: string; telegramUserId: number; goal: string; context?: PlannerUserContext; toolRegistry?: ToolRegistry; taskId?: number; graphId?: string; plannerModel?: string; }
export interface ReplannerRequest { requestId: string; telegramUserId: number; previousGraphId: string; previousRevision: number; replanReason: string; failedNodeId?: string; context?: PlannerUserContext; toolRegistry?: ToolRegistry; taskId?: number; plannerModel?: string; }
export interface PlannerResult { success: boolean; graph?: ExecutionGraph; errorCode?: PlannerErrorCode; errorMessage?: string; diagnostics: ValidationDiagnostic[]; isDirectResponse?: boolean; }
