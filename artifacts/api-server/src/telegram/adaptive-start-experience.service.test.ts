import { AdaptiveStartExperienceService } from "./adaptive-start-experience.service";

const service = new AdaptiveStartExperienceService();

describe("AdaptiveStartExperienceService", () => {
  it("adapts to persisted user and runtime state", () => {
    const text = service.build({
      displayName: "Alex",
      isReturningUser: true,
      mode: "coding",
      personality: "focused",
      activeTaskCount: 1,
      activeReminderCount: 2,
      activeSessionCount: 3,
      capabilities: ["Conversation", "Memory", "Autonomous workflows"],
    });
    expect(text).toContain("Welcome back");
    expect(text).toContain("Alex");
    expect(text).toContain("Mode:");
    expect(text).toContain("Personality:");
    expect(text).toContain("Autonomous workflows");
    expect(text).toContain("1 active task");
    expect(text).toContain("2 pending reminders");
  });

  it("keeps a neutral fallback when capability metadata is empty", () => {
    const text = service.build({
      displayName: "New user",
      isReturningUser: false,
      mode: "general",
      personality: "balanced",
      activeTaskCount: 0,
      activeReminderCount: 0,
      activeSessionCount: 0,
      capabilities: [],
    });
    expect(text).toContain("Welcome");
    expect(text).toContain("Conversation and context-aware assistance");
    expect(text).toContain("Nothing is waiting on you right now");
  });
});
