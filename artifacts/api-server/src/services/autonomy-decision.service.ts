import type { GeminiMessage } from "../gemini/gemini.service";
import type { Capability } from "../config/mode";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { semanticInteractionCache } from "./semantic-interaction-cache.service";

export type AutonomyRoute = "direct" | "autonomous" | "clarify" | "fallback";

export interface AutonomyDecisionInput {
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  effectiveMode?: string;
  activeTask?: { id: number; goal: string; status?: string; currentStep?: number } | null;
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

export class AutonomyDecisionService {
  constructor(
    private readonly generateStructured: (history: GeminiMessage[], message: string) => Promise<string>,
  ) {}

  async decide(input: AutonomyDecisionInput): Promise<AutonomyDecision> {
    const message = input.userMessage.trim();
    if (!message) return { route: "direct", confidence: 1, rationale: "Empty conversational turn does not require execution.", executionReasons: [] };

    const semanticDecision = this.getSemanticFastPath(input);
    if (semanticDecision) {
      logger.info(
        {
          route: "direct",
          confidence: semanticDecision.confidence,
          semanticIntent: semanticDecision.intent,
          complexity: semanticDecision.complexity,
          reasonCount: 1,
        },
        "AUTONOMY_DECISION_FAST_PATH",
      );
      return semanticDecision;
    }

    try {
      const history = (input.history || [])
        .filter((turn) => /^(user|model|assistant)$/i.test(turn.role) && turn.content?.trim())
        .slice(-12)
        .map((turn) => ({ role: (turn.role.toLowerCase() === "assistant" ? "model" : turn.role.toLowerCase()) as "user" | "model", content: turn.content.slice(-6000) }));
      const raw = await this.generateStructured(history, this.buildDecisionPrompt(input));
      const parsed = this.parseDecision(raw);
      logger.info({ route: parsed.route, confidence: parsed.confidence, reasonCount: parsed.executionReasons.length, activeTask: Boolean(input.activeTask), mediaPresent: Boolean(input.mediaPresent) }, "AUTONOMY_DECISION_COMPLETED");
      return parsed;
    } catch (error) {
      logger.warn({ error: safeErrorMetadata(error) }, "Autonomy decision model unavailable; preserving planner fallback safety");
      return { route: "fallback", confidence: 0, rationale: "Dynamic autonomy classification was unavailable; no autonomous action is authorized by the fallback.", executionReasons: [] };
    }
  }

  private getSemanticFastPath(input: AutonomyDecisionInput): AutonomyDecision | undefined {
    if (input.mediaPresent || input.activeTask) return undefined;

    const semantic = semanticInteractionCache.getLatestForText(input.userMessage);
    if (!semantic) return undefined;

    const autonomousIntents = new Set([
      "image_generation",
      "video_generation",
      "search_grounding",
      "deep_reasoning",
    ]);
    if (autonomousIntents.has(semantic.intent)) return undefined;
    if (semantic.enableSearch || semantic.thinkingLevel) return undefined;
    if (semantic.isModeSwitch || semantic.unresolvedReference) return undefined;
    if (semantic.taskIntent && semantic.taskIntent !== "NO_TASK") return undefined;
    if (semantic.conversationOperation && semantic.conversationOperation !== "new_request") return undefined;
    if (semantic.complexity !== "simple") return undefined;

    return {
      route: "direct",
      confidence: semantic.confidence,
      rationale: "Semantic interaction resolution identified a simple non-durable conversational turn; autonomous planning is unnecessary.",
      executionReasons: ["No durable action, tool execution, external evidence retrieval, or multi-step workflow is required."],
    };
  }

  private buildDecisionPrompt(input: AutonomyDecisionInput): string {
    const activeTask = input.activeTask ? JSON.stringify({ id: input.activeTask.id, goal: input.activeTask.goal, status: input.activeTask.status, currentStep: input.activeTask.currentStep }) : "none";
    return [
      "Classify the user's CURRENT turn for an AI assistant with direct conversation and durable autonomous execution.",
      "Return ONLY valid JSON. No markdown, code fences, commentary, or additional keys.",
      '{"route":"direct|autonomous|clarify","confidence":0,"rationale":"...","executionReasons":["..."]}',
      "",
      "Decision semantics:",
      "- direct: answer conversationally. No durable multi-step orchestration or persistent external action is required.",
      "- autonomous: perform durable work using registered tools, persisted tasks/artifacts, dependent actions, verification, or an active workflow that genuinely needs execution state.",
      "- clarify: required information or a material ambiguity is missing and executing now could create the wrong task, wrong schedule, wrong recipient, wrong artifact, or another irreversible/incorrect action.",
      "",
      "Safety and truthfulness rules:",
      "- Do not classify from message length, sentence count, isolated keywords, regex, or vocabulary rules.",
      "- Long explanations, stories, essays, lessons and brainstorming can remain direct.",
      "- Short requests can be autonomous when they require real durable action.",
      "- An active task supports autonomous continuation only when the current turn actually requests execution or progression.",
      "- When a durable action needs factual parameters that the assistant does not have, choose clarify rather than inventing values.",
      "- Never claim an action was persisted, scheduled, sent, completed, or saved unless the execution layer returns a verified successful tool result.",
      "- Never infer destructive authorization; approvals and capabilities are enforced outside this classifier.",
      "",
      `Current mode: ${input.effectiveMode || "unknown"}`,
      `Active task: ${activeTask}`,
      `Capabilities already resolved: ${JSON.stringify(input.capabilities || [])}`,
      `Media present: ${Boolean(input.mediaPresent)}`,
      `CURRENT USER TURN:\n${input.userMessage}`,
    ].join("\n");
  }

  private parseDecision(raw: string): AutonomyDecision {
    const json = this.extractJson(raw);
    const payload = JSON.parse(json) as DecisionPayload;
    if (payload.route !== "direct" && payload.route !== "autonomous" && payload.route !== "clarify") throw new Error("Autonomy model returned an invalid route.");
    const confidenceNumber = Number(payload.confidence);
    const confidence = Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(1, confidenceNumber)) : 0;
    const rationale = typeof payload.rationale === "string" ? payload.rationale.trim() : "";
    const executionReasons = Array.isArray(payload.executionReasons)
      ? payload.executionReasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0).map((reason) => reason.trim()).slice(0, 12)
      : [];
    if (!rationale) throw new Error("Autonomy model returned no rationale.");
    return { route: payload.route as "direct" | "autonomous" | "clarify", confidence, rationale, executionReasons };
  }

  private extractJson(raw: string): string {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try { JSON.parse(trimmed); return trimmed; } catch {}
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      JSON.parse(candidate);
      return candidate;
    }
    throw new Error("Autonomy model did not return a JSON object.");
  }
}
