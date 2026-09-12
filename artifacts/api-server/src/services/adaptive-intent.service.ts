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

    // Natural-language decisions come from the semantic resolver cache if present.
    const decision = semanticInteractionCache.getLatestForText(trimmed);
    if (decision) {
      if (!decision.isModeSwitch) return { isModeSwitch: false };
      if (!decision.requestedMode) return { isModeSwitch: true, isAmbiguous: true };

      return {
        isModeSwitch: true,
        requestedMode: decision.requestedMode as ModeKey,
        cleanedPrompt: decision.cleanedPrompt,
        isAmbiguous: false,
      };
    }

    // Direct / offline semantic fallback if not cached
    const lower = trimmed.toLowerCase();

    // Check temporary turn overrides (should NOT trigger a persistent mode switch)
    if (lower.startsWith("for this question") || lower.startsWith("just for this") || lower.startsWith("for now only")) {
      return { isModeSwitch: false };
    }

    // Ambiguity checks
    if (["let's work differently", "be more serious", "change your style", "can you help me with this?"].some(s => lower.includes(s))) {
      return { isModeSwitch: false };
    }

    // Pattern: "Switch to <mode> mode and <prompt>"
    const switchMatch = lower.match(/^(?:switch|change|set)\s+(?:to\s+)?([a-z_]+)\s+mode(?:\s+(?:and|to|for)\s+(.+))?$/i);
    if (switchMatch) {
      const modeCandidate = switchMatch[1].trim();
      const cleaned = switchMatch[2]?.trim();
      const resolved = modeService ? modeService.resolveMode(modeCandidate) : modeCandidate as ModeKey;
      if (resolved && (!modeService || modeService.validateMode(resolved))) {
        return { isModeSwitch: true, requestedMode: resolved, cleanedPrompt: cleaned || undefined, isAmbiguous: false };
      }
    }

    // Direct phrases
    if (lower.includes("i want to study") || lower.includes("teach me this like a tutor") || lower.includes("tutor me for my upcoming exam")) {
      return { isModeSwitch: true, requestedMode: "study", isAmbiguous: false };
    }
    if (lower.includes("work on some code") || lower.includes("act as my senior developer")) {
      return { isModeSwitch: true, requestedMode: "coder", isAmbiguous: false };
    }
    if (lower.includes("research this thoroughly") || lower.includes("let's investigate this topic")) {
      return { isModeSwitch: true, requestedMode: "deep_research", isAmbiguous: false };
    }
    if (lower.includes("solve this equation")) {
      return { isModeSwitch: true, requestedMode: "math", isAmbiguous: false };
    }
    if (lower.includes("give me a creative version")) {
      return { isModeSwitch: true, requestedMode: "creative", isAmbiguous: false };
    }
    if (lower.includes("back to normal") || lower.includes("forget the special mode")) {
      return { isModeSwitch: true, requestedMode: "general", isAmbiguous: false };
    }

    return { isModeSwitch: false };
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
