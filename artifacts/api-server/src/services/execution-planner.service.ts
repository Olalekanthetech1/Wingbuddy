import {
  MODES,
  type Capability,
  type ModeKey,
  type ModeProfile,
} from "../config/mode";
import { ModeService } from "./mode.service";
import { ImageGenerationService } from "./image-generation.service";
import { VideoGenerationService } from "./video-generation.service";
import { logger } from "../lib/logger";

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
    | "writing"
    | "brainstorming"
    | "general";
  requiredCapabilities: Capability[];
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH" | undefined;
  providerPreference: "gemini_flash" | "gemini_pro" | "default";
  imagePrompt?: string;
  videoPrompt?: string;
  effectiveSystemPrompt: string;
  formattingProfile: string;
}

export class ExecutionPlannerService {
  constructor(private modeService: ModeService) {}

  /**
   * Plans complete execution pipeline given user text, persistent mode, and conversation history.
   */
  plan(
    text: string,
    persistentMode: ModeKey,
    history: Array<{ role: string; content: string }> = [],
  ): ExecutionPlan {
    const trimmed = text.trim();

    // 1. Resolve Turn Mode
    const effectiveTurnMode = this.modeService.resolveTurnMode(
      trimmed,
      persistentMode,
      history,
    );
    const modeProfile = this.modeService.getModeConfig(effectiveTurnMode);

    // 2. Check for multimodal media generation tasks
    const isVideoGen =
      /^\/(video|vid|clip|movie)\b/i.test(trimmed) ||
      /\b(generate|create|render|make|produce)\s+(me\s+)?(an?\s+)?(video|clip|animation|mp4|short film|movie clip)\b/i.test(
        trimmed,
      );

    if (isVideoGen) {
      const extractedVideoPrompt =
        VideoGenerationService.extractVideoPrompt(trimmed) || trimmed;
      const capabilities: Capability[] = ["file_generation"];

      logger.info(
        { persistentMode, effectiveTurnMode, capabilities },
        "CAPABILITIES_RESOLVED",
      );

      const plan: ExecutionPlan = {
        persistentMode,
        effectiveMode: effectiveTurnMode,
        detectedIntent: "video_generation",
        requiredCapabilities: capabilities,
        enableSearch: false,
        thinkingLevel: undefined,
        providerPreference: "default",
        videoPrompt: extractedVideoPrompt,
        effectiveSystemPrompt: modeProfile.systemBehavior,
        formattingProfile: modeProfile.formattingProfile,
      };

      logger.info({ plan }, "EXECUTION_PLAN_CREATED");
      return plan;
    }

    const isImageGen =
      /^\/(image|draw|img|paint)\b/i.test(trimmed) ||
      /\b(generate|create|draw|paint|render|make|produce|visualize)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|portrait|wallpaper|painting|artwork)\b/i.test(
        trimmed,
      );

    if (isImageGen) {
      const extractedImagePrompt =
        ImageGenerationService.extractImagePrompt(trimmed) || trimmed;
      const capabilities: Capability[] = ["image_analysis"];

      logger.info(
        { persistentMode, effectiveTurnMode, capabilities },
        "CAPABILITIES_RESOLVED",
      );

      const plan: ExecutionPlan = {
        persistentMode,
        effectiveMode: effectiveTurnMode,
        detectedIntent: "image_generation",
        requiredCapabilities: capabilities,
        enableSearch: false,
        thinkingLevel: undefined,
        providerPreference: "default",
        imagePrompt: extractedImagePrompt,
        effectiveSystemPrompt: modeProfile.systemBehavior,
        formattingProfile: modeProfile.formattingProfile,
      };

      logger.info({ plan }, "EXECUTION_PLAN_CREATED");
      return plan;
    }

    // 3. Determine Search Requirement
    const hasQuestionOrFactRequest =
      /\?|\b(what|who|when|where|why|how|search|latest|news|weather|price|explain|solve|updates|events|status)\b/i.test(
        trimmed,
      );
    const isCasualGreeting =
      !hasQuestionOrFactRequest &&
      /^(hi|hello|hey|good\s*(morning|evening|afternoon)|sup|yo|hope you)\b/i.test(
        trimmed,
      );

    const temporalFactMatch =
      /\b(today|yesterday|tomorrow|tonight|right now|currently|current|latest|newest|recent|recently|upcoming|202[5-9]|news|headline|announcement|released|weather|price|stock|crypto)\b/i.test(
        trimmed,
      );

