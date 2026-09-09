import type { GeminiService } from "../gemini/gemini.service";
import { MODE_KEYS, MODES, type ModeKey, type Capability } from "../config/mode";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import {
  semanticInteractionCache,
  type SemanticInteractionDecision,
  type SemanticTaskIntent,
} from "./semantic-interaction-cache.service";

const INTENTS = [
  "greeting",
  "image_generation",
  "video_generation",
  "search_grounding",
  "deep_reasoning",
  "coding",
  "study",
  "writing",
  "brainstorming",
  "general",
] as const;

const COMPLEXITIES = ["simple", "moderate", "complex", "multi_step"] as const;
const TASK_INTENTS: SemanticTaskIntent[] = [
  "NEW_TASK",
  "CONTINUE_TASK",
  "PAUSE_TASK",
  "COMPLETE_TASK",
  "CANCEL_TASK",
  "VIEW_TASKS",
  "NO_TASK",
];

function jsonOnlyPrompt(
  request: string,
  persistentMode: ModeKey,
  history: Array<{ role: string; content: string }>,
): string {
  const modeProfiles = MODE_KEYS.map((key) => {
    const profile = MODES[key];
    return `${key}: ${profile.description}; capabilities=${profile.capabilitiesList.join(",")}; researchPolicy=${profile.researchPolicy}; codingPolicy=${profile.codingPolicy}; tutoringPolicy=${profile.tutoringPolicy}`;
  }).join("\n");
  const recent = history.slice(-8).map((item) => `${item.role}: ${item.content}`).join("\n");

  return [
    "Interpret the user's current request for an adaptive AI-assistant runtime.",
    "Infer meaning from the complete turn and recent conversation. Do not use keyword presence, regex rules, fixed phrase matching, or substring heuristics.",
    "Return ONLY one valid JSON object and no markdown.",
    "Available intent contract:", INTENTS.join(", "),
    "Available canonical modes:", MODE_KEYS.join(", "),
    "Available capability contract:", "tutoring,active_recall,socratic_questioning,code_generation,code_analysis,debugging,web_research,source_verification,document_analysis,mathematical_reasoning,image_analysis,file_generation,memory,calculator",
    "Available task intent contract:", TASK_INTENTS.join(", "),
    "Conversation operation contract:", "new_request,answer_about_artifact,extract_lesson,deepen,simplify,shorten,expand,continue,generate_variant,compare,clarify_reference,transform,other",
    "Mode profiles:", modeProfiles,
    `Persistent mode: ${persistentMode}`,
    `Recent conversation:\n${recent || "(none)"}`,
    `Current request:\n${request}`,
    "JSON schema: { intent, effectiveMode, requiredCapabilities, enableSearch, thinkingLevel, isModeSwitch, requestedMode, cleanedPrompt, isGreeting, complexity, confidence, taskIntent, taskTitle, taskGoal, taskIdHint, taskSteps, conversationOperation, conversationTargetHistoryIndices, unresolvedReference }",
    "Rules: explicit slash commands are handled separately by Telegram. Natural-language mode changes must be semantic. If the user is continuing or transforming a prior answer/story/example/etc., resolve the conversation operation and reference by context. If the user is creating, pausing, continuing, completing, cancelling, or viewing a task, resolve taskIntent semantically. A request for current/external evidence must set enableSearch=true. A simple social greeting should be greeting with no search and low/no thinking. Never authorize tools or destructive actions from this classification step.",
  ].join("\n\n");
}

