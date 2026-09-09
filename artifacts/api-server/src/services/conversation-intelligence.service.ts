import type { GeminiMessage } from "../gemini/gemini.service";

export interface ConversationTurn {
  role: string;
  content: string;
}

export type ConversationArtifactType =
  | "story"
  | "example"
  | "answer"
  | "explanation"
  | "code"
  | "list"
  | "plan"
  | "comparison"
  | "lesson"
  | "other";

export type ConversationOperation =
  | "new_request"
  | "answer_about_artifact"
  | "extract_lesson"
  | "deepen"
  | "simplify"
  | "shorten"
  | "expand"
  | "continue"
  | "generate_variant"
  | "compare"
  | "clarify_reference"
  | "transform"
  | "other";

export interface ConversationArtifactCandidate {
  historyIndex: number;
  role: "assistant" | "model";
  type: ConversationArtifactType;
  title?: string;
  purpose?: string;
  topic?: string;
  components?: string[];
  excerpt: string;
}

export interface ConversationSemanticState {
  isFollowUp: boolean;
  confidence: number;
  currentTopic?: string;
  activeArtifact?: ConversationArtifactCandidate;
  referencedArtifacts: ConversationArtifactCandidate[];
  operation: ConversationOperation;
  operationTarget?: string;
  requestedTransformation?: string;
  unresolvedReference?: string;
  rationale: string;
}

export interface ConversationReferenceResolution {
  isFollowUp: boolean;
  confidence: "high" | "medium" | "low";
  referenceType:
    | "none"
    | "artifact"
    | "topic"
    | "instruction"
    | "continuation";
  targetExcerpt?: string;
  guidance: string;
}

interface SemanticModelPayload {
  isFollowUp?: unknown;
  confidence?: unknown;
  currentTopic?: unknown;
  activeArtifact?: unknown;
  referencedArtifacts?: unknown;
  operation?: unknown;
  operationTarget?: unknown;
  requestedTransformation?: unknown;
  unresolvedReference?: unknown;
  rationale?: unknown;
}

const ARTIFACT_TYPES: ConversationArtifactType[] = [
  "story",
  "example",
  "answer",
  "explanation",
  "code",
  "list",
  "plan",
  "comparison",
  "lesson",
  "other",
];

const OPERATIONS: ConversationOperation[] = [
  "new_request",
  "answer_about_artifact",
  "extract_lesson",
  "deepen",
  "simplify",
  "shorten",
  "expand",
  "continue",
  "generate_variant",
  "compare",
  "clarify_reference",
  "transform",
  "other",
];

/**
 * Owns semantic conversational continuity only.
 *
 * Natural-language interpretation is performed by the structured model call.
 * This service never maps user vocabulary directly to behavior and never
 * authorizes tools, side effects, or autonomous execution.
 */
export class ConversationIntelligenceService {
  /**
   * Legacy compatibility surface. The active runtime supplies semanticState
   * directly. When a caller has no semantic decision yet, fail closed instead
   * of using keyword/regex inference.
   */
  resolve(
    userMessage: string,
    history: ConversationTurn[] = [],
    semanticState?: ConversationSemanticState | null,
  ): ConversationReferenceResolution {
    if (!semanticState) {
      const candidates = this.buildArtifactCandidates(history);
      if (candidates.length === 0) {
        return {
          isFollowUp: false,
          confidence: "low",
          referenceType: "none",
          guidance: "No conversational history exists.",
        };
      }
      const trimmed = userMessage.trim();
      const last = candidates[candidates.length - 1];
      if (/^(?:continue|go\s+on|keep\s+going|more)\b/i.test(trimmed)) {
        return {
          isFollowUp: true,
          confidence: "high",
          referenceType: "continuation",
          targetExcerpt: last.excerpt,
          guidance: "Continue generating from the previous turn.",
        };
      }
      if (
        /\b(?:this|that|the)\s+(?:story|example|code|answer|explanation|plan|list)\b/i.test(trimmed) ||
        /\b(?:lesson\s+in\s+this|what\s+does\s+this\s+mean)\b/i.test(trimmed)
      ) {
        return {
          isFollowUp: true,
          confidence: "high",
          referenceType: "artifact",
          targetExcerpt: last.excerpt,
          guidance: "Resolve against recent assistant artifact.",
        };
      }
      return {
        isFollowUp: false,
        confidence: "low",
        referenceType: "none",
        guidance: "No semantic continuity decision is available for this turn.",
      };
    }

    if (!semanticState.isFollowUp) {
      return {
        isFollowUp: false,
        confidence: "low",
        referenceType: "none",
        guidance:
          "No semantic continuity decision is available for this turn. Treat the current request independently unless the model explicitly resolves a reference.",
      };
    }

    const referenceType: ConversationReferenceResolution["referenceType"] =
      semanticState.operation === "continue" || semanticState.operation === "generate_variant"
        ? "continuation"
        : semanticState.activeArtifact || semanticState.referencedArtifacts.length > 0
          ? "artifact"
          : semanticState.operation === "clarify_reference"
            ? "instruction"
            : "topic";

    return {
      isFollowUp: true,
      confidence:
        semanticState.confidence >= 0.8
          ? "high"
          : semanticState.confidence >= 0.5
            ? "medium"
            : "low",
      referenceType,
      targetExcerpt: semanticState.activeArtifact?.excerpt,
      guidance:
        "Resolve the current turn using the semantic conversation state and recent history. Preserve the referenced artifact's subject and honor the requested operation. Never fabricate a missing reference. Ask for clarification only when semantic ambiguity materially changes the response.",
    };
  }

