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
 * Conversation Intelligence owns semantic continuity, not execution safety.
 *
 * A model may interpret references and requested transformations, but all
 * execution authorization, capabilities, approvals, retries, and ceilings
 * remain outside this service.
 */
export class ConversationIntelligenceService {
  private static readonly FOLLOW_UP_PATTERNS: RegExp[] = [
    /\b(this|that|the|it|they|them|those|these)\b.{0,40}\b(story|example|answer|explanation|point|part|section|idea|message|one|above|below)\b/i,
    /\b(what(?:'s| is)?|why|how|where|when|which)\s+(about|was|were|did|does|do|is|are)\s+(this|that|it|the (?:story|example|answer|point|part|one))\b/i,
    /\b(the lesson|the takeaway|the moral|the second one|the other one|the last part|the previous answer)\b/i,
    /^(continue|keep going|go on|carry on|more|another one|same for this|do the same|explain more|elaborate|shorten it|make it shorter|make it simpler)\b/i,
    /\b(as you said|like you said|what you said|you mentioned|you just said|you just told me|above)\b/i,
  ];

  resolve(
    userMessage: string,
    history: ConversationTurn[] = [],
  ): ConversationReferenceResolution {
    const message = userMessage.trim();
    if (!message || history.length === 0) {
      return {
        isFollowUp: false,
        confidence: "low",
        referenceType: "none",
        guidance: "No prior conversational artifact is required for this turn.",
      };
    }

    const isFollowUp = ConversationIntelligenceService.FOLLOW_UP_PATTERNS.some((pattern) =>
      pattern.test(message),
    );

    if (!isFollowUp) {
      return {
        isFollowUp: false,
        confidence: "low",
        referenceType: "none",
        guidance:
          "Treat the current request as a new turn unless ordinary conversational context clearly indicates continuity.",
      };
    }

    const assistantTurns = history
      .map((turn, historyIndex) => ({ ...turn, historyIndex }))
      .filter((turn) => /^(assistant|model)$/i.test(turn.role) && turn.content?.trim())
      .slice(-8);
    const latestAssistant = assistantTurns.at(-1);
    const latestUser = [...history].reverse().find(
      (turn) => /^user$/i.test(turn.role) && turn.content?.trim(),
    );

    let referenceType: ConversationReferenceResolution["referenceType"] = "topic";
    if (
      /\b(story|example|answer|explanation|point|part|section|lesson|takeaway|moral)\b/i.test(
        message,
      )
    ) {
      referenceType = "artifact";
    } else if (
      /\b(continue|keep going|go on|another one|do the same|shorten|simpler|elaborate)\b/i.test(
        message,
      )
    ) {
      referenceType = "continuation";
    } else if (/\b(you said|you mentioned|above|previous)\b/i.test(message)) {
      referenceType = "instruction";
    }

    const targetExcerpt =
      latestAssistant?.content?.slice(-2400) || latestUser?.content?.slice(-1000);

    return {
      isFollowUp: true,
      confidence: latestAssistant ? "high" : "medium",
      referenceType,
      targetExcerpt,
      guidance:
        "Resolve contextual references against the most relevant recent conversation artifact before answering. Do not ask the user to repeat information already present in recent history. Prefer the immediately preceding assistant artifact when it is the only plausible target. Only ask for clarification when multiple plausible targets remain and the ambiguity materially changes the answer.",
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
    const fallback = this.buildFallbackSemanticState(userMessage, history);

    if (!userMessage.trim() || history.length === 0 || !generateStructured) {
      return fallback;
    }

    try {
      const boundedHistory = history
        .slice(-10)
        .filter((turn) => turn.content?.trim())
        .map((turn) => ({
          role: (turn.role.toLowerCase() === "assistant" || turn.role.toLowerCase() === "model" ? "model" : "user") as "user" | "model",
          content: turn.content.slice(-7000),
        }));

      const candidates = this.buildArtifactCandidates(history);
      const analysisPrompt = this.buildSemanticPrompt(userMessage, candidates);
      const raw = await generateStructured(boundedHistory, analysisPrompt);
      const parsed = this.parseSemanticState(raw, candidates);

      return parsed;
    } catch {
      return fallback;
    }
  }

  buildContextInstruction(
    resolution: ConversationReferenceResolution,
  ): string {
    if (!resolution.isFollowUp) return "";

    const target = resolution.targetExcerpt
      ? `\n[RECENT ARTIFACT TARGET]\n${resolution.targetExcerpt}`
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
      "Use this state to answer the user's actual operation on the resolved artifact. Do not substitute a neighboring concept merely because it sounds similar. Preserve the artifact's meaning unless the user explicitly requests a transformation. If the reference remains unresolved and materially changes the answer, ask one focused clarification question.",
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
      "Interpret the user's current turn as a conversation-state operation over recent assistant artifacts.",
      "Return ONLY one valid JSON object. No markdown, code fences, commentary, or extra keys.",
      "",
      "Schema:",
      '{"isFollowUp":true,"confidence":0.0,"currentTopic":"","activeArtifact":{"historyIndex":0,"type":"story|example|answer|explanation|code|list|plan|comparison|lesson|other","title":"","purpose":"","topic":"","components":[""],"excerpt":""},"referencedArtifacts":[],"operation":"new_request|answer_about_artifact|extract_lesson|deepen|simplify|shorten|expand|continue|generate_variant|compare|clarify_reference|transform|other","operationTarget":"","requestedTransformation":"","unresolvedReference":"","rationale":""}',
      "",
      "Interpretation rules:",
      "- Infer meaning from the whole conversation, not keyword matching.",
      "- A user request like 'what is the lesson in the story you just told?' is extract_lesson, not a request for a punchline.",
      "- 'Make it deeper' is a transformation of the currently referenced artifact or component; preserve its semantic subject.",
      "- 'Give me another one' means generate_variant using the prior artifact's topic/purpose/style when a clear target exists.",
      "- 'Compare the two' may reference multiple recent artifacts; include both when confidently identifiable.",
      "- Select activeArtifact/referencedArtifacts only from the supplied candidate history indices. Never invent history indices.",
      "- If a reference is materially ambiguous, set unresolvedReference and use clarify_reference.",
      "- The model is interpreting conversation only. It must not authorize tools, external actions, destructive operations, or autonomous execution.",
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
    const confidenceNumber = Number(payload.confidence);
    const confidence = Number.isFinite(confidenceNumber)
      ? Math.max(0, Math.min(1, confidenceNumber))
      : 0;

    const operation = OPERATIONS.includes(payload.operation as ConversationOperation)
      ? (payload.operation as ConversationOperation)
      : "other";

    const activeArtifact = this.normalizeArtifact(payload.activeArtifact, candidates);
    const referencedArtifacts = Array.isArray(payload.referencedArtifacts)
      ? payload.referencedArtifacts
          .map((candidate) => this.normalizeArtifact(candidate, candidates))
          .filter((candidate): candidate is ConversationArtifactCandidate => Boolean(candidate))
          .slice(0, 4)
      : [];

    const explicitFollowUp = payload.isFollowUp === true;
    const isFollowUp = explicitFollowUp || Boolean(activeArtifact) || referencedArtifacts.length > 0 || operation !== "new_request";
    const rationale = typeof payload.rationale === "string" && payload.rationale.trim()
      ? payload.rationale.trim().slice(0, 1000)
      : "Semantic conversation state inferred from the current turn and recent artifacts.";

    return {
      isFollowUp,
      confidence,
      currentTopic: this.stringOrUndefined(payload.currentTopic),
      activeArtifact,
      referencedArtifacts,
      operation,
      operationTarget: this.stringOrUndefined(payload.operationTarget),
      requestedTransformation: this.stringOrUndefined(payload.requestedTransformation),
      unresolvedReference: this.stringOrUndefined(payload.unresolvedReference),
      rationale,
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
      excerpt: source.excerpt,
    };
  }

  private buildFallbackSemanticState(
    userMessage: string,
    history: ConversationTurn[],
  ): ConversationSemanticState {
    const resolution = this.resolve(userMessage, history);
    const latestAssistantIndex = [...history]
      .map((turn, index) => ({ turn, index }))
      .reverse()
      .find(({ turn }) => /^(assistant|model)$/i.test(turn.role) && turn.content?.trim())?.index;

    const operation: ConversationOperation = resolution.isFollowUp
      ? /\b(lesson|takeaway|moral)\b/i.test(userMessage)
        ? "extract_lesson"
        : /\b(deep|deeper|elaborate|expand)\b/i.test(userMessage)
          ? "deepen"
          : /\b(short|shorten)\b/i.test(userMessage)
            ? "shorten"
            : /\b(continue|keep going|go on)\b/i.test(userMessage)
              ? "continue"
              : "answer_about_artifact"
      : "new_request";

    const activeArtifact = latestAssistantIndex !== undefined && resolution.isFollowUp
      ? {
          historyIndex: latestAssistantIndex,
          role: "assistant" as const,
          type: "other" as ConversationArtifactType,
          excerpt: history[latestAssistantIndex].content.slice(-5000),
        }
      : undefined;

    return {
      isFollowUp: resolution.isFollowUp,
      confidence: resolution.confidence === "high" ? 0.88 : resolution.confidence === "medium" ? 0.62 : 0.25,
      activeArtifact,
      referencedArtifacts: [],
      operation,
      operationTarget: resolution.referenceType === "none" ? undefined : "recent conversational artifact",
      rationale: resolution.guidance,
    };
  }

  private stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 1200) : undefined;
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

    throw new Error("Semantic conversation model did not return a JSON object.");
  }
}

export const conversationIntelligenceService = new ConversationIntelligenceService();
