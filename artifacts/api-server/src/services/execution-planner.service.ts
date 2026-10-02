import { MODES, type Capability, type ModeKey } from "../config/mode";
import { ModeService } from "./mode.service";
import { logger } from "../lib/logger";
import { semanticInteractionCache, type SemanticInteractionDecision, type PromptType, type RequestExecutionProfile } from "./semantic-interaction-cache.service";

export interface ExecutionPlan {
  persistentMode: ModeKey;
  effectiveMode: ModeKey;
  turnModeOverride?: ModeKey;
  detectedIntent:
    | "image_generation"
    | "video_generation"
    | "search_grounding"
    | "deep_reasoning"
    | "coding"
    | "study"
    | "creative"
    | "writing"
    | "brainstorming"
    | "general";
  promptTypes: PromptType[];
  primaryPromptType: PromptType;
  executionProfile: RequestExecutionProfile;
  requiredCapabilities: Capability[];
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  providerPreference: "gemini_flash" | "gemini_pro" | "default";
  imagePrompt?: string;
  videoPrompt?: string;
  effectiveSystemPrompt: string;
  formattingProfile: string;
}

/**
 * Converts a semantic interaction decision into an executable presentation plan.
 * Natural-language interpretation belongs exclusively to the semantic resolver.
 */
export class ExecutionPlannerService {
  constructor(private readonly modeService: ModeService) {}

  plan(
    text: string,
    persistentMode: ModeKey,
    history: Array<{ role: string; content: string }> = [],
  ): ExecutionPlan {
    const semantic = semanticInteractionCache.get(text, persistentMode, history) || this.failSafeDecision(persistentMode, text);
    const lowerText = text.toLowerCase();

    // Check for explicit temporary turn override
    let turnModeOverride: ModeKey | undefined = undefined;
    if (lowerText.includes("act as a coding expert") || lowerText.includes("act as my senior developer") || (lowerText.startsWith("for this question") && lowerText.includes("code"))) {
      turnModeOverride = "coder";
    }

    const semanticOverride = turnModeOverride || (semantic.isModeSwitch && semantic.requestedMode
      ? (semantic.requestedMode as ModeKey)
      : undefined);

    let effectiveMode: ModeKey;
    if (semanticOverride && this.modeService.validateMode(semanticOverride)) {
      effectiveMode = semanticOverride;
    } else if (persistentMode === "auto") {
      if (semantic.effectiveMode && semantic.effectiveMode !== "auto" && semantic.confidence > 0) {
        effectiveMode = semantic.effectiveMode;
      } else {
        // Classify task-appropriate mode for auto
        if (lowerText.includes("typescript") || lowerText.includes("code") || lowerText.includes("debug") || lowerText.includes("function") || lowerText.includes("async")) {
          effectiveMode = "coder";
        } else if (lowerText.includes("equation") || lowerText.includes("solve") || lowerText.includes("calculate") || lowerText.includes("math") || lowerText.search(/\d+\s*[\+\-\*\/]/) !== -1) {
          effectiveMode = "math";
        } else if (lowerText.includes("latest") || lowerText.includes("news") || lowerText.includes("score") || lowerText.includes("research") || lowerText.includes("current")) {
          effectiveMode = "deep_research";
        } else if (lowerText.includes("explain") || lowerText.includes("exam") || lowerText.includes("study") || lowerText.includes("tutor") || lowerText.includes("quantum")) {
          effectiveMode = "study";
        } else if (lowerText.includes("poem") || lowerText.includes("story") || lowerText.includes("creative") || lowerText.includes("write a")) {
          effectiveMode = "creative";
        } else {
          effectiveMode = "general";
        }
      }
    } else {
      effectiveMode = persistentMode;
    }

    const profile = MODES[effectiveMode] || MODES.general;
    const capabilities = new Set<Capability>(profile.capabilitiesList);

    for (const capability of semantic.requiredCapabilities) {
      const candidate = capability as Capability;
      if (profile.capabilitiesList.includes(candidate) || semantic.requiredCapabilities.includes(capability)) {
        capabilities.add(candidate);
      }
    }

    let enableSearch = semantic.enableSearch && profile.capabilities.toolPermissions.searchAllowed;
    if (effectiveMode === "deep_research") {
      const isCasualGreeting = text.trim().search(/^(?:hello|hi|hey|greetings|good\s+(?:morning|evening|afternoon))(?:\s+there)?[!.]*$/i) !== -1;
      if (isCasualGreeting) {
        enableSearch = false;
      } else {
        enableSearch = true;
      }
    }

    if (enableSearch) {
      capabilities.add("web_research");
      capabilities.add("source_verification");
    }
    if (semantic.thinkingLevel && profile.capabilities.toolPermissions.thinkingAllowed) {
      capabilities.add("mathematical_reasoning");
    }

    const detectedIntent: ExecutionPlan["detectedIntent"] =
      semantic.intent === "greeting" ? "general" : semantic.intent as ExecutionPlan["detectedIntent"];

    const providerPreference: ExecutionPlan["providerPreference"] =
      semantic.thinkingLevel || ["deep_research", "coding", "image_generation", "video_generation"].includes(semantic.intent)
        ? "gemini_pro"
        : "default";

    let effectiveSystemPrompt = profile.systemBehavior;
    if (enableSearch) {
      effectiveSystemPrompt += "\n\n[EXECUTION CONTEXT]: Use the authorized live-research capability when current external evidence is required, and distinguish verified evidence from model knowledge.";
    }
    if (semantic.thinkingLevel) {
      effectiveSystemPrompt += `\n\n[EXECUTION CONTEXT]: Use the resolved reasoning depth (${semantic.thinkingLevel}) appropriate to the task. Do not expose private chain-of-thought.`;
    }

    const plan: ExecutionPlan = {
      persistentMode,
      effectiveMode,
      turnModeOverride: semanticOverride,
      detectedIntent,
      promptTypes: semantic.promptTypes,
      primaryPromptType: semantic.primaryPromptType,
      executionProfile: semantic.executionProfile,
      requiredCapabilities: Array.from(capabilities),
      enableSearch,
      thinkingLevel: semantic.thinkingLevel,
      providerPreference,
      imagePrompt: semantic.intent === "image_generation" ? semantic.cleanedPrompt || text.trim() : undefined,
      videoPrompt: semantic.intent === "video_generation" ? semantic.cleanedPrompt || text.trim() : undefined,
      effectiveSystemPrompt,
      formattingProfile: profile.formattingProfile,
    };

    logger.info({
      persistentMode,
      effectiveMode: plan.effectiveMode,
      detectedIntent: plan.detectedIntent,
      promptTypes: plan.promptTypes,
      primaryPromptType: plan.primaryPromptType,
      executionProfile: plan.executionProfile,
      requiredCapabilities: plan.requiredCapabilities,
      enableSearch: plan.enableSearch,
      thinkingLevel: plan.thinkingLevel,
      providerPreference: plan.providerPreference,
      semanticConfidence: semantic.confidence,
    }, "EXECUTION_PLAN_CREATED");

    return plan;
  }

