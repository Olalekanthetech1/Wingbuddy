import { describe, it, expect } from "vitest";
import { AdaptiveStartExperienceService } from "./adaptive-start-experience.service";

const service = new AdaptiveStartExperienceService();

describe("AdaptiveStartExperienceService", () => {
  it("adapts to persisted user and runtime state", () => {
    const text = service.build({
      displayName: "Alex",
      isReturningUser: true,
      mode: "coder",
      activeTaskCount: 1,
      activeReminderCount: 2,
      recentSessionAvailable: false,
      timezone: "UTC",
    });
    expect(text).toContain("Alex");
    expect(text).toContain("Coder");
    expect(text).toContain("1</b> active task");
    expect(text).toContain("2</b> reminders scheduled");
    expect(text).toContain("What should we tackle next?");
  });

  it("handles new user with empty state gracefully", () => {
    const text = service.build({
      displayName: "New user",
      isReturningUser: false,
      mode: "general",
      activeTaskCount: 0,
      activeReminderCount: 0,
      recentSessionAvailable: false,
      timezone: "UTC",
    });
    expect(text).toContain("New user");
    expect(text).toContain("General Assistant");
    expect(text).toContain("Nothing urgent is waiting");
    expect(text).toContain("Let’s get started");
  });
});
