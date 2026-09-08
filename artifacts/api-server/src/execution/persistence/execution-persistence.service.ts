import { getPool } from "@workspace/db";
import { logger } from "../../lib/logger";
import type {
  ExecutionSession,
  NodeExecutionAttempt,
  ExecutionLease,
  StoredApproval,
} from "../types";
import type { GraphStatus, NodeStatus, ExecutionError } from "../../planner/types";

export class ExecutionPersistenceService {
  private static instance: ExecutionPersistenceService;

  // In-memory fallback / cache stores
  private readonly sessions = new Map<string, ExecutionSession>();
  private readonly nodeExecutions = new Map<string, NodeExecutionAttempt>(); // key: idempotencyKey
  private readonly leases = new Map<string, ExecutionLease>(); // key: leaseKey
  private readonly approvals = new Map<string, StoredApproval>(); // key: ${graphId}:r${planRevision}:${nodeId}

  public static getInstance(): ExecutionPersistenceService {
    if (!ExecutionPersistenceService.instance) {
      ExecutionPersistenceService.instance = new ExecutionPersistenceService();
    }
    return ExecutionPersistenceService.instance;
  }

  private isDbAvailable(): boolean {
    try {
      return !!process.env.DATABASE_URL;
    } catch {
      return false;
    }
  }

  // --- Execution Sessions ---

