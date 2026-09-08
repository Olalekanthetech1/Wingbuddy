import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult, ExecutionError } from "../../planner/types";
import { ToolRegistry, type AssistantTool } from "../../tools/tool-registry";
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

    // 1. Tool Registry Authoritative Resolution
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

    // 2. Runtime Capability Re-verification
    const userCaps = new Set(executionContext.availableCapabilities || []);
    const requiredCaps = policy.requiredCapabilities || [];
    const missingCaps = requiredCaps.filter((cap) => !userCaps.has(cap));

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

    // 3. Approval Verification for Destructive / Confirmation-required tools
    if (policy.destructive || policy.confirmationRequired || (node.approval && node.approval.status !== "not_required")) {
      const storedApproval = await executionPersistence.getApproval(
        graphId,
        planRevision,
        node.id,
      );

      if (!storedApproval || storedApproval.status === "pending") {
        if (!storedApproval) {
          await executionPersistence.upsertApproval({
            approvalId: `app_${graphId}_r${planRevision}_${node.id}`,
            telegramUserId: executionContext.telegramUserId,
            graphId,
            planRevision,
            nodeId: node.id,
            status: "pending",
            reason: node.approval?.reason || `User confirmation required for destructive tool: ${toolName}`,
            requestedAt: new Date().toISOString(),
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

      // Check approval expiration
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

    // 4. Standardized Idempotency Key
    const idempotencyKey = `${graphId}:r${planRevision}:${node.id}:att${attempt}`;

    // 5. Tool Context & Execution
    const timeoutMs = node.timeoutMs || policy.timeoutMs || 30_000;
    const toolContext = {
      telegramUserId: executionContext.telegramUserId,
      chatId: executionContext.chatId ?? executionContext.telegramUserId,
      idempotencyKey,
      signal,
    };

    try {
      const toolOutput = await retryEngine.withTimeout(
        async (timeoutSignal) => {
          if (signal.aborted || timeoutSignal.aborted) {
            throw new Error("Execution was aborted before tool dispatch.");
          }
          return await tool.execute(resolvedInputs, toolContext as any);
        },
        timeoutMs,
        `Tool "${toolName}"`,
      );

      return {
        success: true,
        output: toolOutput,
        metadata: { durationMs: Date.now() - startTime },
      };
    } catch (err: any) {
      const classified = retryEngine.classifyError(err);
      return {
        success: false,
        error: classified,
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  }
}
