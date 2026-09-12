import type {
  ExecutionGraph,
  GraphNode,
  GraphEdge,
  NodeResult,
} from "../../planner/types";

export interface NodeResolutionState {
  completedNodeIds: Set<string>;
  failedNodeIds: Set<string>;
  skippedNodeIds: Set<string>;
  runningNodeIds: Set<string>;
  waitingApprovalNodeIds: Set<string>;
}

export interface ReadyResolution {
  readyNodes: GraphNode[];
  newlySkippedNodeIds: string[];
  isTerminal: boolean;
  terminalStatus?: "completed" | "failed" | "paused_for_approval";
}

export class ReadyNodeResolver {
  /**
   * Deterministically identifies which nodes are ready for dispatch.
   */
  resolveReadyNodes(
    graph: ExecutionGraph,
    state: NodeResolutionState,
  ): ReadyResolution {
    const readyNodes: GraphNode[] = [];
    const newlySkippedNodeIds: string[] = [];

    // Map of incoming edges per target node (toNodeId)
    const incomingEdgesByTarget = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
      const list = incomingEdgesByTarget.get(edge.toNodeId) || [];
      list.push(edge);
      incomingEdgesByTarget.set(edge.toNodeId, list);
    }

    const allNodeKeys = Object.keys(graph.nodes);

    for (const nodeId of allNodeKeys) {
      const node = graph.nodes[nodeId];

      // Skip already finished or running nodes
      if (
        state.completedNodeIds.has(nodeId) ||
        state.failedNodeIds.has(nodeId) ||
        state.skippedNodeIds.has(nodeId) ||
        state.runningNodeIds.has(nodeId) ||
        state.waitingApprovalNodeIds.has(nodeId)
      ) {
        continue;
      }

      const incomingEdges = incomingEdgesByTarget.get(nodeId) || [];

      // Check incoming dependencies
      let allSatisfied = true;
      let shouldSkip = false;

      for (const edge of incomingEdges) {
        const sourceId = edge.fromNodeId;
        const dependencyType = edge.dependencyType || "hard";

        if (dependencyType === "hard") {
          // Hard dependency: Source MUST be completed successfully
          if (state.failedNodeIds.has(sourceId) || state.skippedNodeIds.has(sourceId)) {
            // Broken critical path for this node
            shouldSkip = true;
            allSatisfied = false;
            break;
          }
          if (!state.completedNodeIds.has(sourceId)) {
            allSatisfied = false;
            break;
          }
        } else if (dependencyType === "soft") {
          // Soft dependency: Source must be completed or failed
          const isDone =
            state.completedNodeIds.has(sourceId) ||
            state.failedNodeIds.has(sourceId) ||
            state.skippedNodeIds.has(sourceId);
          if (!isDone) {
            allSatisfied = false;
            break;
          }
        } else if (dependencyType === "conditional") {
          // Conditional dependency
          if (!state.completedNodeIds.has(sourceId)) {
            allSatisfied = false;
            break;
          }
        }
      }

      if (shouldSkip) {
        newlySkippedNodeIds.push(nodeId);
        continue;
      }

      if (allSatisfied) {
        readyNodes.push(node);
      }
    }

    // Sort ready nodes deterministically by NodeId ascending
    readyNodes.sort((a, b) => a.id.localeCompare(b.id));

    // Check if graph reached terminal state
    const processedCount =
      state.completedNodeIds.size +
      state.failedNodeIds.size +
      state.skippedNodeIds.size +
      newlySkippedNodeIds.length;

    let isTerminal = false;
    let terminalStatus: "completed" | "failed" | "paused_for_approval" | undefined;

    if (state.waitingApprovalNodeIds.size > 0 && readyNodes.length === 0 && state.runningNodeIds.size === 0) {
      isTerminal = true;
      terminalStatus = "paused_for_approval";
    } else if (readyNodes.length === 0 && state.runningNodeIds.size === 0) {
      isTerminal = true;
      terminalStatus = (state.failedNodeIds.size > 0 || processedCount < allNodeKeys.length) ? "failed" : "completed";
      // Ensure all unreached nodes are accounted for
      if (processedCount < allNodeKeys.length) {
        for (const nodeId of allNodeKeys) {
          if (
            !state.completedNodeIds.has(nodeId) &&
            !state.failedNodeIds.has(nodeId) &&
            !state.skippedNodeIds.has(nodeId) &&
            !newlySkippedNodeIds.includes(nodeId)
          ) {
            newlySkippedNodeIds.push(nodeId);
          }
        }
      }
    }

    return {
      readyNodes,
      newlySkippedNodeIds,
      isTerminal,
      terminalStatus,
    };
  }

  /**
   * Helper: computes all ancestor node IDs for a target node via BFS.
   */
  getAncestorNodeIds(targetNodeId: string, graph: ExecutionGraph): Set<string> {
    const ancestors = new Set<string>();
    const queue: string[] = [targetNodeId];

    const parentsByTarget = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const parents = parentsByTarget.get(edge.toNodeId) || [];
      parents.push(edge.fromNodeId);
      parentsByTarget.set(edge.toNodeId, parents);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = parentsByTarget.get(current) || [];
      for (const parent of parents) {
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          queue.push(parent);
        }
      }
    }

    return ancestors;
  }
}

export const readyNodeResolver = new ReadyNodeResolver();
