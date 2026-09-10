import { MODES, type ModeKey } from "../config/mode";

export interface AdaptiveStartExperienceInput {
  displayName: string;
  isReturningUser: boolean;
  mode: ModeKey;
  activeTaskCount: number;
  activeReminderCount: number;
  nextReminderDueAt?: Date | null;
  recentSessionAvailable: boolean;
  timezone: string;
  now?: Date;
}

type DayPart = "morning" | "afternoon" | "evening" | "lateNight";

const MODE_PRESENTATION: Record<ModeKey, { focus: string }> = {
  general: { focus: "Chat, think, plan, or explore" },
  study: { focus: "Learn, revise, solve, or practice" },
  coder: { focus: "Build, debug, review, or ship" },
  deep_research: { focus: "Research, compare, verify, or analyze" },
  math: { focus: "Break down a difficult problem" },
  creative: { focus: "Write, brainstorm, create, or polish" },
  auto: { focus: "Adapt to whatever you need next" },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getDayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "lateNight";
}

function getGreeting(dayPart: DayPart, isReturningUser: boolean, displayName: string): string {
  const name = escapeHtml(displayName);
  if (dayPart === "morning") return `Good morning, ${name}! ☀️`;
  if (dayPart === "afternoon") return `${isReturningUser ? "Welcome back" : "Good afternoon"}, ${name}! 🌤️`;
  if (dayPart === "evening") return `${isReturningUser ? "Welcome back" : "Good evening"}, ${name}! 🌆`;
  return `${isReturningUser ? "Still up" : "Hey"}, ${name}? 🌙`;
}

function formatLocalTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}

function getLocalHour(date: Date, timezone: string): number {
  try {
    const hourParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(hourParts.find((part) => part.type === "hour")?.value ?? 12);
    return Number.isFinite(hour) ? hour : 12;
  } catch {
    return date.getHours();
  }
}

export class AdaptiveStartExperienceService {
  build(input: AdaptiveStartExperienceInput): string {
    const now = input.now ?? new Date();
    const dayPart = getDayPart(getLocalHour(now, input.timezone));
    const presentation = MODE_PRESENTATION[input.mode] ?? MODE_PRESENTATION.general;
    const modeLabel = MODES[input.mode]?.label ?? MODES.general.label;
    const stateLines: string[] = [];

    if (input.activeTaskCount > 0) {
      stateLines.push(`✅ <b>${input.activeTaskCount}</b> active task${input.activeTaskCount === 1 ? "" : "s"} ready to continue.`);
    }

    if (input.activeReminderCount > 0) {
      const due = input.nextReminderDueAt ? formatLocalTime(input.nextReminderDueAt, input.timezone) : null;
      stateLines.push(due
        ? `⏰ Next reminder: <b>${escapeHtml(due)}</b>`
        : `⏰ <b>${input.activeReminderCount}</b> reminder${input.activeReminderCount === 1 ? "" : "s"} scheduled.`);
    }

    if (input.recentSessionAvailable && stateLines.length < 2) {
      stateLines.push("↩️ Your recent session is ready to pick up where you left off.");
    }

    const contextBlock = stateLines.length
      ? stateLines.join("\n")
      : "✨ Nothing urgent is waiting. Bring me whatever you have in mind.";

    const footer = dayPart === "lateNight"
      ? "Keep it focused — I’m here. 🌙"
      : input.isReturningUser
        ? "What should we tackle next? 🚀"
        : "Let’s get started. 🚀";

    return [
      `🪽 <b>${getGreeting(dayPart, input.isReturningUser, input.displayName)}</b>`,
      "",
      `🎯 <b>${escapeHtml(modeLabel)}</b> — ${escapeHtml(presentation.focus)}`,
      contextBlock,
      "",
      footer,
      "Send me a message naturally — you don’t need to pick a mode or tool first.",
    ].join("\n");
  }
}

export const adaptiveStartExperienceService = new AdaptiveStartExperienceService();
