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

/**
 * Compatibility adapter for callers that still depend on the legacy service name.
 * All natural-language interpretation must already have been performed by the
 * semantic interaction resolver and cached for the current turn. This adapter
 * deliberately does not classify user vocabulary itself.
 */
export class AdaptiveIntentService {
  static detectModeSwitchIntent(text: string, modeService?: ModeService): ModeSwitchIntent {
    const trimmed = text?.trim() || "";
    if (!trimmed) return { isModeSwitch: false };

    // Explicit Telegram command is a deterministic protocol contract.
    const commandMatch = trimmed.match(/^\/mode(?:\s+([a-z_]+))?$/i);
    if (commandMatch) {
      if (!commandMatch[1]) return { isModeSwitch: true, isAmbiguous: true };
      const requestedMode = modeService?.resolveCanonicalMode(commandMatch[1]) || null;
      return requestedMode
        ? { isModeSwitch: true, requestedMode, isAmbiguous: false }
        : { isModeSwitch: false };
    }

    // Natural-language decisions come only from the semantic resolver cache.
    const decision = semanticInteractionCache.getLatestForText(trimmed);
    if (!decision?.isModeSwitch) return { isModeSwitch: false };
    if (!decision.requestedMode) return { isModeSwitch: true, isAmbiguous: true };

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
    const decision = semanticInteractionCache.get(text, userExplicitMode, history);
    if (!decision) {
      // Fail closed: never infer a task/tool/mode from raw vocabulary when the
      // semantic decision for this turn is unavailable.
      const profile = MODES[userExplicitMode] || MODES.general;
      return {
        enableSearch: false,
        thinkingLevel: undefined,
        detectedIntent: "general",
        imagePrompt: undefined,
        videoPrompt: undefined,
        effectiveModeInstruction: profile.systemBehavior,
      };
    }

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

  /**
   * Retained only as a compatibility helper for older callers. It constructs a
   * structured semantic-neutral decision from the selected mode policy; it does
   * not inspect or classify natural-language input.
   */
  private static policyFallback(mode: ModeKey): SemanticInteractionDecision {
    const profile = MODES[mode] || MODES.general;
    return {
      intent: "general",
      effectiveMode: mode,
      requiredCapabilities: Array.from(profile.capabilitiesList) as string[],
      enableSearch: false,
      thinkingLevel: undefined,
      isModeSwitch: false,
      isGreeting: false,
      complexity: "simple",
      confidence: 0,
    };
  }
}
