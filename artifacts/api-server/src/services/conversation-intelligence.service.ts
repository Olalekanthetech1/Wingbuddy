export interface ConversationTurn {
  role: string;
  content: string;
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

/**
 * Lightweight, deterministic conversation-intelligence layer.
 *
 * This layer does not replace LLM reasoning and never decides safety-critical
 * execution policy. Its job is to preserve conversational continuity by
 * identifying contextual follow-ups and giving the response model an
 * explicit, bounded grounding target.
 */
export class ConversationIntelligenceService {
  private static readonly FOLLOW_UP_PATTERNS: RegExp[] = [
    /\b(this|that|the|it|they|them|those|these)\b.{0,40}\b(story|example|answer|explanation|point|part|section|idea|message|one|above|below)\b/i,
    /\b(what(?:'s| is)?|why|how|where|when|which)\s+(about|was|were|did|does|do|is|are)\s+(this|that|it|the (?:story|example|answer|point|part|one))\b/i,
    /\b(the lesson|the takeaway|the moral|the second one|the other one|the last part|the previous answer)\b/i,
    /^(continue|keep going|go on|carry on|more|another one|same for this|do the same|explain more|elaborate|shorten it|make it shorter|make it simpler)\b/i,
    /\b(as you said|like you said|what you said|you mentioned|you just said|you just told me|above)\b/i,
  ];

  static resolve(
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

    const isFollowUp = this.FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(message));
    if (!isFollowUp) {
      return {
        isFollowUp: false,
        confidence: "low",
        referenceType: "none",
        guidance: "Treat the current request as a new turn unless ordinary conversational context clearly indicates continuity.",
      };
    }

    const assistantTurns = history
      .filter((turn) => /^(assistant|model)$/i.test(turn.role) && turn.content?.trim())
      .slice(-6);
    const latestAssistant = assistantTurns.at(-1);
    const latestUser = [...history]
      .reverse()
      .find((turn) => /^user$/i.test(turn.role) && turn.content?.trim());

    let referenceType: ConversationReferenceResolution["referenceType"] = "topic";
    if (/\b(story|example|answer|explanation|point|part|section|lesson|takeaway|moral)\b/i.test(message)) {
      referenceType = "artifact";
    } else if (/\b(continue|keep going|go on|another one|do the same|shorten|simpler|elaborate)\b/i.test(message)) {
      referenceType = "continuation";
    } else if (/\b(you said|you mentioned|above|previous)\b/i.test(message)) {
      referenceType = "instruction";
    }

    const targetExcerpt = latestAssistant?.content?.slice(-1800) || latestUser?.content?.slice(-800);

    return {
      isFollowUp: true,
      confidence: latestAssistant ? "high" : "medium",
      referenceType,
      targetExcerpt,
      guidance:
        "Resolve contextual references against the most relevant recent conversation artifact before answering. Do not ask the user to repeat information that is already present in recent history. Prefer the immediately preceding assistant artifact when wording such as ‘this story’, ‘that answer’, ‘the lesson’, ‘the second point’, or ‘continue’ clearly refers to it. Only ask for clarification when multiple plausible targets remain and the ambiguity materially changes the answer.",
    };
  }

  static buildContextInstruction(
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
}

export const conversationIntelligenceService = new ConversationIntelligenceService();
