import { describe, expect, it, vi, beforeEach } from "vitest";
import { ModeService } from "../src/services/mode.service";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";
import { semanticInteractionCache, type SemanticInteractionDecision } from "../src/services/semantic-interaction-cache.service";
import { ConversationService } from "../src/services/conversation.service";
import { MODE_KEYS, type ModeKey } from "../src/config/mode";

describe("ModeService & Semantic Adaptive Mode Switching Engine", () => {
  let mockConversations: ConversationService;
  let modeService: ModeService;
  let userModesDb: Map<number, ModeKey>;

  const seedSemanticDecision = (
    text: string,
    decision: Partial<SemanticInteractionDecision> & Pick<SemanticInteractionDecision, "intent">,
    mode: ModeKey = "general",
  ): void => {
    semanticInteractionCache.set(text, mode, [], {
      intent: decision.intent,
      effectiveMode: decision.effectiveMode,
      requiredCapabilities: decision.requiredCapabilities || [],
      enableSearch: decision.enableSearch ?? false,
      thinkingLevel: decision.thinkingLevel,
      isModeSwitch: decision.isModeSwitch ?? false,
      requestedMode: decision.requestedMode,
      cleanedPrompt: decision.cleanedPrompt,
      isGreeting: decision.isGreeting ?? false,
      complexity: decision.complexity ?? "simple",
      confidence: decision.confidence ?? 0.99,
      taskIntent: decision.taskIntent,
      taskTitle: decision.taskTitle,
      taskGoal: decision.taskGoal,
      taskIdHint: decision.taskIdHint,
      taskSteps: decision.taskSteps,
      conversationOperation: decision.conversationOperation,
      conversationTargetHistoryIndices: decision.conversationTargetHistoryIndices,
      unresolvedReference: decision.unresolvedReference,
    });
  };

  beforeEach(() => {
    semanticInteractionCache.clear();
    userModesDb = new Map<number, ModeKey>();
    mockConversations = {
      getUserMode: vi.fn().mockImplementation(async (userId: number) => userModesDb.get(userId) || "general"),
      setUserMode: vi.fn().mockImplementation(async (userId: number, mode: ModeKey) => { userModesDb.set(userId, mode); }),
    } as unknown as ConversationService;
    modeService = new ModeService(mockConversations);
  });

  it("resolves exact mode keys correctly", () => {
    for (const key of MODE_KEYS) {
      expect(modeService.resolveCanonicalMode(key)).toBe(key);
      expect(modeService.resolveCanonicalMode(` ${key.toUpperCase()} `)).toBe(key);
    }
  });

  it("resolves configured aliases without classifying full user messages", () => {
    expect(modeService.resolveCanonicalMode("coding")).toBe("coder");
    expect(modeService.resolveCanonicalMode("developer")).toBe("coder");
    expect(modeService.resolveCanonicalMode("tutor")).toBe("study");
    expect(modeService.resolveCanonicalMode("research")).toBe("deep_research");
    expect(modeService.resolveCanonicalMode("logic")).toBe("math");
    expect(modeService.resolveCanonicalMode("writer")).toBe("creative");
    expect(modeService.resolveCanonicalMode("normal")).toBe("general");
  });

  it("returns null for unsupported mode strings", () => {
    expect(modeService.resolveCanonicalMode("fly_to_mars")).toBeNull();
    expect(modeService.resolveCanonicalMode("super_ai")).toBeNull();
    expect(modeService.resolveCanonicalMode("")).toBeNull();
  });

  it("persists valid mode switches and is idempotent", async () => {
    const userId = 10001;
    const result = await modeService.switchMode(userId, "study", "command");
    expect(result.activeMode).toBe("study");
    expect(result.changed).toBe(true);
    expect(result.persisted).toBe(true);
    expect(await mockConversations.getUserMode(userId)).toBe("study");

    const second = await modeService.switchMode(userId, "study", "command");
    expect(second.changed).toBe(false);
    expect(mockConversations.setUserMode).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported mode switches without mutating state", async () => {
    const userId = 10003;
    await expect(modeService.switchMode(userId, "invalid_mode_xyz", "command")).rejects.toThrow('Unsupported or unrecognized mode requested: "invalid_mode_xyz"');
    expect(mockConversations.setUserMode).not.toHaveBeenCalled();
  });

  it("uses the semantic resolver result for natural-language mode switches", () => {
    const queries = [
      { text: "Please switch to study mode", expected: "study" },
      { text: "Can you switch to research mode?", expected: "deep_research" },
      { text: "Activate coding mode", expected: "coder" },
      { text: "Act as a tutor for me", expected: "study" },
      { text: "Turn on developer mode", expected: "coder" },
      { text: "Let's switch to reasoning mode", expected: "math" },
      { text: "Change mode to writing", expected: "creative" },
      { text: "Be my travel planner", expected: "general" },
      { text: "Switch back to general mode", expected: "general" },
    ] as const;
    for (const item of queries) {
      seedSemanticDecision(item.text, { intent: "general", isModeSwitch: true, requestedMode: item.expected as ModeKey });
      const intent = AdaptiveIntentService.detectModeSwitchIntent(item.text, modeService);
      expect(intent.isModeSwitch).toBe(true);
      expect(intent.requestedMode).toBe(item.expected);
    }
  });

  it("does not classify natural language when semantic resolution is unavailable", () => {
    for (const q of ["Please switch to study mode", "Act as a tutor", "Turn on developer mode"]) {
      expect(AdaptiveIntentService.detectModeSwitchIntent(q, modeService)).toEqual({ isModeSwitch: false });
    }
  });

  it("preserves a semantic cleaned prompt for same-turn execution", async () => {
    const original = "Switch to study mode and explain photosynthesis step by step";
    const cleanedPrompt = "explain photosynthesis step by step";
    seedSemanticDecision(original, { intent: "study", effectiveMode: "study", isModeSwitch: true, requestedMode: "study", cleanedPrompt });
    const intent = AdaptiveIntentService.detectModeSwitchIntent(original, modeService);
    const result = await modeService.switchMode(30001, intent.requestedMode!, "natural_language");
    seedSemanticDecision(cleanedPrompt, { intent: "study", effectiveMode: "study", requiredCapabilities: ["tutoring"] }, result.activeMode);
    const plan = AdaptiveIntentService.analyze(cleanedPrompt, result.activeMode, []);
    expect(plan.effectiveModeInstruction).toContain("patient study tutor");
    expect(plan.detectedIntent).toBe("study");
  });

  it("honors semantic greeting and live-search decisions", () => {
    const greeting = "Hello! Hope you are having a nice day.";
    seedSemanticDecision(greeting, { intent: "greeting", isGreeting: true, effectiveMode: "deep_research", enableSearch: false });
    expect(AdaptiveIntentService.analyze(greeting, "deep_research").enableSearch).toBe(false);

    const research = "What are the latest developments in fusion energy technology?";
    seedSemanticDecision(research, { intent: "search_grounding", effectiveMode: "deep_research", enableSearch: true });
    expect(AdaptiveIntentService.analyze(research, "deep_research").enableSearch).toBe(true);
  });

  it("serializes concurrent mode switches for the same user", async () => {
    const userId = 40001;
    const results = await Promise.all([
      modeService.switchMode(userId, "study", "command"),
      modeService.switchMode(userId, "coder", "natural_language"),
      modeService.switchMode(userId, "math", "callback"),
    ]);
    expect(results).toHaveLength(3);
    expect(await mockConversations.getUserMode(userId)).toBe("math");
  });
});
