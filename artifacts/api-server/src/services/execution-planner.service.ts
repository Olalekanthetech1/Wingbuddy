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
    const semantic = semanticInteractionCache.get(text, persistentMode, history) || this.failSafeDecision(persistentMode);

    const semanticOverride = semantic.isModeSwitch && semantic.requestedMode
      ? (semantic.requestedMode as ModeKey)
      : undefined;

    let effectiveMode: ModeKey;
    if (semanticOverride && this.modeService.validateMode(semanticOverride)) {
      effectiveMode = semanticOverride;
    } else if (persistentMode === "auto") {
      effectiveMode = semantic.effectiveMode && semantic.effectiveMode !== "auto"
        ? semantic.effectiveMode
        : "general";
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

    const enableSearch = semantic.enableSearch && profile.capabilities.toolPermissions.searchAllowed;
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

  private failSafeDecision(mode: ModeKey): SemanticInteractionDecision {
    const resolvedMode = mode === "auto" ? "general" : mode;
    return {
      intent: "general",
      promptTypes: ["DIRECT_COMMAND"],
      primaryPromptType: "DIRECT_COMMAND",
      executionProfile: "unknown",
      effectiveMode: resolvedMode,
      requiredCapabilities: [],
      enableSearch: false,
      thinkingLevel: undefined,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: 0,
      taskIntent: "NO_TASK",
      conversationOperation: "new_request",
    };
  }
}
