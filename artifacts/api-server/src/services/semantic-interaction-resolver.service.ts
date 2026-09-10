import type { GeminiService } from "../gemini/gemini.service";
import { MODE_KEYS, MODES, type ModeKey, type Capability } from "../config/mode";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import {
  semanticInteractionCache,
  type SemanticInteractionDecision,
  type SemanticTaskIntent,
  type PromptType,
  type RequestExecutionProfile,
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

const PROMPT_TYPES: PromptType[] = [
  "DIRECT_COMMAND",
  "QUESTION",
  "CONTEXTUAL",
  "FEW_SHOT",
  "ZERO_SHOT",
  "REASONING",
  "ROLE_BASED",
  "CONVERSATIONAL",
  "MULTI_STEP",
  "CONSTRAINT_DRIVEN",
];

const EXECUTION_PROFILES: RequestExecutionProfile[] = [
  "conversational",
  "one_shot",
  "durable",
  "clarification",
  "unknown",
];

const DURABILITY_EVIDENCE = [
  "EXPLICIT_TASK_TRACKING",
  "EXPLICIT_PERSISTENCE",
  "SCHEDULED_WORK",
  "RECURRING_WORK",
  "CONTINUE_EXISTING_TASK",
  "BACKGROUND_EXECUTION",
  "MULTI_TURN_WORKFLOW",
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

function availableCapabilities(): Capability[] {
  return Array.from(
    new Set(
      MODE_KEYS.flatMap((key) => {
        const profile = MODES[key];
        return profile?.capabilitiesList ?? [];
      }),
    ),
  ) as Capability[];
}

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
  const capabilityContract = availableCapabilities().join(",");

  return [
    "Interpret the user's current request for an adaptive AI-assistant runtime.",
    "Infer meaning from the complete turn and recent conversation. Do not use keyword presence, regex rules, fixed phrase matching, substring heuristics, or message-length shortcuts.",
    "Return ONLY one valid JSON object and no markdown.",
    "Available intent contract:", INTENTS.join(", "),
    "Available prompt type contract:", PROMPT_TYPES.join(", "),
    "Available execution profile contract:", EXECUTION_PROFILES.join(", "),
    "Available canonical modes:", MODE_KEYS.join(", "),
    "Available capability contract (derived from the active mode registry):", capabilityContract,
    "Available task intent contract:", TASK_INTENTS.join(", "),
    "Durability evidence contract (return only evidence actually supported by the user's request):", DURABILITY_EVIDENCE.join(", "),
    "Conversation operation contract:", "new_request,answer_about_artifact,extract_lesson,deepen,simplify,shorten,expand,continue,generate_variant,compare,clarify_reference,transform,other",
    "Prompt taxonomy semantics:",
    "- DIRECT_COMMAND: the user asks the assistant to perform an operation or follow explicit instructions.",
    "- QUESTION: the main intent is to obtain information, explanation, or clarification.",
    "- CONTEXTUAL: meaningful background/data is supplied as part of the request and should influence the answer.",
    "- FEW_SHOT: examples/demonstrations are supplied to establish the desired mapping, style, or behavior for a new case.",
    "- ZERO_SHOT: the task is requested without demonstrations or examples intended as guidance.",
    "- REASONING: the request materially benefits from analysis, derivation, comparison, planning, or explicit reasoning policy.",
    "- ROLE_BASED: a persona, professional role, character, or viewpoint is assigned to shape the response.",
    "- CONVERSATIONAL: the turn is primarily dialogue, social interaction, follow-up discussion, or open-ended exchange rather than a durable action.",
    "- MULTI_STEP: the requested outcome contains multiple dependent transformations/actions that should be preserved as a sequence.",
    "- CONSTRAINT_DRIVEN: explicit output, length, format, style, scope, timing, or other constraints materially shape the requested result.",
    "A request may have multiple promptTypes; choose the most informative primaryPromptType rather than forcing a single label.",
    "ZERO_SHOT is a secondary structural label: use it when the user asks for a task without demonstrations, especially when there is no contextual example guidance. Do not label ordinary greetings as ZERO_SHOT.",
    "Execution semantics:",
    "- conversational: answer in the current conversation without durable orchestration.",
    "- one_shot: complete one bounded operation now, including immediate image/video/search/reasoning work, without persistent task state unless explicitly requested.",
    "- durable: persistent, trackable work, scheduled work, multi-stage external side effects, or workflows that must survive turns require a durable task/graph.",
    "- clarification: material information is missing or ambiguity makes safe execution unreliable.",
    "- unknown: classification confidence is too low to safely choose another profile.",
    "Task intent semantics: NEW_TASK and other task-management intents are reserved for persistent, trackable work that the assistant should maintain as a task/workflow across turns. Ordinary conversation, brainstorming, tutoring, roleplay, games, demonstrations, or a multi-step answer remain NO_TASK unless the user asks for persistent task tracking.",
    "Durability evidence semantics: durabilityEvidence MUST be empty unless the user explicitly requests persistence, scheduling, recurrence, background execution, continuation of an existing tracked task, multi-turn workflow state, or explicit task tracking. Prompt complexity, ZERO_SHOT, CONSTRAINT_DRIVEN, MULTI_STEP, file generation, media generation, dimensions, style, quality, or output count are NOT durability evidence by themselves.",
    "For image_generation and video_generation specifically, an immediate generation request is one_shot by default. Use durable only when concrete durability evidence is present in the user's request or an actual continuation/scheduling context exists.",
    "When an active task exists, CONTINUE_TASK is valid only when the current request is actually about that tracked task. Do not inherit unrelated active work.",
    `Persistent mode: ${persistentMode}`,
    `Recent conversation:\n${recent || "(none)"}`,
    `Current request:\n${request}`,
    "JSON schema: { intent, promptTypes, primaryPromptType, executionProfile, effectiveMode, requiredCapabilities, enableSearch, thinkingLevel, isModeSwitch, requestedMode, cleanedPrompt, isGreeting, complexity, confidence, taskIntent, taskTitle, taskGoal, taskIdHint, taskSteps, durabilityEvidence, conversationOperation, conversationTargetHistoryIndices, unresolvedReference }",
    "Do not authorize tools, external actions, approvals, destructive actions, or persistent storage from this classifier. It only resolves the semantic request profile; execution policy is enforced downstream.",
    `Available mode profiles:\n${modeProfiles}`,
  ].join("\n\n");
}

function sanitizeDecision(raw: unknown, fallbackMode: ModeKey): SemanticInteractionDecision {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = INTENTS.includes(data.intent as (typeof INTENTS)[number])
    ? data.intent as SemanticInteractionDecision["intent"]
    : "general";
  const promptTypes = Array.isArray(data.promptTypes)
    ? Array.from(new Set(data.promptTypes.filter((value): value is PromptType => typeof value === "string" && PROMPT_TYPES.includes(value as PromptType))))
    : [];
  const normalizedPromptTypes: PromptType[] = promptTypes.length > 0 ? promptTypes : ["DIRECT_COMMAND"];
  const primaryPromptType = typeof data.primaryPromptType === "string" && PROMPT_TYPES.includes(data.primaryPromptType as PromptType)
    ? data.primaryPromptType as PromptType
    : normalizedPromptTypes[0];
  const executionProfile = typeof data.executionProfile === "string" && EXECUTION_PROFILES.includes(data.executionProfile as RequestExecutionProfile)
    ? data.executionProfile as RequestExecutionProfile
    : (intent === "greeting" ? "conversational" : "unknown");
  const effectiveMode = MODE_KEYS.includes(data.effectiveMode as ModeKey)
    ? data.effectiveMode as ModeKey
    : fallbackMode;
  const requestedMode = MODE_KEYS.includes(data.requestedMode as ModeKey)
    ? data.requestedMode as ModeKey
    : undefined;
  const knownCapabilities = new Set<string>(availableCapabilities());
  const requiredCapabilities = Array.isArray(data.requiredCapabilities)
    ? data.requiredCapabilities.filter(
        (cap): cap is Capability => typeof cap === "string" && knownCapabilities.has(cap),
      )
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
  const candidateTaskIntent = TASK_INTENTS.includes(data.taskIntent as SemanticTaskIntent)
    ? data.taskIntent as SemanticTaskIntent
    : "NO_TASK";
  const taskTitle = typeof data.taskTitle === "string" && data.taskTitle.trim() ? data.taskTitle.trim().slice(0, 500) : undefined;
  const taskGoal = typeof data.taskGoal === "string" && data.taskGoal.trim() ? data.taskGoal.trim().slice(0, 2000) : undefined;
  const taskIntent = candidateTaskIntent !== "NO_TASK" && taskTitle ? candidateTaskIntent : "NO_TASK";
  const taskIdHint = Number.isInteger(Number(data.taskIdHint)) ? Number(data.taskIdHint) : undefined;
  const taskSteps = Array.isArray(data.taskSteps)
    ? data.taskSteps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).map((step) => step.trim()).slice(0, 20)
    : undefined;
  const durabilityEvidence = Array.isArray(data.durabilityEvidence)
    ? Array.from(new Set(data.durabilityEvidence.filter((evidence): evidence is (typeof DURABILITY_EVIDENCE)[number] => typeof evidence === "string" && DURABILITY_EVIDENCE.includes(evidence as (typeof DURABILITY_EVIDENCE)[number]))))
    : [];
  const conversationTargetHistoryIndices = Array.isArray(data.conversationTargetHistoryIndices)
    ? data.conversationTargetHistoryIndices.filter((index): index is number => Number.isInteger(Number(index))).map(Number).slice(0, 6)
    : undefined;

  const hasExamples = normalizedPromptTypes.includes("FEW_SHOT");
  const resolvedPromptTypes = hasExamples
    ? normalizedPromptTypes.filter((type) => type !== "ZERO_SHOT")
    : normalizedPromptTypes.includes("DIRECT_COMMAND") || normalizedPromptTypes.includes("QUESTION") || normalizedPromptTypes.includes("ROLE_BASED") || normalizedPromptTypes.includes("CONTEXTUAL")
      ? normalizedPromptTypes
      : Array.from(new Set([...normalizedPromptTypes, "ZERO_SHOT" as PromptType]));

  const resolvedExecutionProfile: RequestExecutionProfile =
    isGreeting || isModeSwitch || executionProfile === "conversational"
      ? "conversational"
      : taskIntent !== "NO_TASK"
        ? "durable"
        : executionProfile;

  return {
    intent,
    promptTypes: resolvedPromptTypes,
    primaryPromptType,
    executionProfile: resolvedExecutionProfile,
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
    taskTitle: taskIntent === "NO_TASK" ? undefined : taskTitle,
    taskGoal: taskIntent === "NO_TASK" ? undefined : taskGoal,
    taskIdHint: taskIntent === "NO_TASK" ? undefined : taskIdHint,
    taskSteps: taskIntent === "NO_TASK" ? undefined : taskSteps,
    durabilityEvidence,
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
      promptTypes: ["DIRECT_COMMAND"],
      primaryPromptType: "DIRECT_COMMAND",
      executionProfile: "unknown",
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
      durabilityEvidence: [],
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
      logger.info({ intent: decision.intent, promptTypes: decision.promptTypes, primaryPromptType: decision.primaryPromptType, executionProfile: decision.executionProfile, complexity: decision.complexity, confidence: decision.confidence, durabilityEvidence: decision.durabilityEvidence }, "PROMPT_INTENT_PROFILE_RESOLVED");
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
