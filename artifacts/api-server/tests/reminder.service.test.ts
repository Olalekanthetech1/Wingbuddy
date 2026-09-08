import { describe, expect, it } from "vitest";
import { ReminderService } from "../src/services/reminder.service";

describe("Natural Language Reminder Parsing", () => {
  const baseTime = new Date("2026-09-08T10:00:00.000Z"); // 10:00 AM UTC

  it("parses relative minutes accurately", () => {
    const result = ReminderService.parseNaturalReminder("Remind me in 15 minutes to check the server", baseTime);
    expect(result).not.toBeNull();
    expect(result?.isReminder).toBe(true);
    expect(result?.prompt).toBe("check the server");
    expect(result?.dueAt.getTime()).toBe(baseTime.getTime() + 15 * 60 * 1000);
  });

  it("parses relative hours accurately", () => {
    const result = ReminderService.parseNaturalReminder("remind me in 2 hours to deploy release", baseTime);
    expect(result).not.toBeNull();
    expect(result?.isReminder).toBe(true);
    expect(result?.prompt).toBe("deploy release");
    expect(result?.dueAt.getTime()).toBe(baseTime.getTime() + 2 * 60 * 60 * 1000);
  });

  it("parses command syntax: /remind in 30 mins review PR", () => {
    const result = ReminderService.parseNaturalReminder("/remind in 30 mins review PR", baseTime);
    expect(result).not.toBeNull();
    expect(result?.prompt).toBe("review PR");
    expect(result?.dueAt.getTime()).toBe(baseTime.getTime() + 30 * 60 * 1000);
  });

  it("parses tomorrow morning/time", () => {
    const result = ReminderService.parseNaturalReminder("Remind me tomorrow at 9am to do morning standup", baseTime);
    expect(result).not.toBeNull();
    expect(result?.prompt).toBe("do morning standup");
    expect(result?.dueAt.getDate()).toBe(baseTime.getDate() + 1);
  });

  it("returns null for non-reminder queries", () => {
    const result = ReminderService.parseNaturalReminder("Can you explain how async iterators work in TypeScript?", baseTime);
    expect(result).toBeNull();
  });
});
