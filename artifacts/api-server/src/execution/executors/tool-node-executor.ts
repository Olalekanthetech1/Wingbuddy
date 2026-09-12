import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { ToolRegistry } from "../../tools/tool-registry";
import { executionPersistence } from "../persistence/execution-persistence.service";
import { retryEngine } from "../resilience/retry-engine";

export class ToolNodeExecutor implements INodeExecutor {
  constructor(private readonly toolRegistry: ToolRegistry) {}

  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, graphId, planRevision, attempt, resolvedInputs, executionContext, signal } = params;

    const toolName = node.actionSpec?.toolName;
    if (!toolName) {
      return {
        success: false,
        error: {
          code: "MISSING_TOOL_NAME",
          message: `Node "${node.id}" of type "tool_call" has no toolName specified.`,
          retryable: false,
          category: "validation",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Tool "${toolName}" is not registered in authoritative ToolRegistry.`,
          retryable: false,
          category: "tool",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const policy = this.toolRegistry.getPolicy(toolName);

    const userCaps = new Set(executionContext.availableCapabilities || []);
    const missingCaps = (policy.requiredCapabilities || []).filter((cap) => !userCaps.has(cap));
    if (missingCaps.length > 0) {
      return {
        success: false,
        error: {
          code: "INSUFFICIENT_CAPABILITIES",
          message: `Runtime capability check failed for tool "${toolName}". Missing: ${missingCaps.join(", ")}.`,
          retryable: false,
          category: "authorization",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    if (policy.destructive || policy.confirmationRequired || (node.approval && node.approval.status !== "not_required")) {
      const storedApproval = await executionPersistence.getApproval(graphId, planRevision, node.id);
      
      const crypto = await import("crypto");
      const parameterHash = crypto.createHash("sha256").update(JSON.stringify(resolvedInputs || {})).digest("hex");

      if (!storedApproval || storedApproval.status === "pending") {
        if (!storedApproval) {
          await executionPersistence.upsertApproval({
            approvalId: `app_${graphId}_r${planRevision}_${node.id}`,
            telegramUserId: executionContext.telegramUserId,
            graphId,
            planRevision,
            nodeId: node.id,
            status: "pending",
            reason: node.approval?.reason || `User confirmation required for tool: ${toolName}`,
            requestedAt: new Date().toISOString(),
            parameterHash,
          });
        }

        return {
          success: false,
          error: {
            code: "WAITING_APPROVAL",
            message: `Execution paused: tool "${toolName}" on node "${node.id}" requires user confirmation before execution.`,
            retryable: false,
            category: "authorization",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      if (storedApproval.status === "denied") {
        return {
          success: false,
          error: {
            code: "APPROVAL_REJECTED",
            message: `Tool "${toolName}" on node "${node.id}" approval was denied by user.`,
            retryable: false,
            category: "authorization",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      if (storedApproval.status !== "approved") {
        return {
          success: false,
          error: {
            code: "UNAPPROVED_DESTRUCTIVE_OPERATION",
            message: `Tool "${toolName}" on node "${node.id}" requires user approval before execution. Current status: "${storedApproval.status}".`,
            retryable: false,
            category: "authorization",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      if (storedApproval.parameterHash && storedApproval.parameterHash !== parameterHash) {
        return {
          success: false,
          error: {
            code: "APPROVAL_PARAMETER_MISMATCH",
            message: `Cryptographic binding mismatch: Parameters for tool "${toolName}" on node "${node.id}" were mutated after approval.`,
            retryable: false,
            category: "authorization",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      if (storedApproval.expiresAt && new Date(storedApproval.expiresAt).getTime() < Date.now()) {
        return {
          success: false,
          error: {
            code: "APPROVAL_EXPIRED",
            message: `Approval for tool "${toolName}" on node "${node.id}" has expired.`,
            retryable: false,
            category: "authorization",
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }
    }

    // A durable, non-idempotent side effect may never be replayed merely because
    // an earlier network call timed out. The execution engine may still retry
    // the node internally, but attempt > 0 is rejected here as a hard safety gate.
    if (policy.sideEffect && !policy.idempotent && attempt > 0) {
      return {
        success: false,
        error: {
          code: "NON_IDEMPOTENT_RETRY_BLOCKED",
          message: `Retry blocked for non-idempotent side-effecting tool "${toolName}" to prevent duplicate durable actions.`,
          retryable: false,
          category: "tool",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const idempotencyKey = `${graphId}:r${planRevision}:${node.id}:att${attempt}`;
    const timeoutMs = node.timeoutMs || policy.timeoutMs || 30_000;
    const toolContext = {
      telegramUserId: executionContext.telegramUserId,
      chatId: executionContext.chatId ?? executionContext.telegramUserId,
      conversationId: executionContext.conversationId,
      idempotencyKey,
      signal,
    };

    try {
      const toolOutput = await retryEngine.withTimeout(
        async (timeoutSignal) => {
          if (signal.aborted || timeoutSignal.aborted) {
            throw new Error("Execution was aborted before tool dispatch.");
          }
          return tool.execute(resolvedInputs, toolContext);
        },
        timeoutMs,
        `Tool "${toolName}"`,
      );

      return {
        success: true,
        output: toolOutput,
        metadata: {
          durationMs: Date.now() - startTime,
          toolName,
          attempt,
          sideEffect: policy.sideEffect,
          idempotent: policy.idempotent,
        },
      };
    } catch (err: any) {
      const classified = retryEngine.classifyError(err);
      return {
        success: false,
        error: classified,
        metadata: { durationMs: Date.now() - startTime, toolName, attempt },
      };
    }
  }
}
