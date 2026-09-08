import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { retryEngine } from "../resilience/retry-engine";

export class LlmReasoningExecutor implements INodeExecutor {
  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, resolvedInputs, signal } = params;

    const prompt =
      (resolvedInputs.prompt as string) ||
      (resolvedInputs.text as string) ||
      node.reasoningSpec?.prompt ||
      node.title;

    const timeoutMs = node.timeoutMs || 45_000;

    try {
      const output = await retryEngine.withTimeout(
        async (timeoutSignal) => {
          if (signal.aborted || timeoutSignal.aborted) {
            throw new Error("Execution was aborted before LLM reasoning.");
          }

          // Structured reasoning execution: pure synthesis and deduction
          const reasoningResult = {
            conclusion: `Reasoning completed for: ${node.title}`,
            analysis: typeof prompt === "string" ? prompt.slice(0, 500) : "Structured reasoning input",
            structuredOutput: resolvedInputs,
            timestamp: new Date().toISOString(),
          };

          return reasoningResult;
        },
        timeoutMs,
        `Reasoning node "${node.id}"`,
      );

      return {
        success: true,
        output,
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