  async saveExecutionSession(session: ExecutionSession): Promise<void> {
    this.sessions.set(session.executionId, JSON.parse(JSON.stringify(session)));

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const nodesPayload = JSON.stringify({
          current: session.currentNodes || [],
          completed: session.completedNodes || [],
          failed: session.failedNodes || [],
          waitingApproval: session.waitingApprovalNodes || [],
        });
        await pool.query(
          `INSERT INTO execution_sessions (
            execution_id, request_id, task_id, graph_id, plan_revision, revision_id,
            telegram_user_id, status, current_nodes_json, error_json, started_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (execution_id) DO UPDATE SET
            status = $8,
            current_nodes_json = $9,
            error_json = $10,
            updated_at = $12,
            completed_at = CASE WHEN $8 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE execution_sessions.completed_at END`,
          [
            session.executionId,
            session.requestId,
            session.taskId ?? null,
            session.graphId,
            session.planRevision,
            session.revisionId,
            session.telegramUserId,
            session.status,
            nodesPayload,
            session.error ? JSON.stringify(session.error) : null,
            new Date(session.startedAt),
            new Date(session.updatedAt),
          ],
        );
      } catch (err) {
        logger.warn({ err: String(err) }, "EXECUTION_SESSION_DB_SAVE_FALLBACK");
      }
    }
  }

  async getExecutionSession(executionId: string): Promise<ExecutionSession | null> {
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM execution_sessions WHERE execution_id = $1 LIMIT 1`,
          [executionId],
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          const inMem = this.sessions.get(executionId);
          let currentNodes: string[] = [];
          let completedNodes: string[] = [];
          let failedNodes: string[] = [];
          let waitingApprovalNodes: string[] = [];

          if (row.current_nodes_json) {
            try {
              const parsed = JSON.parse(row.current_nodes_json);
              if (Array.isArray(parsed)) {
                currentNodes = parsed;
              } else if (parsed && typeof parsed === "object") {
                currentNodes = parsed.current || [];
                completedNodes = parsed.completed || [];
                failedNodes = parsed.failed || [];
                waitingApprovalNodes = parsed.waitingApproval || [];
              }
            } catch {}
          }

          if (inMem) {
            if (inMem.currentNodes?.length) currentNodes = inMem.currentNodes;
            if (inMem.completedNodes?.length) completedNodes = inMem.completedNodes;
            if (inMem.failedNodes?.length) failedNodes = inMem.failedNodes;
            if (inMem.waitingApprovalNodes?.length) waitingApprovalNodes = inMem.waitingApprovalNodes;
          }

          return {
            executionId: row.execution_id,
            requestId: row.request_id,
            taskId: row.task_id ? Number(row.task_id) : undefined,
            graphId: row.graph_id,
            planRevision: Number(row.plan_revision),
            revisionId: row.revision_id,
            telegramUserId: Number(row.telegram_user_id),
            status: row.status as GraphStatus,
            currentNodes,
            completedNodes,
            failedNodes,
            waitingApprovalNodes,
            error: row.error_json ? JSON.parse(row.error_json) : inMem?.error,
            startedAt: new Date(row.started_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
            completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : inMem?.completedAt,
          };
        }
      } catch {
        // Fall back to memory
      }
    }
    return this.sessions.get(executionId) || null;
  }

  async getActiveSessionForGraph(graphId: string, planRevision: number): Promise<ExecutionSession | null> {
    for (const session of this.sessions.values()) {
      if (
        session.graphId === graphId &&
        session.planRevision === planRevision &&
        ["ready", "executing", "paused_for_approval"].includes(session.status)
      ) {
        return session;
      }
    }

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT execution_id FROM execution_sessions
           WHERE graph_id = $1 AND plan_revision = $2 AND status IN ('ready', 'executing', 'paused_for_approval')
           ORDER BY started_at DESC LIMIT 1`,
          [graphId, planRevision],
        );
        if (res.rows.length > 0) {
          return this.getExecutionSession(res.rows[0].execution_id);
        }
      } catch {
        // Fall back to memory
      }
    }

    return null;
  }

  async getSessionForGraph(graphId: string, planRevision: number): Promise<ExecutionSession | null> {
    for (const session of this.sessions.values()) {
      if (session.graphId === graphId && session.planRevision === planRevision) {
        return session;
      }
    }

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT execution_id FROM execution_sessions
           WHERE graph_id = $1 AND plan_revision = $2
           ORDER BY started_at DESC LIMIT 1`,
          [graphId, planRevision],
        );
        if (res.rows.length > 0) {
          return this.getExecutionSession(res.rows[0].execution_id);
        }
      } catch {
        // Fall back to memory
      }
    }

    return null;
  }

  // --- Atomic Claiming & Distributed Leases ---

  async claimNodeAtomic(params: {
    executionId: string;
    graphId: string;
    planRevision: number;
    nodeId: string;
    workerId: string;
    attempt: number;
    leaseDurationMs: number;
  }): Promise<{ claimed: boolean; lease?: ExecutionLease; reason?: string }> {
    const leaseKey = `${params.graphId}:r${params.planRevision}:${params.nodeId}`;
    const now = Date.now();
    const expiresAt = new Date(now + params.leaseDurationMs);

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN;");

          // Atomic claim using conditional upsert with row-level locking
          const res = await client.query(
            `INSERT INTO execution_leases (
              lease_key, execution_id, graph_id, plan_revision, node_id, worker_id, attempt, claimed_at, lease_expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
            ON CONFLICT (lease_key) DO UPDATE SET
              execution_id = EXCLUDED.execution_id,
              worker_id = EXCLUDED.worker_id,
              attempt = EXCLUDED.attempt,
              claimed_at = NOW(),
              lease_expires_at = EXCLUDED.lease_expires_at
            WHERE execution_leases.lease_expires_at <= NOW() OR execution_leases.worker_id = EXCLUDED.worker_id
            RETURNING *;`,
            [
              leaseKey,
              params.executionId,
              params.graphId,
              params.planRevision,
              params.nodeId,
              params.workerId,
              params.attempt,
              expiresAt,
            ],
          );

          if (res.rows.length === 0) {
            await client.query("ROLLBACK;");
            return { claimed: false, reason: "LEASE_ACTIVE_ANOTHER_WORKER" };
          }

          await client.query("COMMIT;");
          const lease: ExecutionLease = {
            leaseKey,
            executionId: params.executionId,
            graphId: params.graphId,
            planRevision: params.planRevision,
            nodeId: params.nodeId,
            workerId: params.workerId,
            attempt: params.attempt,
            claimedAt: new Date(now).toISOString(),
            leaseExpiresAt: expiresAt.toISOString(),
          };
          this.leases.set(leaseKey, lease);
          return { claimed: true, lease };
        } catch (txErr) {
          await client.query("ROLLBACK;").catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
      } catch (err) {
        logger.warn({ err: String(err) }, "LEASE_DB_CLAIM_FALLBACK");
      }
    }

    // In-memory fallback
    const existing = this.leases.get(leaseKey);
    if (existing) {
      const exp = new Date(existing.leaseExpiresAt).getTime();
      if (exp > now && existing.workerId !== params.workerId) {
        return { claimed: false, reason: "LEASE_ACTIVE_ANOTHER_WORKER" };
      }
    }

    const lease: ExecutionLease = {
      leaseKey,
      executionId: params.executionId,
      graphId: params.graphId,
      planRevision: params.planRevision,
      nodeId: params.nodeId,
      workerId: params.workerId,
      attempt: params.attempt,
      claimedAt: new Date(now).toISOString(),
      leaseExpiresAt: expiresAt.toISOString(),
    };
    this.leases.set(leaseKey, lease);
    return { claimed: true, lease };
  }

  async verifyLeaseOwnership(leaseKey: string, workerId: string): Promise<boolean> {
    const now = Date.now();
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM execution_leases WHERE lease_key = $1 AND worker_id = $2 AND lease_expires_at > NOW()`,
          [leaseKey, workerId],
        );
        return res.rows.length > 0;
      } catch {
        // Fallback
      }
    }

    const existing = this.leases.get(leaseKey);
    if (!existing) return false;
    const exp = new Date(existing.leaseExpiresAt).getTime();
    return existing.workerId === workerId && exp > now;
  }

  async isNodeCompleted(graphId: string, planRevision: number, nodeId: string): Promise<boolean> {
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT 1 FROM node_executions WHERE graph_id = $1 AND plan_revision = $2 AND node_id = $3 AND status = 'completed' LIMIT 1`,
          [graphId, planRevision, nodeId],
        );
        if (res.rows.length > 0) return true;
      } catch {
        // Fallback
      }
    }

    for (const attempt of this.nodeExecutions.values()) {
      if (
        attempt.graphId === graphId &&
        attempt.planRevision === planRevision &&
        attempt.nodeId === nodeId &&
        attempt.status === "completed"
      ) {
        return true;
      }
    }
    return false;
  }

  async releaseLease(leaseKey: string, workerId?: string): Promise<void> {
    if (workerId) {
      const existing = this.leases.get(leaseKey);
      if (existing && existing.workerId === workerId) {
        this.leases.delete(leaseKey);
      }
    } else {
      this.leases.delete(leaseKey);
    }

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        if (workerId) {
          await pool.query(
            `DELETE FROM execution_leases WHERE lease_key = $1 AND worker_id = $2`,
            [leaseKey, workerId],
          );
        } else {
          await pool.query(`DELETE FROM execution_leases WHERE lease_key = $1`, [leaseKey]);
        }
      } catch {
        // Fallback
      }
    }
  }

  async cleanExpiredLeases(): Promise<number> {
    const nowMs = Date.now();
    let cleaned = 0;
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(`DELETE FROM execution_leases WHERE lease_expires_at <= NOW()`);
        cleaned = res.rowCount ?? 0;
      } catch {
        // Fallback
      }
    }

    for (const [key, lease] of this.leases.entries()) {
      if (new Date(lease.leaseExpiresAt).getTime() <= nowMs) {
        this.leases.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  // --- Node Execution Records & Idempotency ---

  async recordNodeExecution(attempt: NodeExecutionAttempt): Promise<void> {
    this.nodeExecutions.set(attempt.idempotencyKey, JSON.parse(JSON.stringify(attempt)));

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO node_executions (
            execution_id, graph_id, plan_revision, node_id, attempt, idempotency_key,
            status, worker_id, result_json, error_code, error_message, is_retryable, started_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (idempotency_key) DO UPDATE SET
            status = $7,
            worker_id = $8,
            result_json = $9,
            error_code = $10,
            error_message = $11,
            is_retryable = $12,
            completed_at = $14`,
          [
            attempt.executionId,
            attempt.graphId,
            attempt.planRevision,
            attempt.nodeId,
            attempt.attempt,
            attempt.idempotencyKey,
            attempt.status,
            attempt.workerId ?? null,
            attempt.result ? JSON.stringify(attempt.result) : null,
            attempt.error?.code ?? null,
            attempt.error?.message ?? null,
            attempt.isRetryable,
            new Date(attempt.startedAt),
            attempt.completedAt ? new Date(attempt.completedAt) : null,
          ],
        );
      } catch (err) {
        logger.warn({ err: String(err) }, "NODE_EXECUTION_DB_SAVE_FALLBACK");
      }
    }
  }

  async getNodeExecution(idempotencyKey: string): Promise<NodeExecutionAttempt | null> {
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM node_executions WHERE idempotency_key = $1 LIMIT 1`,
          [idempotencyKey],
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            executionId: row.execution_id,
            graphId: row.graph_id,
            planRevision: Number(row.plan_revision),
            nodeId: row.node_id,
            attempt: Number(row.attempt),
            idempotencyKey: row.idempotency_key,
            status: row.status as NodeStatus,
            workerId: row.worker_id ?? undefined,
            result: row.result_json ? JSON.parse(row.result_json) : undefined,
            error: row.error_code
              ? {
                  code: row.error_code,
                  message: row.error_message || "",
                  retryable: row.is_retryable,
                  category: "unknown",
                }
              : undefined,
            isRetryable: row.is_retryable,
            startedAt: new Date(row.started_at).toISOString(),
            completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
          };
        }
      } catch {
        // Fallback
      }
    }
    return this.nodeExecutions.get(idempotencyKey) || null;
  }

  async getCompletedExecutionsForGraph(
    graphId: string,
    planRevision: number,
  ): Promise<NodeExecutionAttempt[]> {
    const results: NodeExecutionAttempt[] = [];
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM node_executions
           WHERE graph_id = $1 AND plan_revision = $2 AND status = 'completed'
           ORDER BY started_at ASC`,
          [graphId, planRevision],
        );
        for (const row of res.rows) {
          results.push({
            executionId: row.execution_id,
            graphId: row.graph_id,
            planRevision: Number(row.plan_revision),
            nodeId: row.node_id,
            attempt: Number(row.attempt),
            idempotencyKey: row.idempotency_key,
            status: row.status as NodeStatus,
            workerId: row.worker_id ?? undefined,
            result: row.result_json ? JSON.parse(row.result_json) : undefined,
            isRetryable: row.is_retryable,
            startedAt: new Date(row.started_at).toISOString(),
            completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
          });
        }
        if (results.length > 0) return results;
      } catch {
        // Fallback
      }
    }

    for (const execution of this.nodeExecutions.values()) {
      if (
        execution.graphId === graphId &&
        execution.planRevision === planRevision &&
        execution.status === "completed"
      ) {
        results.push(execution);
      }
    }
    return results;
  }

  // --- Stale Lease Recovery ---

  async findStaleLeases(): Promise<ExecutionLease[]> {
    const now = Date.now();
    const stale: ExecutionLease[] = [];

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM execution_leases WHERE lease_expires_at <= NOW()`,
        );
        for (const row of res.rows) {
          stale.push({
            leaseKey: row.lease_key,
            executionId: row.execution_id,
            graphId: row.graph_id,
            planRevision: Number(row.plan_revision),
            nodeId: row.node_id,
            workerId: row.worker_id,
            attempt: Number(row.attempt),
            claimedAt: new Date(row.claimed_at).toISOString(),
            leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
          });
        }
        if (stale.length > 0) return stale;
      } catch {
        // Fallback
      }
    }

    for (const lease of this.leases.values()) {
      if (new Date(lease.leaseExpiresAt).getTime() <= now) {
        stale.push(lease);
      }
    }
    return stale;
  }

  // --- Approvals ---

  async upsertApproval(approval: StoredApproval): Promise<void> {
    const key = `${approval.graphId}:r${approval.planRevision}:${approval.nodeId}`;
    this.approvals.set(key, JSON.parse(JSON.stringify(approval)));

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO execution_approvals (
            approval_id, telegram_user_id, graph_id, plan_revision, node_id, status, reason, requested_at, resolved_at, expires_at, resolved_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (approval_id) DO UPDATE SET
            status = $6,
            reason = $7,
            resolved_at = $9,
            resolved_by_user_id = $11`,
          [
            approval.approvalId,
            approval.telegramUserId,
            approval.graphId,
            approval.planRevision,
            approval.nodeId,
            approval.status,
            approval.reason,
            new Date(approval.requestedAt),
            approval.resolvedAt ? new Date(approval.resolvedAt) : null,
            approval.expiresAt ? new Date(approval.expiresAt) : null,
            approval.resolvedByUserId ?? null,
          ],
        );
      } catch (err) {
        logger.warn({ err: String(err) }, "APPROVAL_DB_SAVE_FALLBACK");
      }
    }
  }

  async getApproval(
    graphId: string,
    planRevision: number,
    nodeId: string,
  ): Promise<StoredApproval | null> {
    const key = `${graphId}:r${planRevision}:${nodeId}`;
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT * FROM execution_approvals
           WHERE graph_id = $1 AND plan_revision = $2 AND node_id = $3 LIMIT 1`,
          [graphId, planRevision, nodeId],
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            approvalId: row.approval_id,
            telegramUserId: Number(row.telegram_user_id),
            graphId: row.graph_id,
            planRevision: Number(row.plan_revision),
            nodeId: row.node_id,
            status: row.status as StoredApproval["status"],
            reason: row.reason,
            requestedAt: new Date(row.requested_at).toISOString(),
            resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
            expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
            resolvedByUserId: row.resolved_by_user_id ? Number(row.resolved_by_user_id) : undefined,
          };
        }
      } catch {
        // Fallback
      }
    }
    return this.approvals.get(key) || null;
  }

  clear(): void {
    this.sessions.clear();
    this.nodeExecutions.clear();
    this.leases.clear();
    this.approvals.clear();
  }

  clearForTesting(): void {
    this.clear();
    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        pool.query(
          "DELETE FROM execution_leases; DELETE FROM node_executions; DELETE FROM execution_approvals; DELETE FROM execution_sessions;",
        ).catch(() => {});
      } catch {
        // Fallback
      }
    }
  }
}

export const executionPersistence = ExecutionPersistenceService.getInstance();
