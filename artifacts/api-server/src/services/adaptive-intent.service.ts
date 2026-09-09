import { MODES, type ModeKey, type Capability } from "../config/mode";
import { ModeService } from "./mode.service";
import { semanticInteractionCache, type SemanticInteractionDecision } from "./semantic-interaction-cache.service";

export interface AdaptiveExecutionPlan {
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  detectedIntent:
    | "image_generation"
    | "video_generation"
    | "search_grounding"
    | "deep_reasoning"
    | "coding"
    | "study"
    | "writing"
    | "brainstorming"
    | "general";
  imagePrompt?: string;
  videoPrompt?: string;
  effectiveModeInstruction: string;
}

export interface ModeSwitchIntent {
  isModeSwitch: boolean;
  requestedMode?: ModeKey;
  cleanedPrompt?: string;
  isAmbiguous?: boolean;
}

export class AdaptiveIntentService {
  /**
   * Natural-language intent is resolved semantically upstream and cached for the current turn.
   * The only local parser intentionally retained here is the explicit Telegram /mode contract.
   */
  static detectModeSwitchIntent(text: string, modeService?: ModeService): ModeSwitchIntent {
    const trimmed = text?.trim() || "";
    if (!trimmed) return { isModeSwitch: false };

    // Deterministic Telegram command contract only.
    const commandMatch = trimmed.match(/^\/mode(?:\s+([a-z_]+))?$/i);
    if (commandMatch) {
      if (!commandMatch[1]) return { isModeSwitch: true, isAmbiguous: true };
      const requestedMode = modeService?.resolveCanonicalMode(commandMatch[1]) || null;
      return requestedMode
        ? { isModeSwitch: true, requestedMode, isAmbiguous: false }
        : { isModeSwitch: false };
    }

    // Semantic mode switch result populated during GlobalContextService processing.
    const decision = semanticInteractionCache.getLatestForText(trimmed);
    if (!decision?.isModeSwitch || !decision.requestedMode) return { isModeSwitch: false };

    return {
      isModeSwitch: true,
      requestedMode: decision.requestedMode as ModeKey,
      cleanedPrompt: decision.cleanedPrompt,
      isAmbiguous: false,
    };
  }

  static analyze(
    text: string,
    userExplicitMode: ModeKey = "general",
    history: Array<{ role: string; content: string }> = [],
  ): AdaptiveExecutionPlan {
    const decision = semanticInteractionCache.get(text, userExplicitMode, history) || this.policyFallback(userExplicitMode);
    const profile = MODES[decision.effectiveMode || userExplicitMode] || MODES[userExplicitMode] || MODES.general;
    return {
      enableSearch: decision.enableSearch,
      thinkingLevel: decision.thinkingLevel,
      detectedIntent: decision.intent === "greeting" ? "general" : decision.intent as AdaptiveExecutionPlan["detectedIntent"],
      imagePrompt: decision.intent === "image_generation" ? (decision.cleanedPrompt || text.trim()) : undefined,
      videoPrompt: decision.intent === "video_generation" ? (decision.cleanedPrompt || text.trim()) : undefined,
      effectiveModeInstruction: profile.systemBehavior,
    };
  }

  private static policyFallback(mode: ModeKey): SemanticInteractionDecision {
    const profile = MODES[mode] || MODES.general;
    return {
      intent: "general",
      effectiveMode: mode,
      requiredCapabilities: Array.from(profile.capabilitiesList) as string[],
      enableSearch: profile.researchPolicy === "always",
      thinkingLevel: profile.capabilities.thinkingLevelDefault,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: 0,
    };
  }
}