function sanitizeDecision(raw: unknown, fallbackMode: ModeKey): SemanticInteractionDecision {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = INTENTS.includes(data.intent as (typeof INTENTS)[number])
    ? data.intent as SemanticInteractionDecision["intent"]
    : "general";
  const effectiveMode = MODE_KEYS.includes(data.effectiveMode as ModeKey)
    ? data.effectiveMode as ModeKey
    : fallbackMode;
  const requestedMode = MODE_KEYS.includes(data.requestedMode as ModeKey)
    ? data.requestedMode as ModeKey
    : undefined;
  const requiredCapabilities = Array.isArray(data.requiredCapabilities)
    ? data.requiredCapabilities.filter((cap): cap is Capability => typeof cap === "string")
    : [];
  const thinkingLevel = data.thinkingLevel === "LOW" || data.thinkingLevel === "MEDIUM" || data.thinkingLevel === "HIGH"
    ? data.thinkingLevel
    : undefined;
  const complexity = COMPLEXITIES.includes(data.complexity as (typeof COMPLEXITIES)[number])
    ? data.complexity as SemanticInteractionDecision["complexity"]
    : "simple";
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
  const isModeSwitch = Boolean(data.isModeSwitch && requestedMode);
  const isGreeting = Boolean(data.isGreeting) || intent === "greeting";
  const enableSearch = Boolean(data.enableSearch) || requiredCapabilities.includes("web_research");
  const taskIntent = TASK_INTENTS.includes(data.taskIntent as SemanticTaskIntent)
    ? data.taskIntent as SemanticTaskIntent
    : "NO_TASK";
  const taskIdHint = Number.isInteger(Number(data.taskIdHint)) ? Number(data.taskIdHint) : undefined;
  const taskSteps = Array.isArray(data.taskSteps)
    ? data.taskSteps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).map((step) => step.trim()).slice(0, 20)
    : undefined;
  const conversationTargetHistoryIndices = Array.isArray(data.conversationTargetHistoryIndices)
    ? data.conversationTargetHistoryIndices.filter((index): index is number => Number.isInteger(Number(index))).map(Number).slice(0, 6)
    : undefined;

  return {
    intent,
    effectiveMode,
    requiredCapabilities: Array.from(new Set(requiredCapabilities)),
    enableSearch,
    thinkingLevel,
    isModeSwitch,
    requestedMode,
    cleanedPrompt: typeof data.cleanedPrompt === "string" && data.cleanedPrompt.trim() ? data.cleanedPrompt.trim() : undefined,
    isGreeting,
    complexity,
    confidence,
    taskIntent,
    taskTitle: typeof data.taskTitle === "string" && data.taskTitle.trim() ? data.taskTitle.trim().slice(0, 500) : undefined,
    taskGoal: typeof data.taskGoal === "string" && data.taskGoal.trim() ? data.taskGoal.trim().slice(0, 2000) : undefined,
    taskIdHint,
    taskSteps,
    conversationOperation: typeof data.conversationOperation === "string" && data.conversationOperation.trim()
      ? data.conversationOperation.trim()
      : "new_request",
    conversationTargetHistoryIndices,
    unresolvedReference: typeof data.unresolvedReference === "string" && data.unresolvedReference.trim()
      ? data.unresolvedReference.trim().slice(0, 1000)
      : undefined,
  };
}

export class SemanticInteractionResolverService {
  static async resolve(params: {
    text: string;
    persistentMode: ModeKey;
    history?: Array<{ role: string; content: string }>;
    gemini: GeminiService;
  }): Promise<SemanticInteractionDecision> {
    const history = params.history || [];
    const cached = semanticInteractionCache.get(params.text, params.persistentMode, history);
    if (cached) return cached;

    const profile = MODES[params.persistentMode] || MODES.general;
    const fallback: SemanticInteractionDecision = {
      intent: "general",
      effectiveMode: params.persistentMode,
      requiredCapabilities: Array.from(profile.capabilitiesList),
      enableSearch: profile.researchPolicy === "always",
      thinkingLevel: profile.capabilities.thinkingLevelDefault,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: 0,
      taskIntent: "NO_TASK",
      conversationOperation: "new_request",
    };

    try {
      const raw = await params.gemini.generateReply(
        [],
        jsonOnlyPrompt(params.text, params.persistentMode, history),
        "Return the classification JSON only. Do not add explanations.",
        { isExtraction: true, mode: "auto" },
      );
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const decision = sanitizeDecision(parsed, params.persistentMode);
      semanticInteractionCache.set(params.text, params.persistentMode, history, decision);
      return decision;
    } catch (error) {
      logger.warn(
        { error: safeErrorMetadata(error) },
        "Semantic interaction resolution unavailable; using conservative mode-policy fallback",
      );
      semanticInteractionCache.set(params.text, params.persistentMode, history, fallback);
      return fallback;
    }
  }

  static getCached(text: string, persistentMode: ModeKey, history: Array<{ role: string; content: string }> = []): SemanticInteractionDecision | undefined {
    return semanticInteractionCache.get(text, persistentMode, history);
  }
}
