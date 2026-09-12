import { describe, expect, it, vi, beforeEach } from "vitest";
import { ModeService } from "../src/services/mode.service";
import { AdaptiveIntentService } from "../src/services/adaptive-intent.service";
import { ExecutionPlannerService } from "../src/services/execution-planner.service";
import { ConversationService } from "../src/services/conversation.service";
import { MODES, MODE_KEYS, type ModeKey } from "../src/config/mode";

describe("Production Red-Team Audit & Architectural Verification Suite", () => {
  let mockConversations: ConversationService;
  let modeService: ModeService;
  let executionPlanner: ExecutionPlannerService;
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
    executionPlanner = new ExecutionPlannerService(modeService);
  });

  describe("Audit 1 & 2: Complete Request Lifecycle & Same-Turn Execution", () => {
    it("executes new mode instructions immediately in the SAME turn", async () => {
      const userId = 101;
      expect(await mockConversations.getUserMode(userId)).toBe("general");

      const rawInput = "Switch to study mode and explain calculus derivatives"; 
      const intent = AdaptiveIntentService.detectModeSwitchIntent(rawInput, modeService);

      expect(intent.isModeSwitch).toBe(true);
      expect(intent.requestedMode).toBe("study");
      expect(intent.cleanedPrompt).toBe("explain calculus derivatives");

      // Switch persistent mode
      const switchResult = await modeService.switchMode(userId, intent.requestedMode!, "natural_language");
      expect(switchResult.activeMode).toBe("study");
      expect(await mockConversations.getUserMode(userId)).toBe("study");

      // Execute prompt in SAME turn with newly updated mode
      const plan = executionPlanner.plan(intent.cleanedPrompt!, switchResult.activeMode);
      expect(plan.effectiveMode).toBe("study");
      expect(plan.effectiveSystemPrompt).toContain("study tutor");
      expect(plan.requiredCapabilities).toContain("tutoring");
    });
  });

  describe("Audit 3 & 4: Persistence & Temporary vs Persistent Overrides", () => {
    it("maintains persistent mode across separate turns", async () => {
      const userId = 202;
      await modeService.switchMode(userId, "coder", "command");
      expect(await mockConversations.getUserMode(userId)).toBe("coder");

      // Turn 2
      const turn2Plan = executionPlanner.plan("How do I fix this async bug?", await mockConversations.getUserMode(userId));
      expect(turn2Plan.effectiveMode).toBe("coder");
      expect(await mockConversations.getUserMode(userId)).toBe("coder");
    });

    it("handles temporary turn mode overrides without altering persistent mode", async () => {
      const userId = 303;
      // Persistent mode = general
      expect(await mockConversations.getUserMode(userId)).toBe("general");

      const prompt = "For this question, act as a coding expert and review this function";
      const intent = AdaptiveIntentService.detectModeSwitchIntent(prompt, modeService);

      // Temporary override should NOT trigger a persistent mode switch
      expect(intent.isModeSwitch).toBe(false);

      // ExecutionPlanner should resolve effective turn mode as coder
      const plan = executionPlanner.plan(prompt, await mockConversations.getUserMode(userId));
      expect(plan.persistentMode).toBe("general");
      expect(plan.effectiveMode).toBe("coder");
      expect(plan.turnModeOverride).toBe("coder");

      // Persistent mode in DB remains general
      expect(await mockConversations.getUserMode(userId)).toBe("general");
    });
  });

  describe("Audit 5 & 6: Semantic Natural Language Intent & Ambiguity Safety", () => {
    it("accurately classifies semantically varied natural language requests", () => {
      const cases = [
        { text: "I want to study now.", expected: "study" },
        { text: "Teach me this like a tutor.", expected: "study" },
        { text: "I want you to tutor me for my upcoming exam.", expected: "study" },
        { text: "Let's work on some code.", expected: "coder" },
        { text: "Act as my senior developer.", expected: "coder" },
        { text: "Research this thoroughly using current sources.", expected: "deep_research" },
        { text: "Let's investigate this topic.", expected: "deep_research" },
        { text: "Help me solve this equation.", expected: "math" },
        { text: "Give me a creative version.", expected: "creative" },
        { text: "Back to normal.", expected: "general" },
        { text: "Forget the special mode.", expected: "general" },
      ];

      for (const item of cases) {
        const intent = AdaptiveIntentService.detectModeSwitchIntent(item.text, modeService);
        expect(intent.isModeSwitch).toBe(true);
        expect(intent.requestedMode).toBe(item.expected);
        expect(intent.isAmbiguous).toBe(false);
      }
    });

    it("rejects ambiguous requests without silently mutating persistent state", () => {
      const ambiguousRequests = [
        "Let's work differently.",
        "Be more serious.",
        "Change your style.",
        "Can you help me with this?",
      ];

      for (const req of ambiguousRequests) {
        const intent = AdaptiveIntentService.detectModeSwitchIntent(req, modeService);
        if (intent.isModeSwitch) {
          expect(intent.isAmbiguous).toBe(true);
          expect(intent.requestedMode).toBeUndefined();
        } else {
          expect(intent.isModeSwitch).toBe(false);
        }
      }
    });
  });

  describe("Audit 7, 8, & 9: Canonicalization & Security", () => {
    it("maps all aliases strictly to canonical IDs", () => {
      expect(modeService.resolveMode("coding")).toBe("coder");
      expect(modeService.resolveMode("developer")).toBe("coder");
      expect(modeService.resolveMode("tutor")).toBe("study");
      expect(modeService.resolveMode("research")).toBe("deep_research");
      expect(modeService.resolveMode("mathematics")).toBe("math");
      expect(modeService.resolveMode("writing")).toBe("creative");
      expect(modeService.resolveMode("normal")).toBe("general");
      expect(modeService.resolveMode("automatic")).toBe("auto");
    });

    it("blocks malicious, invalid, or injected mode identifiers from persistence", async () => {
      const invalidInputs = [
        "banana",
        "../../etc",
        "DROP TABLE users;",
        "<script>alert(1)</script>",
      ];

      for (const input of invalidInputs) {
        await expect(modeService.switchMode(404, input, "command")).rejects.toThrow();
      }

      expect(userModesDb.size).toBe(0);
    });
  });

  describe("Audit 10 & 11: Concurrency Protection & Locking", () => {
    it("serializes concurrent mode switches per user without state corruption", async () => {
      const userId = 505;

      const p1 = modeService.switchMode(userId, "study", "command");
      const p2 = modeService.switchMode(userId, "coder", "command");

      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect(await mockConversations.getUserMode(userId)).toBe("coder");
    });
  });

  describe("Audit 12 & 13: Execution Planner & Capability Resolution", () => {
    it("separates mode capability resolution from specific AI providers", () => {
      const studyPlan = executionPlanner.plan("Explain gravity", "study");
      expect(studyPlan.requiredCapabilities).toContain("tutoring");
      expect(studyPlan.requiredCapabilities).toContain("socratic_questioning");

      const coderPlan = executionPlanner.plan("Debug this function", "coder");
      expect(coderPlan.requiredCapabilities).toContain("code_generation");
      expect(coderPlan.requiredCapabilities).toContain("debugging");

      const researchPlan = executionPlanner.plan("What are the latest stock trends?", "deep_research");
      expect(researchPlan.requiredCapabilities).toContain("web_research");
      expect(researchPlan.requiredCapabilities).toContain("source_verification");
    });
  });

  describe("Audit 14 & 15: Deep Research & Auto Mode", () => {
    it("does not force web search for casual greetings in Deep Research mode", () => {
      const plan = executionPlanner.plan("hello there", "deep_research");
      expect(plan.enableSearch).toBe(false);
    });

    it("enables web search for factual/current inquiries in Deep Research mode", () => {
      const plan = executionPlanner.plan("what is the latest news today?", "deep_research");
      expect(plan.enableSearch).toBe(true);
    });

    it("classifies task-appropriate effective turn modes when persistent mode is auto", () => {
      expect(executionPlanner.plan("Help me debug this TypeScript code", "auto").effectiveMode).toBe("coder");
      expect(executionPlanner.plan("Solve equation 3x + 5 = 20", "auto").effectiveMode).toBe("math");
      expect(executionPlanner.plan("What is the latest score today?", "auto").effectiveMode).toBe("deep_research");
      expect(executionPlanner.plan("Explain quantum mechanics for my exam", "auto").effectiveMode).toBe("study");
      expect(executionPlanner.plan("Write a creative poem about the sea", "auto").effectiveMode).toBe("creative");
    });
  });
});
