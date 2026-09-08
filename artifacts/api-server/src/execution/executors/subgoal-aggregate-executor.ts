import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { executionPersistence } from "../persistence/execution-persistence.service";

export class SubgoalAggregateExecutor implements INodeExecutor {
  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, graphId, planRevision, resolvedInputs } = params;

    // Fetch authoritative completed results from database / persistence
    const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(
      graphId,
      planRevision,
    );

    const aggregated: Record<string, unknown> = {};
    for (const attempt of completedAttempts) {
      if (attempt.result?.output !== undefined) {
        aggregated[attempt.nodeId] = attempt.result.output;
      }
    }

    return {
      success: true,
      output: {
        summary: `Aggregated results for subgoal: ${node.title}`,
        nodeResults: aggregated,
        parameters: resolvedInputs,
      },
      metadata: { durationMs: Date.now() - startTime },
    };
  }
}
