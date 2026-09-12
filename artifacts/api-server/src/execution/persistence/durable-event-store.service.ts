import { getPool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { ExecutionEventType, DurableExecutionEvent } from "../planner/durable-execution-types";

export interface AppendEventParams {
  executionId: string;
  graphId?: string;
  planRevision?: number;
  nodeId?: string;
  eventType: ExecutionEventType;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export function sanitizeEventMetadata(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const sensitiveKeys = ["authorization", "apikey", "api_key", "token", "password", "secret", "bearer", "cookie"];

  function sanitizeValue(val: unknown, depth = 0): unknown {
    if (depth > 6) return "[Truncated]";
    if (val === null || val === undefined) return val;
    if (typeof val === "string") {
      if (val.toLowerCase().startsWith("bearer ") || val.toLowerCase().startsWith("tvly-") || val.toLowerCase().startsWith("ai-")) {
        return "[REDACTED]";
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map((v) => sanitizeValue(v, depth + 1));
    }
    if (typeof val === "object") {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
          cleaned[k] = "[REDACTED]";
        } else {
          cleaned[k] = sanitizeValue(v, depth + 1);
        }
      }
      return cleaned;
    }
    return val;
  }
  return sanitizeValue(data) as Record<string, unknown>;
}

export class DurableEventStoreService {
  async appendEvent(params: AppendEventParams): Promise<DurableExecutionEvent> {
    const sanitizedMeta = sanitizeEventMetadata(params.metadata);
    const pool = getPool();
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const { rows } = await pool.query(
      `
      INSERT INTO execution_events (
        event_id, execution_id, graph_id, plan_revision, node_id, event_type,
        sequence_number, actor, metadata_json, created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        COALESCE((SELECT MAX(sequence_number) FROM execution_events WHERE execution_id = $2), 0) + 1,
        $7, $8, NOW()
      )
      RETURNING id, event_id, execution_id, graph_id, plan_revision, node_id, event_type, sequence_number, actor, metadata_json, created_at
      `,
      [
        eventId,
        params.executionId,
        params.graphId || null,
        params.planRevision || null,
        params.nodeId || null,
        params.eventType,
        params.actor || "system",
        sanitizedMeta ? JSON.stringify(sanitizedMeta) : null,
      ]
    );

    const created = rows[0];
    logger.debug(
      { executionId: params.executionId, seq: created.sequence_number, eventType: params.eventType, nodeId: params.nodeId },
      "Appended execution event"
    );

    return {
      id: created.id.toString(),
      executionId: created.execution_id,
      graphId: created.graph_id || undefined,
      planRevision: created.plan_revision || undefined,
      nodeId: created.node_id || undefined,
      eventType: created.event_type as ExecutionEventType,
      sequenceNumber: created.sequence_number,
      actor: created.actor,
      metadata: created.metadata_json ? JSON.parse(created.metadata_json) : undefined,
      createdAt: created.created_at.toISOString(),
    };
  }

  async getSessionTimeline(executionId: string): Promise<DurableExecutionEvent[]> {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM execution_events WHERE execution_id = $1 ORDER BY sequence_number ASC`,
      [executionId]
    );

    return rows.map((e: any) => ({
      id: e.id.toString(),
      executionId: e.execution_id,
      graphId: e.graph_id || undefined,
      planRevision: e.plan_revision || undefined,
      nodeId: e.node_id || undefined,
      eventType: e.event_type as ExecutionEventType,
      sequenceNumber: e.sequence_number,
      actor: e.actor,
      metadata: e.metadata_json ? JSON.parse(e.metadata_json) : undefined,
      createdAt: e.created_at.toISOString(),
    }));
  }
}

export const durableEventStoreService = new DurableEventStoreService();
