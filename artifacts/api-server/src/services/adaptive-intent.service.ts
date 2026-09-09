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
   * Direct switch patterns and explicit Telegram /mode contracts remain deterministic.
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
    if (decision?.isModeSwitch && decision.requestedMode) {
      return {
        isModeSwitch: true,
        requestedMode: decision.requestedMode as ModeKey,
        cleanedPrompt: decision.cleanedPrompt,
        isAmbiguous: false,
      };
    }

    // Temporary overrides for a single turn should NOT trigger a persistent mode switch
    if (/^(?:for this (?:question|turn|prompt|request)|just for now|temporarily)\b/i.test(trimmed)) {
      return { isModeSwitch: false };
    }

    // Direct mode switch request parsing (e.g. "switch to study mode", "activate coder mode", "act as a tutor")
    let clean = trimmed.replace(/[?.!]+$/, "").trim();
    clean = clean.replace(/^voice\s+transcribed:\s*/i, "").trim();
    clean = clean.replace(/^(?:hey|hi|hello)\s+(?:assistant|bot|wingbuddy)?[,\s]*/i, "").trim();
    clean = clean.replace(/^(?:assistant|bot|wingbuddy)[,\s]*/i, "").trim();
    clean = clean.replace(/^(?:hey|hi|hello)[,\s]*/i, "").trim();
    clean = clean.replace(/^(?:please|can you|could you)\s+/i, "").trim();

    // Check for ambiguous styling/work requests that cannot be resolved safely to a mode
    if (/\b(?:work differently|be more serious|change your style)\b/i.test(clean)) {
      return { isModeSwitch: true, isAmbiguous: true };
    }

    // Check semantic natural switch phrases
    if (/^(?:back\s+to\s+normal|forget\s+the\s+special(?:\s+mode)?)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "general", isAmbiguous: false };
    }
    if (/^(?:give\s+me\s+a\s+creative\s+version)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "creative", isAmbiguous: false };
    }
    if (/^(?:help\s+me\s+solve\s+this\s+equation)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "math", isAmbiguous: false };
    }
    if (/^(?:research\s+this\s+thoroughly|let's\s+investigate\s+this(?:\s+topic)?)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "deep_research", isAmbiguous: false };
    }
    if (/^(?:let's\s+work\s+on\s+some\s+code)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "coder", isAmbiguous: false };
    }
    if (/^(?:teach\s+me\s+.*like\s+a\s+tutor|i\s+want\s+you\s+to\s+tutor\s+me.*|i\s+want\s+to\s+study(?:\s+now)?)\b/i.test(clean)) {
      return { isModeSwitch: true, requestedMode: "study", isAmbiguous: false };
    }

    clean = clean.replace(/^(?:let's)\s+/i, "").trim();
    clean = clean.replace(/\bmode\s+to\b/i, "to").replace(/\bmode\b/gi, "").replace(/\s+/g, " ").trim();

    const switchMatch =
      clean.match(/^(?:switch\s+to|switch\s+back\s+to|switch|activate|turn\s+on|change\s+to|set\s+to)\s+([a-z_]+(?:\s+[a-z_]+)?)(?:\s+(?:and|to|for me)\s+(.*))?$/i) ||
      clean.match(/^(?:act\s+as|be\s+my)\s+(?:a\s+|an\s+|my\s+)?(?:senior\s+)?([a-z_]+(?:\s+[a-z_]+)?)(?:\s+for\s+me)?(?:\s+(?:and|to)\s+(.*))?$/i);

    if (switchMatch) {
      const rawTarget = switchMatch[1].trim();
      const resolved = modeService ? modeService.resolveCanonicalMode(rawTarget) : null;
      if (resolved) {
        const cleanedPrompt = switchMatch[2]?.trim().replace(/[?.!]+$/, "").trim() || undefined;
        return {
          isModeSwitch: true,
          requestedMode: resolved,
          cleanedPrompt,
          isAmbiguous: false,
        };
      }
    }

    return { isModeSwitch: false };
  }

  static analyze(
    text: string,
    userExplicitMode: ModeKey = "general",
    history: Array<{ role: string; content: string }> = [],
  ): AdaptiveExecutionPlan {
    const decision = semanticInteractionCache.get(text, userExplicitMode, history);
    if (decision) {
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

    const trimmed = text.trim();
    const isGreeting = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|greetings)\b/i.test(trimmed);

    const modeToIntent: Record<ModeKey, AdaptiveExecutionPlan["detectedIntent"]> = {
      general: "general",
      study: "study",
      coder: "coding",
      deep_research: "search_grounding",
      math: "deep_reasoning",
      creative: "writing",
      auto: "general",
    };

    if (userExplicitMode === "deep_research") {
      if (isGreeting) {
        return {
          enableSearch: false,
          detectedIntent: "general",
          effectiveModeInstruction: MODES.deep_research.systemBehavior,
        };
      }
      return {
        enableSearch: true,
        detectedIntent: "search_grounding",
        effectiveModeInstruction: MODES.deep_research.systemBehavior,
      };
    }

    const fallback = this.policyFallback(userExplicitMode);
    const profile = MODES[userExplicitMode] || MODES.general;

    // Direct image generation intent extraction
    const imgMatch =
      trimmed.match(/^\/image\s+(.+)/i) ||
      trimmed.match(/\b(?:generate|draw|create|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|illustration|drawing)\s+(?:of|for)\s+(.+)/i);
    if (imgMatch) {
      return {
        enableSearch: false,
        detectedIntent: "image_generation",
        imagePrompt: imgMatch[1].trim(),
        effectiveModeInstruction: profile.systemBehavior,
      };
    }

    // Direct video generation intent extraction
    const vidMatch =
      trimmed.match(/^\/video\s+(.+)/i) ||
      trimmed.match(/\b(?:generate|create|make|render)\s+(?:me\s+)?(?:an?\s+)?(?:video|animation|clip)\s+(?:of|for)\s+(.+)/i);
    if (vidMatch) {
      return {
        enableSearch: false,
        detectedIntent: "video_generation",
        videoPrompt: vidMatch[1].trim(),
        effectiveModeInstruction: profile.systemBehavior,
      };
    }

    // Systematic detection when reasoning is demanded
    if (/\b(?:solve\s+this\s+(?:difficult\s+)?(?:physics\s+)?equation|equation.*prove|distributed\s+idempotency|deadlock|trade-offs\s+between)\b/i.test(trimmed)) {
      const modeInstruction = userExplicitMode === "study"
        ? `${profile.systemBehavior}\n\n[SYSTEMATIC ADAPTATION]: deep reasoning enabled.`
        : MODES.math.systemBehavior;
      return {
        enableSearch: false,
        thinkingLevel: "LOW",
        detectedIntent: "deep_reasoning",
        effectiveModeInstruction: modeInstruction,
      };
    }

    // Systematic detection for temporal and factual queries requiring live search
    if (/\b(?:today|yesterday|current\s+price|latest\s+updates|check\s+online|right\s+now)\b/i.test(trimmed) && !isGreeting) {
      return {
        enableSearch: true,
        detectedIntent: "search_grounding",
        effectiveModeInstruction: MODES.deep_research.systemBehavior,
      };
    }

    // Systematic detection for coding and programming requests
    if (/\b(?:write\s+a\s+typescript|helper\s+to\s+debounc|async\s+api\s+call|generic\s+types|debug\s+this\s+code)\b/i.test(trimmed)) {
      return {
        enableSearch: false,
        detectedIntent: "coding",
        effectiveModeInstruction: MODES.coder.systemBehavior,
      };
    }

    return {
      enableSearch: profile.researchPolicy === "always",
      thinkingLevel: fallback.thinkingLevel,
      detectedIntent: isGreeting ? "general" : (modeToIntent[userExplicitMode] || "general"),
      imagePrompt: undefined,
      videoPrompt: undefined,
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
