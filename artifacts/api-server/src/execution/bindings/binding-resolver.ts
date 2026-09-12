import type {
  ExecutionGraph,
  GraphNode,
  InputBinding,
  NodeResult,
} from "../../planner/types";
import type { ExecutionContext } from "../types";

export interface ResolvedInputs {
  parameters: Record<string, unknown>;
}

const ALLOWLISTED_CONTEXT_PATHS = new Set([
  "user.id",
  "user.telegramUserId",
  "user.telegram_user_id",
  "user.mode",
  "user.personality",
  "task.id",
  "task.goal",
  "task.title",
  "request.id",
  "conversation.id",
  "timestamp",
]);

const FORBIDDEN_TOKENS = [
  "process",
  "env",
  "__proto__",
  "prototype",
  "constructor",
  "eval",
  "function",
  "fs",
  "child_process",
  "require",
  "import",
  "database",
  "password",
  "token",
  "secret",
  "key",
];

export class BindingResolver {
  /**
   * Resolves all input bindings for a target node against ancestor node results and execution context.
   */
  resolveNodeInputs(
    node: GraphNode,
    graph: ExecutionGraph,
    completedResults: Record<string, NodeResult>,
    context: ExecutionContext,
    ancestorNodeIds: Set<string>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    // Start with static actionSpec parameters if defined
    if (node.actionSpec?.parameters) {
      Object.assign(resolved, JSON.parse(JSON.stringify(node.actionSpec.parameters)));
    }

    for (const [paramName, binding] of Object.entries(node.inputBindings || {})) {
      resolved[paramName] = this.resolveSingleBinding(
        paramName,
        binding,
        graph,
        completedResults,
        context,
        ancestorNodeIds,
      );
    }

    return resolved;
  }

  private resolveSingleBinding(
    paramName: string,
    binding: InputBinding,
    graph: ExecutionGraph,
    completedResults: Record<string, NodeResult>,
    context: ExecutionContext,
    ancestorNodeIds: Set<string>,
  ): unknown {
    const { source } = binding;

    switch (source.type) {
      case "literal": {
        if (source.value === undefined) {
          throw new Error(`Invalid literal binding for parameter "${paramName}": value is undefined.`);
        }
        return this.interpolateLiteral(
          JSON.parse(JSON.stringify(source.value)),
          graph,
          completedResults,
          ancestorNodeIds,
          paramName
        );
      }

      case "node_output": {
        const { nodeId, path } = source;
        return this.resolveNodeOutput(nodeId, path, graph, completedResults, ancestorNodeIds, paramName);
      }

      case "context": {
        const { path } = source;
        return this.resolveContextPath(path, context, paramName);
      }

      default: {
        throw new Error(
          `Unsupported input binding source type for parameter "${paramName}".`,
        );
      }
    }
  }

  private interpolateLiteral(
    value: unknown,
    graph: ExecutionGraph,
    completedResults: Record<string, NodeResult>,
    ancestorNodeIds: Set<string>,
    paramName: string
  ): unknown {
    if (typeof value === "string") {
      const regex = /\{\{steps\.([^.]+)\.output\.?([^}]*)\}\}/g;
      
      // Fast path for exact match to preserve object types
      const exactMatch = value.match(/^\{\{steps\.([^.]+)\.output\.?([^}]*)\}\}$/);
      if (exactMatch) {
        const nodeId = exactMatch[1];
        const path = exactMatch[2] || "";
        return this.resolveNodeOutput(nodeId, path, graph, completedResults, ancestorNodeIds, paramName);
      }

      // String interpolation for mixed content
      return value.replace(regex, (match, nodeId, path) => {
        const resolved = this.resolveNodeOutput(nodeId, path, graph, completedResults, ancestorNodeIds, paramName);
        if (typeof resolved === "object") {
          return JSON.stringify(resolved);
        }
        return String(resolved);
      });
    }

    if (Array.isArray(value)) {
      return value.map(v => this.interpolateLiteral(v, graph, completedResults, ancestorNodeIds, paramName));
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.interpolateLiteral(v, graph, completedResults, ancestorNodeIds, paramName);
      }
      return result;
    }

    return value;
  }

  private resolveNodeOutput(
    nodeId: string,
    path: string,
    graph: ExecutionGraph,
    completedResults: Record<string, NodeResult>,
    ancestorNodeIds: Set<string>,
    paramName: string
  ): unknown {
    const referencedNode = graph.nodes[nodeId];
    if (!referencedNode) {
      throw new Error(`Invalid binding for parameter "${paramName}": referenced node "${nodeId}" does not exist in graph.`);
    }
    if (!ancestorNodeIds.has(nodeId)) {
      throw new Error(`Security violation: parameter "${paramName}" attempts forward or non-ancestor reference to "${nodeId}".`);
    }
    const nodeResult = completedResults[nodeId];
    if (!nodeResult || !nodeResult.success) {
      throw new Error(`Binding failure for parameter "${paramName}": referenced ancestor node "${nodeId}" has not completed successfully.`);
    }
    return this.extractPathValue(nodeResult.output, path, nodeId, paramName);
  }

  private extractPathValue(
    root: unknown,
    path: string,
    sourceNodeId: string,
    paramName: string,
  ): unknown {
    if (!path || path === "$" || path === "output" || path === ".") {
      return root;
    }

    const segments = path
      .replace(/^\$\.?/, "")
      .replace(/^output\.?/, "")
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);

    let current: any = root;
    for (const segment of segments) {
      if (current === null || current === undefined) {
        throw new Error(
          `Binding path resolution failure: path "${path}" does not exist on output of node "${sourceNodeId}" for parameter "${paramName}".`,
        );
      }

      // Check prototype pollution guard
      if (segment === "__proto__" || segment === "prototype" || segment === "constructor") {
        throw new Error(`Security violation: illegal access to prototype property "${segment}".`);
      }

      current = current[segment];
    }

    if (current === undefined) {
      throw new Error(
        `Binding path resolution failure: path "${path}" resolved to undefined on node "${sourceNodeId}" for parameter "${paramName}".`,
      );
    }

    return current;
  }

  private resolveContextPath(path: string, context: ExecutionContext, paramName: string): unknown {
    const normalized = path.trim().toLowerCase();

    // Enforce security token ban
    for (const token of FORBIDDEN_TOKENS) {
      if (normalized.includes(token) && !ALLOWLISTED_CONTEXT_PATHS.has(normalized)) {
        throw new Error(
          `Security violation: forbidden context path "${path}" requested for parameter "${paramName}".`,
        );
      }
    }

    // Must be in strict allowlist
    if (!ALLOWLISTED_CONTEXT_PATHS.has(normalized)) {
      throw new Error(
        `Security violation: context path "${path}" is not allowlisted for parameter "${paramName}".`,
      );
    }

    switch (normalized) {
      case "user.id":
      case "user.telegramuserid":
      case "user.telegram_user_id":
        return context.telegramUserId;
      case "user.mode":
        return context.userMode ?? "general";
      case "user.personality":
        return context.userPersonality ?? "helpful";
      case "conversation.id":
        return context.conversationId ?? 0;
      case "timestamp":
        return new Date().toISOString();
      default:
        throw new Error(`Context path "${path}" cannot be resolved.`);
    }
  }
}

export const bindingResolver = new BindingResolver();