    const needsSearch =
      modeProfile.capabilities.toolPermissions.searchAllowed &&
      modeProfile.researchPolicy !== "never" &&
      ((modeProfile.researchPolicy === "always" && !isCasualGreeting) ||
        temporalFactMatch ||
        (history.length > 0 &&
          /\b(latest|current|recent|today)\b/i.test(
            history[history.length - 1]?.content || "",
          ) &&
          /\b(what about|how about|and|why)\b/i.test(trimmed)));

    // 4. Determine Reasoning Requirement
    const hasCodeBlock = /```/.test(trimmed);
    const isReasoningText =
      /\b(solve|equation|proof|theorem|calculat(e|ion)|derivative|integral|probability|riddle|paradox|system design|architecture|race condition|deadlock|time complexity|big o)\b/i.test(
        trimmed,
      );
    const isCodingText =
      /```[\s\S]*?```|\b(typescript|javascript|python|rust|golang|sql|react|function|class|async|refactor|implement|bug|stack trace)\b/i.test(
        trimmed,
      );

    const needsThinking =
      modeProfile.capabilities.toolPermissions.thinkingAllowed &&
      (effectiveTurnMode === "math" ||
        effectiveTurnMode === "coder" ||
        modeProfile.capabilities.thinkingLevelDefault !== undefined ||
        isReasoningText ||
        (isCodingText && (trimmed.includes("bug") || trimmed.includes("error"))) ||
        hasCodeBlock);

    // 5. Compose Required Capabilities
    const capabilitiesList = [...modeProfile.capabilitiesList];
    if (needsSearch && !capabilitiesList.includes("web_research")) {
      capabilitiesList.push("web_research", "source_verification");
    }
    if (needsThinking && !capabilitiesList.includes("mathematical_reasoning")) {
      capabilitiesList.push("mathematical_reasoning");
    }
    if (isCodingText && !capabilitiesList.includes("code_generation")) {
      capabilitiesList.push("code_generation", "code_analysis", "debugging");
    }

    logger.info(
      { persistentMode, effectiveTurnMode, capabilitiesList },
      "CAPABILITIES_RESOLVED",
    );

    // 6. Determine Intent & Provider Preference
    let detectedIntent: ExecutionPlan["detectedIntent"] = "general";
    if (needsSearch && !needsThinking) {
      detectedIntent = "search_grounding";
    } else if (needsThinking && !isCodingText) {
      detectedIntent = "deep_reasoning";
    } else if (isCodingText) {
      detectedIntent = "coding";
    } else if (effectiveTurnMode === "study") {
      detectedIntent = "study";
    } else if (effectiveTurnMode === "creative") {
      detectedIntent = "creative";
    }

    const providerPreference: ExecutionPlan["providerPreference"] =
      needsThinking || effectiveTurnMode === "math" || effectiveTurnMode === "coder"
        ? "gemini_pro"
        : "default";

    logger.info(
      { persistentMode, effectiveTurnMode, providerPreference },
      "PROVIDER_SELECTED",
    );

    // 7. Compose Effective System Prompt
    let effectiveSystemPrompt = modeProfile.systemBehavior;

    if (needsThinking && effectiveTurnMode !== "math") {
      effectiveSystemPrompt += `\n\n[SYSTEMATIC ADAPTATION]: Perform step-by-step reasoning, verify edge cases, and ensure precision before delivering your answer.`;
    }
    if (needsSearch && effectiveTurnMode !== "deep_research") {
      effectiveSystemPrompt += `\n\n[SYSTEMATIC ADAPTATION]: Ground your answer in recent up-to-date factual information.`;
    }

    const plan: ExecutionPlan = {
      persistentMode,
      effectiveMode: effectiveTurnMode,
      turnModeOverride:
        effectiveTurnMode !== persistentMode ? effectiveTurnMode : undefined,
      detectedIntent,
      requiredCapabilities: Array.from(new Set(capabilitiesList)),
      enableSearch: needsSearch,
      thinkingLevel: needsThinking
        ? modeProfile.capabilities.thinkingLevelDefault || "LOW"
        : undefined,
      providerPreference,
      effectiveSystemPrompt,
      formattingProfile: modeProfile.formattingProfile,
    };

    logger.info(
      {
        persistentMode,
        effectiveMode: plan.effectiveMode,
        detectedIntent: plan.detectedIntent,
        requiredCapabilities: plan.requiredCapabilities,
        enableSearch: plan.enableSearch,
        thinkingLevel: plan.thinkingLevel,
        providerPreference: plan.providerPreference,
      },
      "EXECUTION_PLAN_CREATED",
    );
    return plan;
  }
}
