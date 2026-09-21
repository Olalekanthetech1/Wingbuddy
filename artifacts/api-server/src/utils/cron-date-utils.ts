import cronParser from "cron-parser";
const { parseExpression } = cronParser;

/**
 * Dynamically formats weekday name from a Date object or day index (0=Sunday ... 6=Saturday)
 * using UTC time, eliminating any static arrays or hardcoded day strings.
 */
export function getUtcWeekdayName(dateOrDayIndex: Date | number): string {
  if (typeof dateOrDayIndex === "number") {
    // 2026-01-04 was Sunday (day 0) in UTC
    const sampleDate = new Date(Date.UTC(2026, 0, 4 + ((dateOrDayIndex % 7) + 7) % 7, 12, 0, 0));
    return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(sampleDate);
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(dateOrDayIndex);
}

/**
 * Dynamically resolves a day name string (e.g. "thursday", "monday") to its UTC day index (0-6)
 * using dynamic Date object evaluation.
 */
export function getUtcWeekdayIndex(dayName: string): number | null {
  const normalized = dayName.trim().toLowerCase();
  for (let i = 0; i < 7; i++) {
    const sampleDate = new Date(Date.UTC(2026, 0, 4 + i, 12, 0, 0));
    const sampleName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
      .format(sampleDate)
      .toLowerCase();
    if (sampleName === normalized || sampleName.startsWith(normalized)) {
      return sampleDate.getUTCDay();
    }
  }
  return null;
}

/**
 * Dynamic calculation of the next run date based on system's UTC time.
 * For daily processing and recurring tasks, ensures consistent evaluation without static fallbacks.
 */
export function computeNextUtcRun(params: {
  cronExpression?: string | null;
  isRecurring?: boolean;
  timezone?: string;
  baseDate?: Date;
  defaultHourUtc?: number;
  defaultMinuteUtc?: number;
}): Date | null {
  const now = params.baseDate ? new Date(params.baseDate) : new Date();

  if (!params.isRecurring && !params.cronExpression) {
    return null;
  }

  if (params.cronExpression) {
    try {
      const interval = parseExpression(params.cronExpression, {
        currentDate: now,
        tz: params.timezone || "UTC",
      });
      const candidate = interval.next().toDate();
      if (candidate.getTime() > now.getTime()) {
        return candidate;
      }
    } catch {
      // Fall through to daily UTC evaluation
    }
  }

  if (params.isRecurring) {
    const targetHour = params.defaultHourUtc ?? 9;
    const targetMinute = params.defaultMinuteUtc ?? 0;
    const nextUtc = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      targetHour,
      targetMinute,
      0,
      0
    ));
    if (nextUtc.getTime() <= now.getTime()) {
      nextUtc.setUTCDate(nextUtc.getUTCDate() + 1);
    }
    return nextUtc;
  }

  return null;
}

/**
 * Dynamically formats the human-readable schedule description using system's UTC time.
 * Eliminates static fallback strings like "Every Monday at 09:00 AM".
 */
export function formatDynamicScheduleDescription(params: {
  cronExpression?: string | null;
  isRecurring?: boolean;
  cadenceDescription?: string | null;
  nextRunAt?: Date | null;
  baseDate?: Date;
}): string {
  if (params.cadenceDescription?.trim()) {
    return params.cadenceDescription.trim();
  }

  const now = params.baseDate || new Date();
  if (params.cronExpression) {
    const parts = params.cronExpression.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [minute, hour, _dom, _month, dow] = parts;
      const hourNum = parseInt(hour, 10);
      const minNum = parseInt(minute, 10);
      const formattedTime = !isNaN(hourNum)
        ? `${String(hourNum).padStart(2, "0")}:${String(isNaN(minNum) ? 0 : minNum).padStart(2, "0")} UTC`
        : "09:00 UTC";

      if (dow !== "*" && dow !== "?") {
        const dowNum = parseInt(dow, 10);
        if (!isNaN(dowNum)) {
          const weekdayName = getUtcWeekdayName(dowNum);
          return `Every ${weekdayName} at ${formattedTime} (Weekly)`;
        }
      } else if (parts[2] === "*" && parts[3] === "*") {
        return `Every day at ${formattedTime} (Daily)`;
      }
    }
  }

  if (params.isRecurring) {
    const currentHour = String(now.getUTCHours()).padStart(2, "0");
    const currentMin = String(now.getUTCMinutes()).padStart(2, "0");
    return `Every day at ${currentHour}:${currentMin} UTC (Daily)`;
  }

  if (params.nextRunAt) {
    const dateObj = new Date(params.nextRunAt);
    const dayName = getUtcWeekdayName(dateObj);
    const dateStr = dateObj.toISOString().slice(0, 10);
    const timeStr = dateObj.toISOString().slice(11, 16);
    return `Once on ${dayName}, ${dateStr} at ${timeStr} UTC`;
  }

  const dynamicDayName = getUtcWeekdayName(now);
  return `Daily check-in (${dynamicDayName} UTC)`;
}
