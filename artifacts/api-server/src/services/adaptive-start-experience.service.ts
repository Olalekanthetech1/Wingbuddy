import { MODES, type ModeKey } from "../config/mode";
import { PERSONALITIES, type PersonalityKey } from "../config/personality";
import { TemporalContextService } from "./temporal-context.service";

export interface AdaptiveStartExperienceInput {
  displayName: string;
  isReturningUser: boolean;
  mode: ModeKey;
  personality: PersonalityKey;
  activeTaskCount: number;
  activeReminderCount: number;
  activeSessionCount: number;
  capabilities?: readonly string[];
  timeZone?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function labelize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export class AdaptiveStartExperienceService {
  build(input: AdaptiveStartExperienceInput): string {
    const personality = PERSONALITIES[input.personality];
    const mode = MODES[input.mode];
    const temporal = TemporalContextService.resolve(new Date(), input.timeZone);
    const greetingContext = input.isReturningUser ? "Welcome back" : "Welcome";

    const configuredCapabilities = Array.from(new Set([
      ...(mode?.capabilitiesList ?? []),
      ...(mode?.preferredTools ?? []),
    ]));
    const capabilities = configuredCapabilities.length > 0
      ? configuredCapabilities.map((capability) => `• ${escapeHtml(labelize(capability))}`).join("\n")
      : (input.capabilities?.length
        ? input.capabilities.map((capability) => `• ${escapeHtml(capability)}`).join("\n")
        : "• Context-aware assistance");

    const stateLines: string[] = [];
    if (input.activeTaskCount > 0) {
      stateLines.push(`🎯 You have <b>${input.activeTaskCount}</b> active task${input.activeTaskCount === 1 ? "" : "s"}.`);
    }
    if (input.activeReminderCount > 0) {
      stateLines.push(`⏰ You have <b>${input.activeReminderCount}</b> pending reminder${input.activeReminderCount === 1 ? "" : "s"}.`);
    }
    if (input.activeSessionCount > 1) {
      stateLines.push(`💬 You have <b>${input.activeSessionCount}</b> active conversation sessions.`);
    }

    const temporalGreeting = temporal.timeOfDay === "morning"
      ? "Good morning"
      : temporal.timeOfDay === "afternoon"
        ? "Good afternoon"
        : temporal.timeOfDay === "evening"
          ? "Good evening"
          : "Hello";

    const opening = input.isReturningUser
      ? `${greetingContext} — ${temporalGreeting.toLowerCase()}!`
      : `${temporalGreeting}!`;

    return [
      `Hey ${escapeHtml(input.displayName)}! 👋`,
      `${opening} I’m your adaptive AI partner.`,
      `\n⚡ <b>Current setup</b>\n• Mode: <b>${escapeHtml(mode.label)}</b>\n• Personality: <b>${escapeHtml(personality.label)}</b>`,
      `\n🧩 <b>Available capabilities</b>\n${capabilities}`,
      stateLines.length
        ? `\n${stateLines.join("\n")}`
        : "\n✨ Nothing is waiting on you right now. Start with whatever you have in mind.",
      "\nSend me a message normally — I’ll determine the appropriate path from your request and current runtime capabilities.",
    ].join("\n");
  }
}

export const adaptiveStartExperienceService = new AdaptiveStartExperienceService();
