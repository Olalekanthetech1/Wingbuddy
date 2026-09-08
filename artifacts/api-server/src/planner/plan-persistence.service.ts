import type { ExecutionGraph } from "./types";
import { logger } from "../lib/logger";
import { getPool } from "@workspace/db";

export class PlanPersistenceService {
  private static instance: PlanPersistenceService;

  // Primary store: revisionId -> deep-cloned immutable ExecutionGraph
  private readonly store = new Map<string, ExecutionGraph>();
  // Index: graphId -> list of revision numbers in order
  private readonly revisionIndex = new Map<string, number[]>();

  public static getInstance(): PlanPersistenceService {
    if (!PlanPersistenceService.instance) {
      PlanPersistenceService.instance = new PlanPersistenceService();
    }
    return PlanPersistenceService.instance;
  }

  private isDbAvailable(): boolean {
    try {
      return !!process.env.DATABASE_URL;
    } catch {
      return false;
    }
  }

  /**
   * Persists a validated ExecutionGraph.
   * Plan revisions are strictly immutable: attempting to overwrite an existing revision is rejected.
   */
  async saveGraph(graph: ExecutionGraph): Promise<void> {
    const { graphId, planRevision, revisionId } = graph;

    if (!graphId || !planRevision || !revisionId) {
      throw new Error(
        `Cannot persist execution graph: missing required identity fields (graphId: ${graphId}, planRevision: ${planRevision}, revisionId: ${revisionId}).`,
      );
    }

    if (this.store.has(revisionId)) {
      throw new Error(
        `Cannot persist plan revision "${revisionId}": plan revisions are strictly immutable and cannot be overwritten.`,
      );
    }

    // Freeze deep clone to guarantee memory immutability
    const deepClone: ExecutionGraph = JSON.parse(JSON.stringify(graph));
    Object.freeze(deepClone);
    Object.freeze(deepClone.nodes);
    Object.freeze(deepClone.edges);
    Object.freeze(deepClone.metadata);

    this.store.set(revisionId, deepClone);

    const revisions = this.revisionIndex.get(graphId) || [];
    if (!revisions.includes(planRevision)) {
      revisions.push(planRevision);
      revisions.sort((a, b) => a - b);
      this.revisionIndex.set(graphId, revisions);
    }

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO execution_graphs (graph_id, telegram_user_id, latest_revision, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (graph_id) DO UPDATE SET latest_revision = GREATEST(execution_graphs.latest_revision, $3), updated_at = NOW()`,
          [graph.graphId, graph.telegramUserId, graph.planRevision, graph.status],
        );
        await pool.query(
          `INSERT INTO graph_revisions (graph_id, plan_revision, revision_id, parent_revision_id, telegram_user_id, goal, status, graph_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (revision_id) DO NOTHING`,
          [
            graph.graphId,
            graph.planRevision,
            graph.revisionId,
            graph.parentRevisionId || null,
            graph.telegramUserId,
            graph.goal,
            graph.status,
            JSON.stringify(graph),
          ],
        );
      } catch (err) {
        logger.warn({ err: String(err) }, "POSTGRESQL_GRAPH_PERSISTENCE_FALLBACK");
      }
    }

    logger.info(
      {
        graphId,
        planRevision,
        revisionId,
        parentRevisionId: graph.parentRevisionId,
        stepCount: graph.metadata.derivedStepCount,
      },
      "PLAN_PERSISTED",
    );

    logger.info(
      {
        graphId,
        revisionId,
        planRevision,
      },
      "PLAN_REVISION_CREATED",
    );
  }

  /**
   * Retrieves an execution graph by graphId and optional revision number.
   * If planRevision is not specified, returns the latest revision.
   */
  async getGraph(graphId: string, planRevision?: number): Promise<ExecutionGraph | null> {
    if (planRevision !== undefined) {
      const revisionId = `${graphId}:r${planRevision}`;
      const cached = this.store.get(revisionId);
      if (cached) return cached;

      if (this.isDbAvailable()) {
        try {
          const pool = getPool();
          const res = await pool.query(
            `SELECT graph_json FROM graph_revisions WHERE revision_id = $1 LIMIT 1`,
            [revisionId],
          );
          if (res.rows.length > 0) {
            const loaded = JSON.parse(res.rows[0].graph_json) as ExecutionGraph;
            this.store.set(revisionId, loaded);
            return loaded;
          }
        } catch {
          // Fallback
        }
      }
      return null;
    }

    const revisions = this.revisionIndex.get(graphId);
    if (revisions && revisions.length > 0) {
      const latestRevision = revisions[revisions.length - 1];
      const latestRevisionId = `${graphId}:r${latestRevision}`;
      return this.store.get(latestRevisionId) || null;
    }

    if (this.isDbAvailable()) {
      try {
        const pool = getPool();
        const res = await pool.query(
          `SELECT graph_json FROM graph_revisions WHERE graph_id = $1 ORDER BY plan_revision DESC LIMIT 1`,
          [graphId],
        );
        if (res.rows.length > 0) {
          const loaded = JSON.parse(res.rows[0].graph_json) as ExecutionGraph;
          this.store.set(loaded.revisionId, loaded);
          return loaded;
        }
      } catch {
        // Fallback
      }
    }

    return null;
  }

  /**
   * Returns all revisions for a given graph in chronological ascending order.
   */
  async listRevisions(graphId: string): Promise<ExecutionGraph[]> {
    const revisions = this.revisionIndex.get(graphId) || [];
    const results: ExecutionGraph[] = [];

    for (const rev of revisions) {
      const g = this.store.get(`${graphId}:r${rev}`);
      if (g) results.push(g);
    }

    return results;
  }

  /**
   * Clears the store. Primarily for testing isolation.
   */
  clear(): void {
    this.store.clear();
    this.revisionIndex.clear();
  }

  clearForTesting(): void {
    this.clear();
  }
}

export const planPersistenceService = PlanPersistenceService.getInstance();
