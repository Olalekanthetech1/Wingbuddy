import { describe, expect, it, vi, beforeEach } from "vitest";
import { ModeService } from "../src/services/mode.service";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";
import { ConversationService } from "../src/services/conversation.service";
import { MODES, MODE_KEYS, type ModeKey } from "../src/config/mode";

describe("ModeService & Dynamic Adaptive Mode Switching Engine", () => {
  let mockConversations: ConversationService;
  let modeService: ModeService;
  let userModesDb: Map<number, ModeKey>;

  beforeEach(() => {
    userModesDb = new Map<number, ModeKey>();

    mockConversations = {
      getUserMode: vi.fn().mockImplementation(async (userId: number) => {
        return userModesDb.get(userId) || "general";
      }),
      setUserMode: vi.fn().mockImplementation(async (userId: number, mode: ModeKey) => {
        userModesDb.set(userId, mode);
      }),
    } as unknown as ConversationService;

    modeService = new ModeService(mockConversations);
  });

  describe("1. Canonical Mode Resolution & Validation", () => {
    it("resolves exact mode keys correctly", () => {
      for (const key of MODE_KEYS) {
        expect(modeService.resolveCanonicalMode(key)).toBe(key);
        expect(modeService.resolveCanonicalMode(` ${key.toUpperCase()} `)).toBe(key);
      }
    });

    it("resolves natural language mode synonyms and role aliases", () => {
      expect(modeService.resolveCanonicalMode("coder")).toBe("coder");
      expect(modeService.resolveCanonicalMode("coding")).toBe("coder");
      expect(modeService.resolveCanonicalMode("developer")).toBe("coder");
      expect(modeService.resolveCanonicalMode("tutor")).toBe("study");
      expect(modeService.resolveCanonicalMode("teacher")).toBe("study");
      expect(modeService.resolveCanonicalMode("deep_research")).toBe("deep_research");
      expect(modeService.resolveCanonicalMode("research")).toBe("deep_research");
      expect(modeService.resolveCanonicalMode("web_search")).toBe("deep_research");
      expect(modeService.resolveCanonicalMode("logic")).toBe("math");
      expect(modeService.resolveCanonicalMode("math")).toBe("math");
      expect(modeService.resolveCanonicalMode("reasoning")).toBe("math");
      expect(modeService.resolveCanonicalMode("writer")).toBe("creative");
      expect(modeService.resolveCanonicalMode("creative")).toBe("creative");
      expect(modeService.resolveCanonicalMode("brainstorm")).toBe("creative");
      expect(modeService.resolveCanonicalMode("travel_planner")).toBe("general");
      expect(modeService.resolveCanonicalMode("normal")).toBe("general");
    });

    it("returns null for unsupported or malformed mode strings", () => {
      expect(modeService.resolveCanonicalMode("fly_to_mars")).toBeNull();
      expect(modeService.resolveCanonicalMode("super_ai")).toBeNull();
      expect(modeService.resolveCanonicalMode("")).toBeNull();
    });
  });

  describe("2. Authoritative Mode Switch Persistence & Idempotency", () => {
    it("persists valid mode switches to database and updates state", async () => {
      const userId = 10001;
      const result = await modeService.switchMode(userId, "study", "command");

      expect(result.previousMode).toBe("general");
      expect(result.activeMode).toBe("study");
      expect(result.changed).toBe(true);
      expect(result.persisted).toBe(true);
      expect(mockConversations.setUserMode).toHaveBeenCalledWith(userId, "study");
      expect(await mockConversations.getUserMode(userId)).toBe("study");
    });

    it("is idempotent when user requests already active mode", async () => {
      const userId = 10002;
      userModesDb.set(userId, "coder");

      const result = await modeService.switchMode(userId, "coder", "natural_language");

      expect(result.previousMode).toBe("coder");
      expect(result.activeMode).toBe("coder");
      expect(result.changed).toBe(false);
      expect(result.persisted).toBe(true);
      // setUserMode should NOT be called again for idempotent switch
      expect(mockConversations.setUserMode).not.toHaveBeenCalled();
    });

    it("throws an error when an unsupported mode is requested and does NOT mutate DB", async () => {
      const userId = 10003;
      userModesDb.set(userId, "general");

      await expect(modeService.switchMode(userId, "invalid_mode_xyz", "command")).rejects.toThrow(
        'Unsupported or unrecognized mode requested: "invalid_mode_xyz"',
      );

      expect(mockConversations.setUserMode).not.toHaveBeenCalled();
      expect(await mockConversations.getUserMode(userId)).toBe("general");
    });
  });

  describe("3. Natural Language Mode Intent Detection (AdaptiveIntentService)", () => {
    it("detects natural language mode switch intents correctly", () => {
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
      ];

      for (const item of queries) {
        const intent = AdaptiveIntentService.detectModeSwitchIntent(item.text, modeService);
        expect(intent.isModeSwitch).toBe(true);
        expect(intent.requestedMode).toBe(item.expected);
      }
    });

    it("extracts cleaned prompt when user combines mode switch with a question", () => {
      const text = "Switch to study mode and explain photosynthesis step by step";
      const intent = AdaptiveIntentService.detectModeSwitchIntent(text, modeService);

      expect(intent.isModeSwitch).toBe(true);
      expect(intent.requestedMode).toBe("study");
      expect(intent.cleanedPrompt).toBe("explain photosynthesis step by step");
    });

    it("returns isModeSwitch: false for standard conversational messages without mode switch intent", () => {
      const normalQueries = [
        "What is the distance to the moon?",
        "Can you help me solve this physics homework?",
        "I need a good Python script to process JSON",
        "Hello, good morning!",
      ];

      for (const q of normalQueries) {
        const intent = AdaptiveIntentService.detectModeSwitchIntent(q, modeService);
        expect(intent.isModeSwitch).toBe(false);
        expect(intent.requestedMode).toBeUndefined();
      }
    });
  });

  describe("4. Voice Transcribed & Multimodal Mode Switch Requests", () => {
    it("handles transcribed voice note requesting mode switch", async () => {
      const userId = 20001;
      const voiceTranscription = "Hey assistant, please turn on coding mode";

      const intent = AdaptiveIntentService.detectModeSwitchIntent(voiceTranscription, modeService);
      expect(intent.isModeSwitch).toBe(true);
      expect(intent.requestedMode).toBe("coder");

      const switchResult = await modeService.switchMode(userId, intent.requestedMode!, "voice");
      expect(switchResult.activeMode).toBe("coder");
      expect(await mockConversations.getUserMode(userId)).toBe("coder");
    });
  });

  describe("5. Same-Turn Execution & Capabilities Adaptation", () => {
    it("applies new mode capabilities immediately to execution plan in same turn", async () => {
      const userId = 30001;
      const userPrompt = "Switch to study mode and explain quantum computing";

      // 1. Detect switch
      const intent = AdaptiveIntentService.detectModeSwitchIntent(userPrompt, modeService);
      expect(intent.isModeSwitch).toBe(true);

      // 2. Perform switch
      const switchResult = await modeService.switchMode(userId, intent.requestedMode!, "natural_language");
      expect(switchResult.activeMode).toBe("study");

      // 3. Execution plan using newly resolved mode immediately in same turn!
      const plan = AdaptiveIntentService.analyze(intent.cleanedPrompt!, switchResult.activeMode);
      expect(plan.effectiveModeInstruction).toContain("patient study tutor");
      expect(plan.detectedIntent).toBe("study");
    });

    it("does not blindly invoke web search for casual greetings in Deep Research mode", () => {
      const casualGreeting = "Hello! Hope you are having a nice day.";
      const plan = AdaptiveIntentService.analyze(casualGreeting, "deep_research");

      expect(plan.enableSearch).toBe(false);
      expect(plan.detectedIntent).toBe("general");
    });

    it("enables web search for informational queries in Deep Research mode", () => {
      const researchQuery = "What are the latest developments in fusion energy technology?";
      const plan = AdaptiveIntentService.analyze(researchQuery, "deep_research");

      expect(plan.enableSearch).toBe(true);
      expect(plan.detectedIntent).toBe("search_grounding");
    });
  });

  describe("6. Race Condition & Concurrency Protection", () => {
    it("handles concurrent mode switch requests cleanly without race condition corruption", async () => {
      const userId = 40001;

      // Fire 3 concurrent mode switches for the same user
      const switch1 = modeService.switchMode(userId, "study", "command");
      const switch2 = modeService.switchMode(userId, "coder", "natural_language");
      const switch3 = modeService.switchMode(userId, "math", "callback");

      const results = await Promise.all([switch1, switch2, switch3]);

      // All 3 completed without throwing race condition error
      expect(results).toHaveLength(3);

      // Final state in DB should match the last executed mode ("math")
      const finalMode = await mockConversations.getUserMode(userId);
      expect(finalMode).toBe("math");
    });
  });
});