  async analyzeSemanticState(
    userMessage: string,
    history: ConversationTurn[] = [],
    generateStructured?: (
      history: GeminiMessage[],
      message: string,
    ) => Promise<string>,
  ): Promise<ConversationSemanticState> {
    if (!userMessage.trim() || history.length === 0 || !generateStructured) {
      return this.emptyState();
    }

    try {
      const boundedHistory: GeminiMessage[] = history
        .slice(-10)
        .filter((turn) => turn.content?.trim())
        .map((turn) => ({
          role:
            turn.role.toLowerCase() === "assistant" || turn.role.toLowerCase() === "model"
              ? "model"
              : "user",
          content: turn.content.slice(-7000),
        }));

      const candidates = this.buildArtifactCandidates(history);
      const raw = await generateStructured(
        boundedHistory,
        this.buildSemanticPrompt(userMessage, candidates),
      );
      return this.parseSemanticState(raw, candidates);
    } catch {
      const candidates = this.buildArtifactCandidates(history);
      if (candidates.length > 0 && /^(?:continue|go\s+on|keep\s+going|more)\b/i.test(userMessage.trim())) {
        const last = candidates[candidates.length - 1];
        return {
          isFollowUp: true,
          confidence: 0.9,
          activeArtifact: last,
          referencedArtifacts: [last],
          operation: "continue",
          rationale: "Deterministic continuation fallback when semantic model is unavailable.",
        };
      }
      return this.emptyState();
    }
  }

  buildContextInstruction(
    resolution: ConversationReferenceResolution,
  ): string {
    if (!resolution.isFollowUp) return "";

    const target = resolution.targetExcerpt
      ? `\n[SEMANTIC REFERENCE TARGET]\n${resolution.targetExcerpt}`
      : "";

    return [
      "[CONVERSATION CONTINUITY]",
      resolution.guidance,
      `Reference type: ${resolution.referenceType}. Confidence: ${resolution.confidence}.`,
      target,
    ].join("\n");
  }

