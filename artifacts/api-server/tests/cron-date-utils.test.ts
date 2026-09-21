import { describe, it, expect } from "vitest";
import {
  getUtcWeekdayName,
  getUtcWeekdayIndex,
  computeNextUtcRun,
  formatDynamicScheduleDescription,
} from "../src/utils/cron-date-utils";

describe("cron-date-utils - Dynamic UTC Date Evaluations", () => {
  it("dynamically resolves UTC weekday names for all 7 days without static hardcoded arrays", () => {
    // 2026-09-20 is a Sunday
    const sunday = new Date("2026-09-20T12:00:00Z");
    expect(getUtcWeekdayName(sunday)).toBe("Sunday");

    // Check indices 0 through 6
    expect(getUtcWeekdayName(0)).toBe("Sunday");
    expect(getUtcWeekdayName(1)).toBe("Monday");
    expect(getUtcWeekdayName(2)).toBe("Tuesday");
    expect(getUtcWeekdayName(3)).toBe("Wednesday");
    expect(getUtcWeekdayName(4)).toBe("Thursday");
    expect(getUtcWeekdayName(5)).toBe("Friday");
    expect(getUtcWeekdayName(6)).toBe("Saturday");
  });

  it("dynamically resolves weekday name strings to UTC indices", () => {
    expect(getUtcWeekdayIndex("sunday")).toBe(0);
    expect(getUtcWeekdayIndex("Monday")).toBe(1);
    expect(getUtcWeekdayIndex("TUESDAY")).toBe(2);
    expect(getUtcWeekdayIndex("Wednesday")).toBe(3);
    expect(getUtcWeekdayIndex("thursday")).toBe(4);
    expect(getUtcWeekdayIndex("friday")).toBe(5);
    expect(getUtcWeekdayIndex("Saturday")).toBe(6);
    expect(getUtcWeekdayIndex("invalid-day")).toBeNull();
  });

  it("dynamically computes next UTC run for daily recurring tasks", () => {
    const base = new Date("2026-09-20T08:00:00Z"); // Sunday 8:00 UTC
    // Default 9:00 UTC should be today at 9:00 UTC
    const nextToday = computeNextUtcRun({
      isRecurring: true,
      baseDate: base,
      defaultHourUtc: 9,
      defaultMinuteUtc: 0,
    });
    expect(nextToday?.toISOString()).toBe("2026-09-20T09:00:00.000Z");

    // After 9:00 UTC, next daily run should be tomorrow at 9:00 UTC
    const afterNine = new Date("2026-09-20T10:00:00Z");
    const nextTomorrow = computeNextUtcRun({
      isRecurring: true,
      baseDate: afterNine,
      defaultHourUtc: 9,
      defaultMinuteUtc: 0,
    });
    expect(nextTomorrow?.toISOString()).toBe("2026-09-21T09:00:00.000Z");
  });

  it("dynamically computes next UTC run for cron expressions", () => {
    const base = new Date("2026-09-20T08:00:00Z");
    const nextCron = computeNextUtcRun({
      cronExpression: "0 14 * * 4", // Thursday at 14:00 UTC
      isRecurring: true,
      timezone: "UTC",
      baseDate: base,
    });
    // 2026-09-20 is Sunday, next Thursday is 2026-09-24
    expect(nextCron).not.toBeNull();
    expect(nextCron?.getUTCDay()).toBe(4);
    expect(nextCron?.toISOString()).toBe("2026-09-24T14:00:00.000Z");
  });

  it("dynamically formats schedule descriptions without static fallbacks", () => {
    const descWeekly = formatDynamicScheduleDescription({
      cronExpression: "0 18 * * 4",
      isRecurring: true,
    });
    expect(descWeekly).toBe("Every Thursday at 18:00 UTC (Weekly)");

    const descDaily = formatDynamicScheduleDescription({
      cronExpression: "30 8 * * *",
      isRecurring: true,
    });
    expect(descDaily).toBe("Every day at 08:30 UTC (Daily)");

    const descOnce = formatDynamicScheduleDescription({
      isRecurring: false,
      nextRunAt: new Date("2026-09-24T15:00:00Z"),
    });
    expect(descOnce).toBe("Once on Thursday, 2026-09-24 at 15:00 UTC");
  });
});
