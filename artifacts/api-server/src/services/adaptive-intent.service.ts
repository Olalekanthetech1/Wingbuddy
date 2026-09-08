import { MODES, type ModeKey } from "../config/mode";
import { ImageGenerationService } from "./image-generation.service";
import { VideoGenerationService } from "./video-generation.service";

export interface AdaptiveExecutionPlan {
  enableSearch: boolean;
  thinkingLevel?: string;
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

export class AdaptiveIntentService {
  /**
   * Evaluates the user query, conversational context, and user settings
   * to systematically determine whether to engage web grounding, deep thinking,
   * or tailored reasoning instructions automatically.
   */
  static analyze(
    text: string,
    userExplicitMode: ModeKey = "general",
    history: Array<{ role: string; content: string }> = [],
  ): AdaptiveExecutionPlan {
    const trimmed = text.trim();

    // 0a. Check for video generation request
    const isVideoGen = VIDEO_GENERATION_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (isVideoGen) {
      const extractedVideoPrompt = VideoGenerationService.extractVideoPrompt(trimmed);
      return {
        enableSearch: false,
        thinkingLevel: undefined,
        detectedIntent: "video_generation",
        videoPrompt: extractedVideoPrompt || trimmed,
        effectiveModeInstruction: MODES.brainstorming.instruction,
      };
    }

    // 0b. Check for image generation request
    const isImageGen = IMAGE_GENERATION_PATTERNS.some((pattern) => pattern.test(trimmed));
    let extractedImagePrompt: string | undefined;

    if (isImageGen) {
      extractedImagePrompt = ImageGenerationService.extractImagePrompt(trimmed);
      return {
        enableSearch: false,
        thinkingLevel: undefined,
        detectedIntent: "image_generation",
        imagePrompt: extractedImagePrompt || trimmed,
        effectiveModeInstruction: MODES.brainstorming.instruction,
      };
    }

    // 1. Check for real-time web grounding need
    const needsSearch =
      userExplicitMode === "research" ||
      TEMPORAL_FACT_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
      (history.length > 0 &&
        /\b(latest|current|recent|today)\b/i.test(
          history[history.length - 1]?.content || "",
        ) &&
        /\b(what about|how about|and|why)\b/i.test(trimmed));

    // 2. Check for multi-step reasoning / thinking mode need
    const hasCodeBlock = /```/.test(trimmed);
    const hasMultipleConstraints = (trimmed.match(/\d+[\.\)]/g) || []).length >= 2;
    const isReasoningText = DEEP_REASONING_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );
    const isCodingText = CODING_PATTERNS.some((pattern) => pattern.test(trimmed));

    const needsDeepReasoning =
      userExplicitMode === "reasoning" ||
      userExplicitMode === "coding" ||
      isReasoningText ||
      (isCodingText && (trimmed.includes("bug") || trimmed.includes("error") || trimmed.includes("optimize"))) ||
      (trimmed.length > 250 && hasMultipleConstraints) ||
      hasCodeBlock;

    // 3. Determine detected intent
    let detectedIntent: AdaptiveExecutionPlan["detectedIntent"] = "general";
    if (needsSearch && !needsDeepReasoning) {
      detectedIntent = "search_grounding";
    } else if (needsDeepReasoning && !isCodingText) {
      detectedIntent = "deep_reasoning";
    } else if (isCodingText) {
      detectedIntent = "coding";
    }

    // 4. Resolve effective system mode instruction dynamically
    let effectiveModeInstruction = MODES[userExplicitMode]?.instruction || MODES.general.instruction;

    if (userExplicitMode === "general") {
      if (detectedIntent === "deep_reasoning") {
        effectiveModeInstruction = MODES.reasoning.instruction;
      } else if (detectedIntent === "search_grounding") {
        effectiveModeInstruction = MODES.research.instruction;
      } else if (detectedIntent === "coding") {
        effectiveModeInstruction = MODES.coding.instruction;
      }
    } else {
      // If user selected another mode (e.g. study or writing), augment with reasoning or search when demanded by the query
      if (needsDeepReasoning && userExplicitMode !== "reasoning") {
        effectiveModeInstruction = `${effectiveModeInstruction}\n\n[SYSTEMATIC ADAPTATION]: This inquiry involves technical or logical problem-solving. Carefully verify intermediate steps, explore edge cases, and ensure precision.`;
      }
      if (needsSearch && userExplicitMode !== "research") {
        effectiveModeInstruction = `${effectiveModeInstruction}\n\n[SYSTEMATIC ADAPTATION]: This inquiry touches on real-time or factual information. Verify current facts using search grounding.`;
      }
    }

    return {
      enableSearch: needsSearch,
      thinkingLevel: needsDeepReasoning ? "LOW" : undefined,
      detectedIntent,
      effectiveModeInstruction,
    };
  }
}
