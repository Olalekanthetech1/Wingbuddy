import type { GeminiMessage } from "../gemini/gemini.service";
import type { Capability } from "../config/mode";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";

export type AutonomyRoute = "direct" | "autonomous" | "clarify" | "fallback";

export interface AutonomyDecisionInput {
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  effectiveMode?: string;
  activeTask?: {
    id: number;
    goal: string;
    status?: string;
    currentStep?: number;
  } | null;
  capabilities?: Capability[];
  mediaPresent?: boolean;
}

export interface AutonomyDecision {
  route: AutonomyRoute;
  confidence: number;
  rationale: string;
  executionReasons: string[];
}

interface DecisionPayload {
  route?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  executionReasons?: unknown;
}

/**
 * Determines whether a turn should remain conversational or enter the durable
 * execution system. This is deliberately model-backed and context-aware.
 *
 * The model may choose the route, but it never controls execution safety,
 * approvals, capability authorization, retry limits, or resource ceilings.
 */
export class AutonomyDecisionService {
  constructor(
    private readonly generateStructured: (
      history: GeminiMessage[],
      message: string,
    ) => Promise<string>,
  ) {}

  async decide(input: AutonomyDecisionInput): Promise<AutonomyDecision> {
    const message = input.userMessage.trim();
    if (!message) {
      return {
        route: "direct",
        confidence: 1,
        rationale: "Empty conversational turn does not require execution.",
        executionReasons: [],
      };
    }

    try {
      const history = (input.history || [])
        .filter((turn) => /^(user|model|assistant)$/i.test(turn.role) && turn.content?.trim())
        .slice(-12)
        .map((turn) => ({
          role: (turn.role.toLowerCase() === "assistant" ? "model" : turn.role.toLowerCase()) as "user" | "model",
          content: turn.content.slice(-6000),
        }));

      const decisionPrompt = this.buildDecisionPrompt(input);
      const raw = await this.generateStructured(history, decisionPrompt);
      const parsed = this.parseDecision(raw);

      logger.info(
        {
          route: parsed.route,
          confidence: parsed.confidence,
          reasonCount: parsed.executionReasons.length,
          activeTask: Boolean(input.activeTask),
          mediaPresent: Boolean(input.mediaPresent),
        },
        "AUTONOMY_DECISION_COMPLETED",
      );

      return parsed;
    } catch (error) {
      logger.warn(
        { error: safeErrorMetadata(error) },
        "Autonomy decision model unavailable; deferring to existing planner path",
      );

      return {
        route: "fallback",
        confidence: 0,
        rationale: "Dynamic autonomy classification was unavailable; preserve existing planner behavior rather than inventing a route.",
        executionReasons: [],
      };
    }
  }

  private buildDecisionPrompt(input: AutonomyDecisionInput): string {
    const activeTask = input.activeTask
      ? JSON.stringify({
          id: input.activeTask.id,
          goal: input.activeTask.goal,
          status: input.activeTask.status,
          currentStep: input.activeTask.currentStep,
        })
      : "none";

    return [
      "Classify the user's CURRENT turn for an AI assistant that has two execution paths: direct conversation and durable autonomous execution.",
      "Return ONLY valid JSON. Do not use markdown, code fences, commentary, or additional keys.",
      "",
      "Schema:",
      '{"route":"direct|autonomous|clarify","confidence":0,"rationale":"...","executionReasons":["..."]}',
      "",
      "Decision semantics:",
      "- direct: answer conversationally in the current turn. No durable multi-step orchestration is needed.",
      "- autonomous: the user's goal materially benefits from durable execution state, multiple dependent actions, external tool orchestration, persistent artifact/task progression, verification across steps, or continuation of an active workflow.",
      "- clarify: a material ambiguity blocks safe selection between otherwise meaningful execution paths; do not ask for clarification merely because the request is open-ended.",
      "",
      "Important:",
      "- Do NOT classify based only on message length, number of sentences, or isolated keywords.",
      "- A long story, essay, explanation, brainstorming answer, lesson, or creative response can still be direct.",
      "- A request can be autonomous even if the user never says 'task' when it clearly requires coordinated external actions or durable progress.",
      "- A short request can be autonomous when it requires real external work, persistent state, approvals, or verification.",
      "- An active task is strong contextual evidence for autonomous continuation, but a simple conversational question about the task can remain direct when no execution is requested.",
      "- Never infer destructive authorization. Authorization and safety checks are handled separately by the execution system.",
      "",
      `Current mode: ${input.effectiveMode || "unknown"}`,
      `Active task: ${activeTask}`,
      `Capabilities already resolved for this turn: ${JSON.stringify(input.capabilities || [])}`,
      `Media present: ${Boolean(input.mediaPresent)}`,
      "",
      `CURRENT USER TURN:\n${input.userMessage}`,
    ].join("\n");
  }

  private parseDecision(raw: string): AutonomyDecision {
    const json = this.extractJson(raw);
    const payload = JSON.parse(json) as DecisionPayload;
    const route = payload.route;

    if (route !== "direct" && route !== "autonomous" && route !== "clarify") {
      throw new Error("Autonomy model returned an invalid route.");
    }

    const confidenceNumber = Number(payload.confidence);
    const confidence = Number.isFinite(confidenceNumber)
      ? Math.max(0, Math.min(1, confidenceNumber))
      : 0;

    const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
    const executionReasons = Array.isArray(payload.executionReasons)
      ? payload.executionReasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).map((reason) => reason.trim()).slice(0, 12)
      : [];

    if (!rationale) {
      throw new Error("Autonomy model returned no rationale.");
    }

    return { route, confidence, rationale, executionReasons };
  }

  private extractJson(raw: string): string {
    const trimmed = raw.trim();
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      JSON.parse(withoutFence);
      return withoutFence;
    } catch {}

    const firstBrace = withoutFence.indexOf("{");
    const lastBrace = withoutFence.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = withoutFence.slice(firstBrace, lastBrace + 1);
      JSON.parse(candidate);
      return candidate;
    }

    throw new Error("Autonomy model did not return a JSON object.");
  }
}
