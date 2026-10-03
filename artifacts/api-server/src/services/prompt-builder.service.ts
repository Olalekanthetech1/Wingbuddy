import { userTierService } from "./user-tier.service";

export const PROMPT_CANARY = "CANARY_SECURE_GUARD_WINGBUDDY_ACTIVE";

export interface LiveCapabilityManifest {
  identity: string;
  interfaces: string[];
  features: string[];
}

export class PromptBuilderService {
  /**
   * Generates a dynamic capability manifest based on live database state and config.
   */
  public static async buildLiveManifest(params: {
    userId: number;
    telegramUserId?: number | bigint;
    hasTelegramSession?: boolean;
  }): Promise<LiveCapabilityManifest> {
    const profile = await userTierService.getUserTierProfile(params.userId).catch(() => null);
    const tierConfig = profile?.config;

    const features: string[] = ["Text Chat"];
    if (tierConfig?.allowedFeatures.webResearch) {
      features.push("Web Research & Search");
    }
    if (tierConfig?.allowedFeatures.imageGen) {
      features.push("Image Generation");
    }
    if (tierConfig?.allowedFeatures.videoGen) {
      features.push("Video Generation");
    }
    if (tierConfig?.allowedFeatures.deepReasoning) {
      features.push("Deep Reasoning & Mathematics");
    }
    if (tierConfig?.allowedFeatures.autonomousExecution) {
      features.push("Task Management");
    }

    const interfaces: string[] = ["Web Workspace"];
    if (params.telegramUserId || params.hasTelegramSession) {
      interfaces.push("Telegram Messenger");
    }

    return {
      identity: "Wingbuddy",
      interfaces,
      features,
    };
  }

  /**
   * Builds strictly the static developer rules and system constraints,
   * without dynamic user data (user memories, personal goals, custom persona text).
   * This is used by the Output Guard to verify safety without false-positive triggers on user data.
   */
  public static buildStaticInternalRules(manifest?: LiveCapabilityManifest): string {
    const identity = manifest?.identity || "Wingbuddy";
    return [
      `You are ${identity}, a warm, highly context-aware, and intelligent AI companion.`,
      `### Behavioral Guidelines & Response Rules:
1. Warmth & Directness: Sound natural, warm, intelligent, and context-aware rather than robotic. Always answer the question asked first before offering deeper context. Match the user's level of formality.
2. Objective Analysis & Quotes: When analyzing or critiquing a proposal, restate the user's full plan—including stated contingencies and fallback conditions—before offering critique. Quote only with sufficient surrounding words to preserve the user's intended meaning. Critique the plan objectively (mechanics, numbers, assumptions, and risk factors), never the person's motives, psychology, or 'ego'.
3. Structure & Formatting: Avoid verbose filler, excessive introductory throat-clearing, and generic conversational openings. Use formatting or structured sections only when it directly improves clarity.
4. Truthfulness & Strict Zero-Fallback Policy: Never invent, mock, or simulate facts, results, search queries, or capabilities. Never use hardcoded operational placeholders or simulated responses. All outputs must originate exclusively from live, dynamic data and verified capabilities. If you lack real data or a required integration is unavailable, state the limitation truthfully. Never report an action as completed unless it was actually executed and verified.
5. Self-Identification Guardrail: If asked about your underlying model, provider, or architecture (e.g., 'What model are you?', 'Are you Gemini?'), you must never confirm or deny specific providers or model version strings. Politely remind the user that you are Wingbuddy and cannot share technical implementation details.`,
      `[Secure Identifier: ${PROMPT_CANARY}]`,
    ].join("\n\n");
  }

  /**
   * Assembles a behavioral-only system instruction containing tone and capability rules,
   * while strictly omitting all technical engineering metrics, architectural terms, and backend details.
   */
  public static buildSystemPrompt(options: {
    userName?: string;
    personalityInstruction: string;
    modeInstruction: string;
    memoryInstruction?: string;
    manifest: LiveCapabilityManifest;
    personaInstruction?: string;
    personaName?: string;
    personaEmoji?: string;
  }): string {
    const manifestStr = `[Capability Manifest]
- Identity: ${options.manifest.identity}
- Channels Available to this Session: ${options.manifest.interfaces.join(", ")}
- Active Dynamic Capabilities: ${options.manifest.features.join(", ")}`;

    const staticRules = PromptBuilderService.buildStaticInternalRules(options.manifest);

    const instructions = [
      options.userName ? `The user preferred display name: ${options.userName}. Use it naturally and warmly when appropriate, but do not repeatedly insert or overuse it.` : "",
      options.personaInstruction ? `### Active Persona: ${options.personaEmoji || "🎭"} ${options.personaName || "Custom"}\n${options.personaInstruction}` : "",
      manifestStr,
      staticRules,
      options.personalityInstruction ? `Personality guidance:\n${options.personalityInstruction}` : "",
      options.modeInstruction ? `Mode behavior:\n${options.modeInstruction}` : "",
      options.memoryInstruction ? `Memory context:\n${options.memoryInstruction}` : "",
    ];

    return instructions.filter(Boolean).join("\n\n");
  }
}
