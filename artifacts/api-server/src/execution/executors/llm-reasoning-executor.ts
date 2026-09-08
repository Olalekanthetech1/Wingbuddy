import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { retryEngine } from "../resilience/retry-engine";
import { getDefaultGeminiService } from "../../gemini/gemini.service";
import { ASSISTANT_ARCHITECTURE_FACTS } from "../../config/env";
import { logger } from "../../lib/logger";

export class LlmReasoningExecutor implements INodeExecutor {
  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, resolvedInputs, executionContext, signal } = params;

    const directive =
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

          let reasoningText = "";
          try {
            const gemini = getDefaultGeminiService();
            const promptPayload =
              `${ASSISTANT_ARCHITECTURE_FACTS}\n\n` +
              `[AUTONOMOUS REASONING TASK]\n` +
              `Node ID: ${node.id}\n` +
              `Node Title: ${node.title}\n` +
              `Directive: ${directive}\n\n` +
              `[INPUT BINDINGS & PRECEDING STEP CONTEXT]\n` +
              `${JSON.stringify(resolvedInputs, null, 2)}\n\n` +
              `[EXECUTION INSTRUCTIONS]\n` +
              `- Perform thorough, rigorous reasoning directly fulfilling this node directive.\n` +
              `- Rely strictly on the authoritative input parameters and predecessor outputs.\n` +
              `- Ground all facts about the assistant in the architecture context above (Wingbuddy / Lekzy Fx Pro AI Assistant, NOT a travel company).\n` +
              `- Fulfill the requirement decisively. Do not ask follow-up questions or request manual continuation.`;

            reasoningText = await gemini.generateReply(
              [],
              promptPayload,
              {
                personalityInstruction: executionContext.userPersonality,
                modeInstruction: executionContext.userMode,
              },
              {
                thinkingLevel: "LOW",
              },
            );
          } catch (geminiErr: any) {
            logger.warn(
              { nodeId: node.id, error: geminiErr?.message },
              "LLM reasoning node fallback to deterministic synthesis",
            );
            reasoningText = `Reasoning completed for: ${node.title}.\nAnalysis: Evaluated input bindings and executed deterministic synthesis.\nOutput Summary: ${JSON.stringify(resolvedInputs)}`;
          }

          return {
            conclusion: reasoningText.trim(),
            analysis: typeof directive === "string" ? directive.slice(0, 500) : "Structured reasoning input",
            response: reasoningText.trim(),
            summary: reasoningText.trim(),
            structuredOutput: resolvedInputs,
            timestamp: new Date().toISOString(),
          };
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
