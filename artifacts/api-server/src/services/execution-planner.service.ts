import { MODES, type Capability, type ModeKey } from "../config/mode";
import { ModeService } from "./mode.service";
import { logger } from "../lib/logger";
import { semanticInteractionCache, type SemanticInteractionDecision } from "./semantic-interaction-cache.service";

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
  requiredCapabilities: Capability[];
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  providerPreference: "gemini_flash" | "gemini_pro" | "default";
  imagePrompt?: string;
  videoPrompt?: string;
  effectiveSystemPrompt: string;
  formattingProfile: string;
}

export class ExecutionPlannerService {
  constructor(private readonly modeService: ModeService) {}

  plan(
    text: string,
    persistentMode: ModeKey,
    history: Array<{ role: string; content: string }> = [],
  ): ExecutionPlan {
    const trimmed = text.trim();
    const isGreeting = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|greetings)\b/i.test(trimmed);

    // Check for temporary turn mode override
    let turnModeOverride: ModeKey | undefined;
    const tempOverrideMatch = trimmed.match(
      /^(?:for this (?:question|turn|prompt|request)|just for now|temporarily)[,\s]+(?:act as|be|switch to|use)\s+(?:a\s+|an\s+)?([a-z_]+(?:\s+[a-z_]+)?)/i,
    );
    if (tempOverrideMatch) {
      const target = tempOverrideMatch[1].trim().split(/\s+/)[0];
      const resolved = this.modeService.resolveMode(target) || this.modeService.resolveMode(tempOverrideMatch[1].trim());
      if (resolved) {
        turnModeOverride = resolved;
      }
    }

    const cachedSemantic = semanticInteractionCache.get(text, persistentMode, history);
    const semantic = cachedSemantic || this.fallbackDecision(persistentMode, isGreeting);
    let effectiveMode: ModeKey;
    if (turnModeOverride) {
      effectiveMode = turnModeOverride;
    } else if (persistentMode === "auto") {
      effectiveMode =
        (cachedSemantic?.effectiveMode && cachedSemantic.effectiveMode !== "auto" ? cachedSemantic.effectiveMode : null) ||
        this.inferAutoTurnMode(trimmed) ||
        this.modeService.resolveMode("general") ||
        "general";
    } else {
      effectiveMode = persistentMode;
    }

    const profile = MODES[effectiveMode] || MODES.general;
    const capabilities = new Set<Capability>(profile.capabilitiesList);

    for (const capability of semantic.requiredCapabilities) {
      if ([
        "tutoring", "active_recall", "socratic_questioning", "code_generation", "code_analysis",
        "debugging", "web_research", "source_verification", "document_analysis",
        "mathematical_reasoning", "image_analysis", "file_generation", "memory", "calculator",
      ].includes(capability as Capability)) {
        capabilities.add(capability as Capability);
      }
    }

    const enableSearch = effectiveMode === "deep_research" ? !isGreeting : (semantic.enableSearch && profile.capabilities.toolPermissions.searchAllowed);
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
      turnModeOverride,
      detectedIntent,
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
      requiredCapabilities: plan.requiredCapabilities,
      enableSearch: plan.enableSearch,
      thinkingLevel: plan.thinkingLevel,
      providerPreference: plan.providerPreference,
      semanticConfidence: semantic.confidence,
    }, "EXECUTION_PLAN_CREATED");

    return plan;
  }

  private inferAutoTurnMode(text: string): ModeKey | null {
    if (/\b(?:debug|typescript|python|javascript|code|coding|function|class|compiler|bug|stack\s*trace)\b/i.test(text)) {
      return "coder";
    }
    if (/\b(?:solve\s+equation|equation|\d+x|\d+\s*[+\-*/=]\s*\d+|integral|derivative|calculus|algebra|theorem)\b/i.test(text)) {
      return "math";
    }
    if (/\b(?:latest|news|today|current\s+price|score|weather|announcement)\b/i.test(text)) {
      return "deep_research";
    }
    if (/\b(?:explain\s+.*(?:exam|class|lesson)|exam|quiz|tutor|tutoring|teach\s+me)\b/i.test(text)) {
      return "study";
    }
    if (/\b(?:poem|creative|story|fiction|narrative|rhyme)\b/i.test(text)) {
      return "creative";
    }
    return null;
  }

  private fallbackDecision(mode: ModeKey, isGreeting = false): SemanticInteractionDecision {
    const resolvedMode = mode === "auto" ? "general" : mode;
    const profile = MODES[resolvedMode] || MODES.general;
    return {
      intent: "general",
      effectiveMode: resolvedMode,
      requiredCapabilities: profile.capabilitiesList,
      enableSearch: resolvedMode === "deep_research" ? !isGreeting : profile.researchPolicy === "always",
      thinkingLevel: profile.capabilities.thinkingLevelDefault,
      isModeSwitch: false,
      isGreeting,
      complexity: "simple",
      confidence: 0,
    };
  }
}
