import { executionPersistence } from "../persistence/execution-persistence.service";
import { executionObservability } from "../observability/execution-logger";
import { logger } from "../../lib/logger";
import type { ExecutionLease } from "../types";

export interface StaleLeaseRecoveryResult {
  recoveredCount: number;
  leases: Array<{
    leaseKey: string;
    nodeId: string;
    action: "completed_already" | "released_for_retry" | "marked_failed";
  }>;
}

export class LeaseRecoveryService {
  private static instance: LeaseRecoveryService;

  public static getInstance(): LeaseRecoveryService {
    if (!LeaseRecoveryService.instance) {
      LeaseRecoveryService.instance = new LeaseRecoveryService();
    }
    return LeaseRecoveryService.instance;
  }

  /**
   * Scans for expired leases left by crashed/terminated workers and safely recovers state.
   */
  async recoverStaleLeases(): Promise<StaleLeaseRecoveryResult> {
    const staleLeases = await executionPersistence.findStaleLeases();
    const result: StaleLeaseRecoveryResult = {
      recoveredCount: 0,
      leases: [],
    };

    for (const lease of staleLeases) {
      try {
        const recoveryAction = await this.recoverSingleLease(lease);
        result.recoveredCount++;
        result.leases.push({
          leaseKey: lease.leaseKey,
          nodeId: lease.nodeId,
          action: recoveryAction,
        });
        executionObservability.recordStaleLeaseRecovery();
      } catch (err) {
        logger.error(
          { leaseKey: lease.leaseKey, err: String(err) },
          "STALE_LEASE_RECOVERY_ERROR",
        );
      }
    }

    return result;
  }

  private async recoverSingleLease(
    lease: ExecutionLease,
  ): Promise<"completed_already" | "released_for_retry" | "marked_failed"> {
    const idempotencyKey = `${lease.graphId}:r${lease.planRevision}:${lease.nodeId}:att${lease.attempt}`;
    const execution = await executionPersistence.getNodeExecution(idempotencyKey);

    // Case 1: The worker finished executing and wrote a completed result, but died before clearing the lease
    if (execution && execution.status === "completed") {
      await executionPersistence.releaseLease(lease.leaseKey);
      return "completed_already";
    }

    // Case 2: Incomplete execution - release the lease so next scheduling loop or retry engine can safely handle it
    await executionPersistence.releaseLease(lease.leaseKey);

    // Record failed attempt for auditability
    await executionPersistence.recordNodeExecution({
      executionId: lease.executionId,
      graphId: lease.graphId,
      planRevision: lease.planRevision,
      nodeId: lease.nodeId,
      attempt: lease.attempt,
      idempotencyKey,
      status: "failed",
      error: {
        code: "WORKER_LEASE_EXPIRED",
        message: `Worker lease expired without confirmed completion (worker: ${lease.workerId}).`,
        retryable: true,
        category: "timeout",
      },
      isRetryable: true,
      startedAt: lease.claimedAt,
      completedAt: new Date().toISOString(),
    });

    return "released_for_retry";
  }
}

export const leaseRecoveryService = LeaseRecoveryService.getInstance();
