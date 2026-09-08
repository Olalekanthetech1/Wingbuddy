import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { MemoryService } from "../../services/memory.service";
import { retryEngine } from "../resilience/retry-engine";

export class MemoryNodeExecutor implements INodeExecutor {
  constructor(private readonly memoryService = new MemoryService()) {}

  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, resolvedInputs, executionContext, signal } = params;

    const key =
      (resolvedInputs.key as string) ||
      (node.memorySpec?.key as string) ||
      (node.actionSpec?.parameters?.key as string);
    const content =
      (resolvedInputs.content as string) ||
      (node.memorySpec?.content as string) ||
      (node.actionSpec?.parameters?.content as string);

    if (!key || !content) {
      return {
        success: false,
        error: {
          code: "INVALID_MEMORY_PAYLOAD",
          message: `Memory write node "${node.id}" requires both "key" and "content".`,
          retryable: false,
          category: "validation",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const timeoutMs = node.timeoutMs || 15_000;

    try {
      const saved = await retryEngine.withTimeout(
        async (timeoutSignal) => {
          if (signal.aborted || timeoutSignal.aborted) {
            throw new Error("Execution was aborted before memory write.");
          }

          return await this.memoryService.saveMemory({
            telegramUserId: executionContext.telegramUserId,
            key,
            content,
            type: "important_context",
            category: (resolvedInputs.category as string) || node.memorySpec?.category || "workflow",
            confidence: "high",
            importance: "high",
          });
        },
        timeoutMs,
        `Memory node "${node.id}"`,
      );

      return {
        success: true,
        output: {
          key,
          saved: !!saved,
          memoryId: saved?.id,
          timestamp: new Date().toISOString(),
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    } catch (err) {
      const classified = retryEngine.classifyError(err);
      return {
        success: false,
        error: classified,
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  }
}
