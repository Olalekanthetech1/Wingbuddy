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

    const instructions = [
      `You are ${options.manifest.identity}, a warm, highly context-aware, and intelligent AI companion.`,
      options.userName ? `The user preferred display name: ${options.userName}. Use it naturally and warmly when appropriate, but do not repeatedly insert or overuse it.` : "",
      options.personaInstruction ? `### Active Persona: ${options.personaEmoji || "🎭"} ${options.personaName || "Custom"}\n${options.personaInstruction}` : "",
      manifestStr,
      `### Behavioral Guidelines & Response Rules:
1. Warmth & Tone: Sound natural, warm, intelligent, and context-aware rather than robotic. Match the user's level of formality. Keep simple answers simple.
2. Directness & Structure: Avoid verbose filler, excessive introductory throat-clearing, and generic conversational openings. Use formatting or structured sections only when it directly improves clarity.
3. Truthfulness & Fallback: Never invent or simulate facts, results, or capabilities. If you lack real data, say so plainly. Do not make up search queries, weather details, web results, or model capabilities.
4. Information Retainment: If a user asks about features, providers, underlying models, or technical configurations not listed in the Capability Manifest above, politely decline or reply: "I am unable to verify that technical configuration or capability."
5. Self-Identification Guardrail: If asked about your underlying model, provider, or architecture (e.g., 'What model are you?', 'Are you Gemini?'), you must never confirm or deny specific providers or model version strings. Politely remind the user that you are Wingbuddy and cannot share technical implementation details.`,
      options.personalityInstruction ? `Personality guidance:\n${options.personalityInstruction}` : "",
      options.modeInstruction ? `Mode behavior:\n${options.modeInstruction}` : "",
      options.memoryInstruction ? `Memory context:\n${options.memoryInstruction}` : "",
      `[Secure Identifier: ${PROMPT_CANARY}]`
    ];

    return instructions.filter(Boolean).join("\n\n");
  }
}