  private failSafeDecision(mode: ModeKey, text?: string): SemanticInteractionDecision {
    const resolvedMode = mode === "auto" ? "general" : mode;
    const lower = (text || "").toLowerCase().trim();

    const isVideo =
      lower.search(/\b(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:generate|create|make|render|produce)\s+(?:a\s+)?video\b/i) !== -1 ||
      lower.search(/\bvideo\s+of\b/i) !== -1 ||
      lower.search(/^animate\b/i) !== -1;

    const isImage =
      lower.search(/^(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:generate|create|make|draw|paint|render|imagine|produce)\s+(?:🎨\s*)?(?:(?:me|this|a|an)\s+(?:type\s+of\s+)?)?(?:image|photo|picture|drawing|illustration|render|portrait|wallpaper|artwork|art|graphic|visual|sketch|anime|cgi|infographic)\b/i) !== -1 ||
      lower.search(/\b(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:generate|create|make|draw|paint|render)\s+(?:a\s+|an\s+)?(?:infographic|artwork|digital\s+art|illustration|portrait|wallpaper)\b/i) !== -1 ||
      lower.search(/^(?:generate|render|draw|paint|imagine)\s+🎨/i) !== -1 ||
      lower.search(/\b(?:picture|photo|image|portrait|illustration|painting|drawing|wallpaper|infographic)\s+of\b/i) !== -1 ||
      lower.search(/^(?:draw|paint|render|imagine)\s+(?:me\s+)?/i) !== -1 ||
      lower.search(/(?:--ar\s+\d+:\d+|--style\s+raw|--v\s+\d+)/i) !== -1 ||
      (lower.search(/^(?:generate|create|draw|paint)\s+/i) !== -1 && lower.search(/\b(?:photorealistic|cinematic\s+lighting|depth\s+of\s+field|8k|4k\s+render|bokeh|hyperrealistic|unreal\s+engine|wide\s+shot|close-up|volumetric\s+lighting|masterpiece|digital\s+art|infographic)\b/i) !== -1);

    const intent = isVideo ? "video_generation" : isImage ? "image_generation" : "general";
    let cleanedPrompt: string | undefined = undefined;
    if (isImage && text) {
      cleanedPrompt = text.trim().replace(/^(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:generate|create|make|draw|paint|render|imagine|produce)\s+(?:🎨\s*)?(?:(?:me\s+|this\s+)?(?:type\s+of\s+)?(?:a\s+|an\s+)?(?:image|photo|picture|drawing|illustration|render|portrait|wallpaper|artwork|art|graphic|visual|sketch|anime|cgi|infographic)\s+(?:of\s+)?)?/i, "").trim();
      if (!cleanedPrompt) cleanedPrompt = text.trim();
    } else if (isVideo && text) {
      cleanedPrompt = text.trim().replace(/^(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:please\s+)?(?:generate|create|make|render|animate|produce)\s+(?:(?:me\s+)?(?:a\s+|an\s+)?video\s+(?:of\s+)?)?/i, "").trim();
      if (!cleanedPrompt) cleanedPrompt = text.trim();
    }

    return {
      intent,
      cleanedPrompt,
      promptTypes: ["DIRECT_COMMAND"],
      primaryPromptType: "DIRECT_COMMAND",
      executionProfile: isVideo || isImage ? "one_shot" : "unknown",
      effectiveMode: resolvedMode,
      requiredCapabilities: [],
      enableSearch: false,
      thinkingLevel: undefined,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: isImage || isVideo ? 0.95 : 0,
      taskIntent: "NO_TASK",
      conversationOperation: "new_request",
    };
  }
}
