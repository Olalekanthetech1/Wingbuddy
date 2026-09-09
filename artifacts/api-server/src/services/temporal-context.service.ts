export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface TemporalContext {
  timezone: string;
  localDateTime: string;
  localDate: string;
  localTime: string;
  dayOfWeek: string;
  timeOfDay: TimeOfDay;
}

function configuredTimeZone(): string {
  const candidate = process.env.TELEGRAM_DEFAULT_TIMEZONE?.trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Fall through to the runtime's configured timezone.
    }
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function hourInTimeZone(date: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(date);
  return Number.parseInt(value, 10) % 24;
}

function resolveTimeOfDay(hour: number): TimeOfDay {
  const morningStart = Number.parseInt(process.env.TEMPORAL_MORNING_START_HOUR ?? "5", 10);
  const afternoonStart = Number.parseInt(process.env.TEMPORAL_AFTERNOON_START_HOUR ?? "12", 10);
  const eveningStart = Number.parseInt(process.env.TEMPORAL_EVENING_START_HOUR ?? "17", 10);
  const nightStart = Number.parseInt(process.env.TEMPORAL_NIGHT_START_HOUR ?? "21", 10);

  if (hour >= morningStart && hour < afternoonStart) return "morning";
  if (hour >= afternoonStart && hour < eveningStart) return "afternoon";
  if (hour >= eveningStart && hour < nightStart) return "evening";
  return "night";
}

export class TemporalContextService {
  static resolve(now = new Date(), timeZone = configuredTimeZone()): TemporalContext {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now).reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

    const hour = Number.parseInt(parts.hour ?? "0", 10) % 24;
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const localTime = `${String(hour).padStart(2, "0")}:${parts.minute ?? "00"}:${parts.second ?? "00"}`;

    return {
      timezone: timeZone,
      localDateTime: `${localDate}T${localTime}`,
      localDate,
      localTime,
      dayOfWeek: parts.weekday ?? "",
      timeOfDay: resolveTimeOfDay(hour),
    };
  }

  static buildPromptInstruction(context: TemporalContext): string {
    return [
      "[TEMPORAL CONTEXT]",
      `Current local date/time: ${context.localDateTime}`,
      `Timezone: ${context.timezone}`,
      `Day: ${context.dayOfWeek}`,
      `Time of day: ${context.timeOfDay}`,
      "Use this temporal context naturally when it improves the response. Do not force a greeting or mention the time when it is irrelevant. When a greeting is appropriate, use natural language consistent with the current local time and the user's identity; do not repeat greetings unnecessarily within an ongoing conversation.",
    ].join("\n");
  }
}
