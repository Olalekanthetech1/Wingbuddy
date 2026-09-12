import type { INodeExecutor, NodeExecutionParams } from "./node-executor.interface";
import type { NodeResult } from "../../planner/types";
import { executionPersistence } from "../persistence/execution-persistence.service";
import { adaptiveAIRouterService } from "../../services/adaptive-ai-router.service";
import { ASSISTANT_ARCHITECTURE_FACTS } from "../../config/env";
import { logger } from "../../lib/logger";

export class SubgoalAggregateExecutor implements INodeExecutor {
  async execute(params: NodeExecutionParams): Promise<NodeResult> {
    const startTime = Date.now();
    const { node, graphId, planRevision, resolvedInputs, executionContext } = params;

    // 1. Fetch authoritative completed results from database / persistence
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

    let synthesizedAnswer = "";
    let executedProvider = "adaptive-router";
    let executedModel = "auto";
    let executedReasons: string[] = [];

    try {
      const aggregationPrompt =
        `${ASSISTANT_ARCHITECTURE_FACTS}\n\n` +
        `[FINAL AUTONOMOUS AGGREGATION & SYNTHESIS]\n` +
        `Aggregation Node: ${node.id} (${node.title})\n\n` +
        `[AUTHORITATIVE PREDECESSOR NODE OUTPUTS]\n` +
        `${JSON.stringify(aggregated, null, 2)}\n\n` +
        `[RESOLVED INPUT PARAMETERS]\n` +
        `${JSON.stringify(resolvedInputs, null, 2)}\n\n` +
        `[INSTRUCTIONS FOR FINAL ANSWER]\n` +
        `- Synthesize the authoritative findings from preceding steps into a comprehensive, cohesive final response.\n` +
        `- Rely exclusively on verified findings and the assistant's real architecture (Wingbuddy / Lekzy Fx Pro AI Assistant, NOT a tour/travel company).\n` +
        `- Deliver a complete, definitive answer that fulfills the user's autonomous task.\n` +
        `- Do NOT append follow-up questions asking whether to proceed or requiring manual continuation.`;

      const routed = await adaptiveAIRouterService.route({
        systemInstruction: [
          executionContext.userPersonality ? `Personality: ${executionContext.userPersonality}` : "",
          executionContext.userMode ? `Mode: ${executionContext.userMode}` : "",
        ].filter(Boolean).join("\n"),
        messages: [{ role: "user", content: aggregationPrompt }],
      }, {
        isSystemTask: true,
      });

      synthesizedAnswer = routed.response.text;
      executedProvider = routed.candidate.model.provider;
      executedModel = routed.candidate.model.modelId;
      executedReasons = routed.candidate.reasons;
    } catch (routerErr: any) {
      logger.warn(
        { graphId, planRevision, error: routerErr?.message },
        "Subgoal aggregation fallback to structured summary",
      );
      synthesizedAnswer = `Aggregated results for ${node.title}:\n` +
        Object.entries(aggregated)
          .map(([id, out]: [string, any]) => `• ${id}: ${typeof out === "string" ? out : (out?.summary || out?.conclusion || JSON.stringify(out))}`)
          .join("\n");
    }

    return {
      success: true,
      output: {
        summary: synthesizedAnswer.trim(),
        response: synthesizedAnswer.trim(),
        nodeResults: aggregated,
        parameters: resolvedInputs,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        provider: executedProvider,
        model: executedModel,
        candidateReasons: executedReasons,
      },
    };
  }
}
