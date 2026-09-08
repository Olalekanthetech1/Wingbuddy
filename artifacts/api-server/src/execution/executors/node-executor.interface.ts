import type { GraphNode, NodeResult } from "../../planner/types";
import type { ExecutionContext } from "../types";

export interface NodeExecutionParams {
  node: GraphNode;
  graphId: string;
  planRevision: number;
  executionId: string;
  attempt: number;
  resolvedInputs: Record<string, unknown>;
  executionContext: ExecutionContext;
  signal: AbortSignal;
}

export interface INodeExecutor {
  execute(params: NodeExecutionParams): Promise<NodeResult>;
}
