import type { GeminiService } from "../gemini/gemini.service";
import { MODE_KEYS, MODES, type ModeKey, type Capability } from "../config/mode";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { semanticInteractionCache, type SemanticInteractionDecision } from "./semantic-interaction-cache.service";

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

function jsonOnlyPrompt(request: string, persistentMode: ModeKey, history: Array<{ role: string; content: string }>): string {
  const modeProfiles = MODE_KEYS.map((key) => {
    const profile = MODES[key];
    return `${key}: ${profile.description}; capabilities=${profile.capabilitiesList.join(",")}; researchPolicy=${profile.researchPolicy}; codingPolicy=${profile.codingPolicy}; tutoringPolicy=${profile.tutoringPolicy}`;
  }).join("\n");
  const recent = history.slice(-8).map((item) => `${item.role}: ${item.content}`).join("\n");
  return [
    "Classify the user's current request for an AI assistant execution router.",
    "Use the whole request and recent conversation context. Infer intent semantically; do not classify by keyword presence or fixed phrase matching.",
    "Return ONLY JSON matching the requested fields. Do not include markdown.",
    "Available intents:", INTENTS.join(", "),
    "Available canonical modes:", MODE_KEYS.join(", "),
    "Available capabilities:", "tutoring,active_recall,socratic_questioning,code_generation,code_analysis,debugging,web_research,source_verification,document_analysis,mathematical_reasoning,image_analysis,file_generation,memory,calculator",
    "Mode profiles:", modeProfiles,
    `Persistent mode: ${persistentMode}`,
    `Recent conversation:\n${recent || "(none)"}`,
    `Current request:\n${request}`,
    "JSON schema: { intent, effectiveMode, requiredCapabilities, enableSearch, thinkingLevel, isModeSwitch, requestedMode, cleanedPrompt, isGreeting, complexity, confidence }",
    "Rules: explicit command syntax may be handled separately; for natural-language mode changes return isModeSwitch/requestedMode. Use a conservative false/low-resource interpretation when uncertain. A request for current/external evidence must set enableSearch=true. A simple social greeting must be greeting with enableSearch=false and no thinking. Do not output a rationale field.",
  ].join("\n\n");
}

function sanitizeDecision(raw: unknown, fallbackMode: ModeKey): SemanticInteractionDecision {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = INTENTS.includes(data.intent as (typeof INTENTS)[number]) ? data.intent as SemanticInteractionDecision["intent"] : "general";
  const effectiveMode = MODE_KEYS.includes(data.effectiveMode as ModeKey) ? data.effectiveMode as ModeKey : fallbackMode;
  const requestedMode = MODE_KEYS.includes(data.requestedMode as ModeKey) ? data.requestedMode as ModeKey : undefined;
  const requiredCapabilities = Array.isArray(data.requiredCapabilities)
    ? data.requiredCapabilities.filter((cap): cap is Capability => typeof cap === "string")
    : [];
  const thinkingLevel = data.thinkingLevel === "LOW" || data.thinkingLevel === "MEDIUM" || data.thinkingLevel === "HIGH" ? data.thinkingLevel : undefined;
  const complexity = COMPLEXITIES.includes(data.complexity as (typeof COMPLEXITIES)[number]) ? data.complexity as SemanticInteractionDecision["complexity"] : "simple";
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
  const isModeSwitch = Boolean(data.isModeSwitch && requestedMode);
  const isGreeting = Boolean(data.isGreeting) || intent === "greeting";
  const enableSearch = Boolean(data.enableSearch) || requiredCapabilities.includes("web_research");
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

    const fallback: SemanticInteractionDecision = {
      intent: "general",
      effectiveMode: params.persistentMode,
      requiredCapabilities: Array.from(MODES[params.persistentMode]?.capabilitiesList || []),
      enableSearch: params.persistentMode === "deep_research" && MODES.deep_research.researchPolicy === "always",
      thinkingLevel: MODES[params.persistentMode]?.capabilities.thinkingLevelDefault,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: 0,
    };

    try {
      const raw = await params.gemini.generateReply(
        [],
        jsonOnlyPrompt(params.text, params.persistentMode, history),
        "Return the classification JSON only. Do not add explanations.",
        { isExtraction: true, mode: "auto" },
      );
      const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim());
      const decision = sanitizeDecision(parsed, params.persistentMode);
      semanticInteractionCache.set(params.text, params.persistentMode, history, decision);
      return decision;
    } catch (error) {
      logger.warn({ error: safeErrorMetadata(error) }, "Semantic interaction resolution unavailable; using conservative mode-policy fallback");
      semanticInteractionCache.set(params.text, params.persistentMode, history, fallback);
      return fallback;
    }
  }

  static getCached(text: string, persistentMode: ModeKey, history: Array<{ role: string; content: string }> = []): SemanticInteractionDecision | undefined {
    return semanticInteractionCache.get(text, persistentMode, history);
  }
}
