import {
  MODES,
  type ModeKey,
  type Capability,
} from "../config/mode";
import { ModeService } from "./mode.service";
import { ImageGenerationService } from "./image-generation.service";
import { VideoGenerationService } from "./video-generation.service";

export interface AdaptiveExecutionPlan {
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH" | undefined;
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

const VIDEO_GENERATION_PATTERNS = [
  /^\/(video|vid|clip|movie)\b/i,
  /\b(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|mp4|short film|movie clip)\b/i,
  /\b(can you\s+)?(make|generate|create|render)\s+(a|an)\s+(video|clip|animation)\b/i,
];

const IMAGE_GENERATION_PATTERNS = [
  /^\/(image|draw|img|paint)\b/i,
  /\b(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\b/i,
  /\b(draw|paint|sketch|illustrate)\s+(me\s+)?(a|an|the|some)\b/i,
  /\b(can you\s+)?(draw|paint|sketch)\s+(a|an|the|me)\b/i,
];

const TEMPORAL_FACT_PATTERNS = [
  /\b(today|yesterday|tomorrow|tonight|right now|currently|current|latest|newest|recent|recently|upcoming)\b/i,
  /\b(this (week|month|year|morning|afternoon|evening)|in 202[5-9])\b/i,
  /\b(news|headline|announcement|announced|breaking|launch|release|released|update|patch notes|changelog)\b/i,
  /\b(weather|forecast|temperature|price|stock|crypto|bitcoin|btc|eth|market cap|exchange rate)\b/i,
  /\b(who won|winner|score|match|game|standings|tournament|championship|election|vote|poll)\b/i,
  /\b(search|google|look up|check online|verify|source|find online|who is the current|is there any)\b/i,
  /\b(what happened|when was|when is|release date|where can i find|official docs|documentation)\b/i,
];

const DEEP_REASONING_PATTERNS = [
  /\b(solve|solution|equation|proof|prove|theorem|calculat(e|ion)|derivative|integral|probability)\b/i,
  /\b(puzzle|riddle|paradox|invariants?|edge cases?|counterexample|logic|truth table)\b/i,
  /\b(step[- ]by[- ]step|step by step|chain of thought|first principles|reason through|deduce)\b/i,
  /\b(system design|architecture|distributed system|scalability|concurrency|race condition|deadlock|idempotenc(y|e))\b/i,
  /\b(debug|root cause|diagnose|fix this error|stack trace|exception|undefined is not|segfault|memory leak)\b/i,
  /\b(trade[- ]offs?|pros and cons|compare and contrast|deep dive|comprehensive analysis|critique)\b/i,
  /\b(algorithm|time complexity|space complexity|big o|dynamic programming|data structure)\b/i,
];

const CODING_PATTERNS = [
  /```[\s\S]*?```/,
  /\b(typescript|javascript|python|rust|golang|c\+\+|sql|prisma|docker|kubernetes|graphql|react|vue)\b/i,
  /\b(function|class|interface|async|await|const|let|var|def|return|import|export|npm|pip)\b/,
  /\b(write (a|the) (script|code|function|program|query|regex|component))\b/i,
  /\b(refactor|implement|boilerplate|unit test|endpoint|api route)\b/i,
];

const AMBIGUOUS_MODE_PATTERNS = [
  /^(?:please\s+)?(?:switch|change|set|toggle)\s+mode$/i,
  /^\/mode$/i,
  /\blet's\s+work\s+differently\b/i,
  /\bchange\s+the\s+assistant\b/i,
  /\bdifferent\s+mode\b/i,
];

const MODE_SWITCH_REGEXES = [
  // Explicit "switch/change/turn on/activate/set/use/enable/toggle [back] [to] <mode> [mode]"
  /\b(?:switch|change|turn\s+on|activate|set|use|enable|toggle)(?:\s+(?:assistant|bot|agent))?(?:\s+back)?(?:\s+(?:mode\s+to|to\s+mode|\bto\b|\binto\b|\bmode\b|\bover\s+to\b))?\s*([a-z_]+)(?:\s+mode)?\b/i,
  // "mode: <mode>", "/mode <mode>"
  /^(?:\/|#)?mode[:\s]+([a-z_]+)\b/i,
  // "I want to switch to <mode>", "can you switch to <mode>", "please switch back to <mode>"
  /\b(?:can\s+you|please|i\s+want\s+to|let's|lets)\s+(?:switch|change|turn\s+on|activate|enter)(?:\s+back)?\s+(?:to\s+)?(?:the\s+)?([a-z_]+)(?:\s+mode)?\b/i,
  // "be my <role>", "act as a <role>", "take on the role of <role>"
  /\b(?:be\s+(?:my|a|an)|act\s+as\s+(?:a|an)|take\s+on\s+(?:the\s+)?role\s+of)\s+([a-z_]+)\b/i,
  // "enter <mode> mode"
  /\benter\s+([a-z_]+)\s+mode\b/i,
];

export class AdaptiveIntentService {
  /**
   * Detects whether input expresses a natural language mode-switch intent.
   * Uses semantic intent recognition as the primary mechanism, backed by
   * deterministic fast-path patterns for explicit commands.
   * Handles ambiguity gracefully without destructive state mutations.
   */
  static detectModeSwitchIntent(
    text: string,
    modeService?: ModeService,
  ): ModeSwitchIntent {
    if (!text || !text.trim()) {
      return { isModeSwitch: false };
    }

    const trimmed = text.trim();

    // 0. Check for temporary single-turn overrides (e.g. "For this question...", "Just for this message...")
    if (
      /\b(for this (question|prompt|message|turn|time)|just for now)\b/i.test(trimmed)
    ) {
      return { isModeSwitch: false };
    }

    // 1. Check for explicit ambiguous mode switch requests
    for (const ambigRegex of AMBIGUOUS_MODE_PATTERNS) {
      if (ambigRegex.test(trimmed)) {
        return { isModeSwitch: true, isAmbiguous: true };
      }
    }

    const resolveMode = (raw: string): ModeKey | null => {
      if (modeService) {
        return modeService.resolveCanonicalMode(raw);
      }
      return new ModeService({} as any).resolveCanonicalMode(raw);
    };

    // 2. Fast-Path Deterministic Command & Explicit Patterns
    for (const regex of MODE_SWITCH_REGEXES) {
      const match = trimmed.match(regex);
      if (match && match[1]) {
        const candidateRaw = match[1].trim();
        const canonicalMode = resolveMode(candidateRaw);
        if (canonicalMode) {
          let cleanedPrompt = trimmed
            .replace(match[0], "")
            .replace(/^[\s,;.]*(and|then|please|also|for me)[\s,;.]*/i, "")
            .trim();
          if (!cleanedPrompt || cleanedPrompt.length < 3) {
            cleanedPrompt = undefined;
          }

          return {
            isModeSwitch: true,
            requestedMode: canonicalMode,
            cleanedPrompt,
            isAmbiguous: false,
          };
        }
      }
    }

    // 3. Semantic Natural Language Intent Recognition Engine
    const semanticMatchers: Array<{
      mode: ModeKey;
      patterns: RegExp[];
    }> = [
      {
        mode: "study",
        patterns: [
          /\b(i want to study|study now|study mode)\b/i,
          /\b(teach me|tutor me|be my tutor|act as my tutor|like a tutor)\b/i,
          /\b(prepare for (my )?(upcoming )?(exam|quiz|test)|homework help)\b/i,
          /\b(explain (this|calculus|concept) like a tutor)\b/i,
        ],
      },
      {
        mode: "coder",
        patterns: [
          /\b(let's work on (some )?code|coding mode|developer mode)\b/i,
          /\b(act as (a|my) (senior )?(developer|dev|programmer|engineer))\b/i,
          /\b(write (some )?code for me|help me code|refactor my code)\b/i,
        ],
      },
      {
        mode: "deep_research",
        patterns: [
          /\b(research (this|topic) thoroughly|deep research|research mode)\b/i,
          /\b(using current sources|find up-to-date sources|verify facts online)\b/i,
          /\b(let's investigate this (topic|subject|issue))\b/i,
        ],
      },
      {
        mode: "math",
        patterns: [
          /\b(help me solve this equation|math mode|reasoning mode)\b/i,
          /\b(act as a mathematician|solve this step-by-step with logic)\b/i,
        ],
      },
      {
        mode: "creative",
        patterns: [
          /\b(give me a creative version|creative mode|writing mode)\b/i,
          /\b(brainstorm ideas for|write a story|be my creative partner)\b/i,
        ],
      },
      {
        mode: "general",
        patterns: [
          /\b(back to normal|normal mode|default mode|general mode)\b/i,
          /\b(forget (the|any) special mode|reset mode|standard mode)\b/i,
        ],
      },
      {
        mode: "auto",
        patterns: [
          /\b(auto mode|automatic mode|adapt automatically)\b/i,
        ],
      },
    ];

    for (const matcher of semanticMatchers) {
      for (const pattern of matcher.patterns) {
        if (pattern.test(trimmed)) {
          let cleaned = trimmed
            .replace(pattern, "")
            .replace(/^[\s,;.]*(and|then|please|also|for me)[\s,;.]*/i, "")
            .trim();
          if (!cleaned || cleaned.length < 3) {
            cleaned = undefined;
          }

          return {
            isModeSwitch: true,
            requestedMode: matcher.mode,
            cleanedPrompt: cleaned,
            isAmbiguous: false,
          };
        }
      }
    }

    return { isModeSwitch: false };
  }

  /**
   * Evaluates the user query, conversational context, and user settings
   * to systematically determine mode instructions, search requirements, and thinking levels.
   */
  static analyze(
    text: string,
    userExplicitMode: ModeKey = "general",
    history: Array<{ role: string; content: string }> = [],
  ): AdaptiveExecutionPlan {
    const trimmed = text.trim();
    const modeProfile = MODES[userExplicitMode] || MODES.general;

    // 0a. Check for video generation request
    const isVideoGen = VIDEO_GENERATION_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );
    if (isVideoGen) {
      const extractedVideoPrompt =
        VideoGenerationService.extractVideoPrompt(trimmed);
      return {
        enableSearch: false,
        thinkingLevel: undefined,
        detectedIntent: "video_generation",
        videoPrompt: extractedVideoPrompt || trimmed,
        effectiveModeInstruction:
          MODES.creative?.systemBehavior || MODES.general.systemBehavior,
      };
    }

    // 0b. Check for image generation request
    const isImageGen = IMAGE_GENERATION_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );
    let extractedImagePrompt: string | undefined;

    if (isImageGen) {
      extractedImagePrompt =
        ImageGenerationService.extractImagePrompt(trimmed);
      return {
        enableSearch: false,
        thinkingLevel: undefined,
        detectedIntent: "image_generation",
        imagePrompt: extractedImagePrompt || trimmed,
        effectiveModeInstruction:
          MODES.creative?.systemBehavior || MODES.general.systemBehavior,
      };
    }

    // 1. Check for real-time web grounding need
    const hasQuestionOrFactRequest =
      /\?|\b(what|who|when|where|why|how|search|latest|news|weather|price|explain|solve|updates|events|status)\b/i.test(
        trimmed,
      );
    const isCasualGreeting =
      !hasQuestionOrFactRequest &&
      /^(hi|hello|hey|good\s*(morning|evening|afternoon)|sup|yo|hope you)\b/i.test(
        trimmed,
      );

    const needsSearch =
      modeProfile.capabilities.toolPermissions.searchAllowed &&
      ((modeProfile.capabilities.enableSearchDefault && !isCasualGreeting) ||
        TEMPORAL_FACT_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
        (history.length > 0 &&
          /\b(latest|current|recent|today)\b/i.test(
            history[history.length - 1]?.content || "",
          ) &&
          /\b(what about|how about|and|why)\b/i.test(trimmed)));

    // 2. Check for multi-step reasoning / thinking mode need
    const hasCodeBlock = /```/.test(trimmed);
    const hasMultipleConstraints =
      (trimmed.match(/\d+[\.\)]/g) || []).length >= 2;
    const isReasoningText = DEEP_REASONING_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );
    const isCodingText = CODING_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );

    const needsDeepReasoning =
      modeProfile.capabilities.toolPermissions.thinkingAllowed &&
      (userExplicitMode === "math" ||
        userExplicitMode === "coder" ||
        modeProfile.capabilities.thinkingLevelDefault !== undefined ||
        isReasoningText ||
        (isCodingText &&
          (trimmed.includes("bug") ||
            trimmed.includes("error") ||
            trimmed.includes("optimize"))) ||
        (trimmed.length > 250 && hasMultipleConstraints) ||
        hasCodeBlock);

    // 3. Determine detected intent
    let detectedIntent: AdaptiveExecutionPlan["detectedIntent"] = "general";
    if (needsSearch && !needsDeepReasoning) {
      detectedIntent = "search_grounding";
    } else if (needsDeepReasoning && !isCodingText) {
      detectedIntent = "deep_reasoning";
    } else if (isCodingText) {
      detectedIntent = "coding";
    } else if (userExplicitMode === "study") {
      detectedIntent = "study";
    } else if (userExplicitMode === "creative") {
      detectedIntent = "writing";
    }

    // 4. Resolve effective system mode instruction dynamically
    let effectiveModeInstruction = modeProfile.systemBehavior;

    if (userExplicitMode === "general") {
      if (detectedIntent === "deep_reasoning") {
        effectiveModeInstruction = MODES.math.systemBehavior;
      } else if (detectedIntent === "search_grounding") {
        effectiveModeInstruction = MODES.deep_research.systemBehavior;
      } else if (detectedIntent === "coding") {
        effectiveModeInstruction = MODES.coder.systemBehavior;
      }
    } else {
      if (needsDeepReasoning && userExplicitMode !== "math") {
        effectiveModeInstruction = `${effectiveModeInstruction}\n\n[SYSTEMATIC ADAPTATION]: This inquiry involves technical or logical problem-solving. Carefully verify intermediate steps, explore edge cases, and ensure precision.`;
      }
      if (needsSearch && userExplicitMode !== "deep_research") {
        effectiveModeInstruction = `${effectiveModeInstruction}\n\n[SYSTEMATIC ADAPTATION]: This inquiry touches on real-time or factual information. Verify current facts using search grounding.`;
      }
    }

    return {
      enableSearch: needsSearch,
      thinkingLevel: needsDeepReasoning
        ? modeProfile.capabilities.thinkingLevelDefault || "LOW"
        : undefined,
      detectedIntent,
      effectiveModeInstruction,
    };
  }
}