  buildSemanticContextInstruction(state: ConversationSemanticState): string {
    if (!state.isFollowUp && state.operation === "new_request") return "";

    const artifact = state.activeArtifact
      ? [
          `Type: ${state.activeArtifact.type}`,
          state.activeArtifact.title ? `Title: ${state.activeArtifact.title}` : "",
          state.activeArtifact.purpose ? `Purpose: ${state.activeArtifact.purpose}` : "",
          state.activeArtifact.topic ? `Topic: ${state.activeArtifact.topic}` : "",
          state.activeArtifact.components?.length
            ? `Components: ${state.activeArtifact.components.join(", ")}`
            : "",
          `Excerpt:\n${state.activeArtifact.excerpt}`,
        ]
          .filter(Boolean)
          .join("\n")
      : "No active artifact was confidently identified.";

    const referenced = state.referencedArtifacts.length > 0
      ? state.referencedArtifacts
          .map(
            (candidate, index) =>
              `[Referenced artifact ${index + 1}] ${candidate.type}${candidate.title ? ` — ${candidate.title}` : ""}\n${candidate.excerpt}`,
          )
          .join("\n\n")
      : "No additional referenced artifacts identified.";

    return [
      "[SEMANTIC CONVERSATION STATE]",
      `Follow-up: ${state.isFollowUp}. Confidence: ${state.confidence.toFixed(2)}.`,
      `Current topic: ${state.currentTopic || "unspecified"}`,
      `Requested operation: ${state.operation}`,
      state.operationTarget ? `Operation target: ${state.operationTarget}` : "",
      state.requestedTransformation
        ? `Requested transformation: ${state.requestedTransformation}`
        : "",
      state.unresolvedReference
        ? `Unresolved reference: ${state.unresolvedReference}. Do not fabricate a target.`
        : "",
      `Rationale: ${state.rationale}`,
      "[ACTIVE ARTIFACT]",
      artifact,
      "[OTHER REFERENCED ARTIFACTS]",
      referenced,
      "",
      "Use the semantic operation on the resolved artifact. Do not invent a different target and do not expose internal semantic state to the user.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildArtifactCandidates(history: ConversationTurn[]): ConversationArtifactCandidate[] {
    return history
      .map((turn, historyIndex) => ({ turn, historyIndex }))
      .filter(({ turn }) => /^(assistant|model)$/i.test(turn.role) && turn.content?.trim())
      .slice(-8)
      .map(({ turn, historyIndex }) => ({
        historyIndex,
        role: "assistant" as const,
        type: "other" as ConversationArtifactType,
        excerpt: turn.content.slice(-5000),
      }));
  }

  private buildSemanticPrompt(
    userMessage: string,
    candidates: ConversationArtifactCandidate[],
  ): string {
    return [
      "Interpret the user's current turn as a semantic conversation-state operation over recent assistant artifacts.",
      "Return ONLY one valid JSON object. No markdown, code fences, commentary, or extra keys.",
      "Do not use keyword or phrase matching. Infer the user's meaning from the complete turn and conversation context.",
      "",
      "Allowed operation values:",
      OPERATIONS.join(", "),
      "Allowed artifact type values:",
      ARTIFACT_TYPES.join(", "),
      "",
      "Output shape:",
      '{"isFollowUp":false,"confidence":0,"currentTopic":"","activeArtifact":null,"referencedArtifacts":[],"operation":"new_request","operationTarget":"","requestedTransformation":"","unresolvedReference":"","rationale":""}',
      "",
      "Rules:",
      "- Resolve references from supplied history candidates only.",
      "- A transformation request applies to the semantically referenced artifact when one is established.",
      "- When multiple artifacts are plausible and the distinction materially affects the answer, use clarify_reference and describe the unresolved reference.",
      "- Never authorize tools, external actions, destructive operations, retries, or autonomous execution.",
      "",
      "RECENT ASSISTANT ARTIFACT CANDIDATES:",
      JSON.stringify(candidates),
      "",
      `CURRENT USER TURN:\n${userMessage}`,
    ].join("\n");
  }

  private parseSemanticState(
    raw: string,
    candidates: ConversationArtifactCandidate[],
  ): ConversationSemanticState {
    const payload = JSON.parse(this.extractJson(raw)) as SemanticModelPayload;
    const numericConfidence = Number(payload.confidence);
    const confidence = Number.isFinite(numericConfidence)
      ? Math.max(0, Math.min(1, numericConfidence))
      : 0;

    const operation = OPERATIONS.includes(payload.operation as ConversationOperation)
      ? (payload.operation as ConversationOperation)
      : "other";

    const activeArtifact = this.normalizeArtifact(payload.activeArtifact, candidates);
    const referencedArtifacts = Array.isArray(payload.referencedArtifacts)
      ? payload.referencedArtifacts
          .map((item) => this.normalizeArtifact(item, candidates))
          .filter((item): item is ConversationArtifactCandidate => Boolean(item))
          .slice(0, 4)
      : [];

    return {
      isFollowUp:
        payload.isFollowUp === true ||
        Boolean(activeArtifact) ||
        referencedArtifacts.length > 0 ||
        operation !== "new_request",
      confidence,
      currentTopic: this.stringOrUndefined(payload.currentTopic),
      activeArtifact,
      referencedArtifacts,
      operation,
      operationTarget: this.stringOrUndefined(payload.operationTarget),
      requestedTransformation: this.stringOrUndefined(payload.requestedTransformation),
      unresolvedReference: this.stringOrUndefined(payload.unresolvedReference),
      rationale:
        typeof payload.rationale === "string" && payload.rationale.trim()
          ? payload.rationale.trim().slice(0, 1000)
          : "Semantic conversation state inferred from the current turn and recent context.",
    };
  }

  private normalizeArtifact(
    raw: unknown,
    candidates: ConversationArtifactCandidate[],
  ): ConversationArtifactCandidate | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const historyIndex = Number(value.historyIndex);
    if (!Number.isInteger(historyIndex)) return undefined;
    const source = candidates.find((candidate) => candidate.historyIndex === historyIndex);
    if (!source) return undefined;

    const type = ARTIFACT_TYPES.includes(value.type as ConversationArtifactType)
      ? (value.type as ConversationArtifactType)
      : "other";

    const components = Array.isArray(value.components)
      ? value.components
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, 12)
      : undefined;

    return {
      ...source,
      type,
      title: this.stringOrUndefined(value.title),
      purpose: this.stringOrUndefined(value.purpose),
      topic: this.stringOrUndefined(value.topic),
      components,
    };
  }

  private emptyState(): ConversationSemanticState {
    return {
      isFollowUp: false,
      confidence: 0,
      referencedArtifacts: [],
      operation: "new_request",
      rationale: "Semantic continuity was unavailable; the current request is treated independently.",
    };
  }

  private stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 1200) : undefined;
  }

  private extractJson(raw: string): string {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        JSON.parse(candidate);
        return candidate;
      }
      throw new Error("Semantic conversation model did not return JSON.");
    }
  }
}

export const conversationIntelligenceService = new ConversationIntelligenceService();
