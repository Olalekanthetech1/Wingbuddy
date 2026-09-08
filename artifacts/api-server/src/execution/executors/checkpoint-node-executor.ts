import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { executionPersistence } from "../persistence/execution-persistence.service";

export class CheckpointNodeExecutor implements INodeExecutor {
  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, graphId, planRevision, executionContext } = params;

    const approval = await executionPersistence.getApproval(graphId, planRevision, node.id);

    if (!approval || approval.status === "pending") {
      // Upsert pending approval if not existing
      if (!approval) {
        await executionPersistence.upsertApproval({
          approvalId: `app_${graphId}_r${planRevision}_${node.id}`,
          telegramUserId: executionContext.telegramUserId,
          graphId,
          planRevision,
          nodeId: node.id,
          status: "pending",
          reason: node.approval?.reason || `User checkpoint confirmation required for node: ${node.title}`,
          requestedAt: new Date().toISOString(),
        });
      }

      return {
        success: false,
        error: {
          code: "WAITING_APPROVAL",
          message: `Execution paused: checkpoint node "${node.id}" requires user confirmation.`,
          retryable: false,
          category: "authorization",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    if (approval.status === "denied") {
      return {
        success: false,
        error: {
          code: "APPROVAL_REJECTED",
          message: `User checkpoint denied by user. Reason: ${approval.reason}`,
          retryable: false,
          category: "authorization",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    // Approved
    return {
      success: true,
      output: {
        checkpointPassed: true,
        approvedAt: approval.resolvedAt,
        resolvedByUserId: approval.resolvedByUserId,
      },
      metadata: { durationMs: Date.now() - startTime },
    };
  }
}
