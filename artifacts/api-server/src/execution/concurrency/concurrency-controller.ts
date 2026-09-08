import { getExecutionConfig } from "../config";
import { executionPersistence } from "../persistence/execution-persistence.service";

export interface ConcurrencyCheckResult {
  allowed: boolean;
  reason?: string;
}

export class ConcurrencyController {
  private static instance: ConcurrencyController;

  // Active execution counters (per node / session)
  private activeGlobalCount = 0;
  private readonly activePerUser = new Map<number, number>();
  private readonly activePerGraph = new Map<string, number>();
  private readonly activePerTool = new Map<string, number>();

  public static getInstance(): ConcurrencyController {
    if (!ConcurrencyController.instance) {
      ConcurrencyController.instance = new ConcurrencyController();
    }
    return ConcurrencyController.instance;
  }

  /**
   * Evaluates whether a new node execution can be scheduled based on concurrency capacity.
   */
  canExecute(params: {
    telegramUserId: number;
    graphId: string;
    toolName?: string;
  }): ConcurrencyCheckResult {
    const config = getExecutionConfig();

    if (this.activeGlobalCount >= config.maxConcurrency) {
      return {
        allowed: false,
        reason: `Global concurrency limit reached (${this.activeGlobalCount}/${config.maxConcurrency}).`,
      };
    }

    const userCount = this.activePerUser.get(params.telegramUserId) || 0;
    if (userCount >= config.maxPerUser) {
      return {
        allowed: false,
        reason: `User concurrency limit reached (${userCount}/${config.maxPerUser}).`,
      };
    }

    const graphCount = this.activePerGraph.get(params.graphId) || 0;
    if (graphCount >= config.maxPerGraph) {
      return {
        allowed: false,
        reason: `Graph concurrency limit reached (${graphCount}/${config.maxPerGraph}).`,
      };
    }

    if (params.toolName) {
      const toolCount = this.activePerTool.get(params.toolName) || 0;
      if (toolCount >= config.maxPerTool) {
        return {
          allowed: false,
          reason: `Tool concurrency limit reached for "${params.toolName}" (${toolCount}/${config.maxPerTool}).`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Acquires a concurrency slot for an executing node.
   */
  acquireSlot(params: {
    telegramUserId: number;
    graphId: string;
    toolName?: string;
  }): void {
    this.activeGlobalCount++;
    this.activePerUser.set(
      params.telegramUserId,
      (this.activePerUser.get(params.telegramUserId) || 0) + 1,
    );
    this.activePerGraph.set(
      params.graphId,
      (this.activePerGraph.get(params.graphId) || 0) + 1,
    );
    if (params.toolName) {
      this.activePerTool.set(
        params.toolName,
        (this.activePerTool.get(params.toolName) || 0) + 1,
      );
    }
  }

  /**
   * Releases an acquired concurrency slot upon node completion or failure.
   */
  releaseSlot(params: {
    telegramUserId: number;
    graphId: string;
    toolName?: string;
  }): void {
    this.activeGlobalCount = Math.max(0, this.activeGlobalCount - 1);

    const userCount = this.activePerUser.get(params.telegramUserId) || 0;
    if (userCount <= 1) {
      this.activePerUser.delete(params.telegramUserId);
    } else {
      this.activePerUser.set(params.telegramUserId, userCount - 1);
    }

    const graphCount = this.activePerGraph.get(params.graphId) || 0;
    if (graphCount <= 1) {
      this.activePerGraph.delete(params.graphId);
    } else {
      this.activePerGraph.set(params.graphId, graphCount - 1);
    }

    if (params.toolName) {
      const toolCount = this.activePerTool.get(params.toolName) || 0;
      if (toolCount <= 1) {
        this.activePerTool.delete(params.toolName);
      } else {
        this.activePerTool.set(params.toolName, toolCount - 1);
      }
    }
  }

  reset(): void {
    this.activeGlobalCount = 0;
    this.activePerUser.clear();
    this.activePerGraph.clear();
    this.activePerTool.clear();
  }
}

export const concurrencyController = ConcurrencyController.getInstance();
