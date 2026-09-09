import type { PersonalityKey } from "../config/personality";
import { PERSONALITIES } from "../config/personality";
import type { ModeKey } from "../config/mode";
import { MODES } from "../config/mode";

export interface AdaptiveStartExperienceInput {
  displayName: string;
  isReturningUser: boolean;
  mode: ModeKey;
  personality: PersonalityKey;
  activeTaskCount: number;
  activeReminderCount: number;
  activeSessionCount: number;
  capabilities: readonly string[];
}

export class AdaptiveStartExperienceService {
  build(input: AdaptiveStartExperienceInput): string {
    const personality = PERSONALITIES[input.personality];
    const mode = MODES[input.mode];
    const greeting = input.isReturningUser ? "Welcome back" : "Welcome";
    const stateLines: string[] = [];
    if (input.activeTaskCount > 0) stateLines.push(`🎯 You have <b>${input.activeTaskCount}</b> active task${input.activeTaskCount === 1 ? "" : "s"} ready to continue.`);
    if (input.activeReminderCount > 0) stateLines.push(`⏰ You have <b>${input.activeReminderCount}</b> pending reminder${input.activeReminderCount === 1 ? "" : "s"}.`);
    if (input.activeSessionCount > 1) stateLines.push(`💬 You have <b>${input.activeSessionCount}</b> active conversation sessions.`);
    const capabilities = input.capabilities.length ? input.capabilities.map((capability) => `• ${escapeHtml(capability)}`).join("\n") : "• Conversation and context-aware assistance";
    return [
      `Hey ${escapeHtml(input.displayName)}! 👋`,
      `${greeting} — I’m your adaptive AI partner.`,
      `\n⚡ <b>Current setup</b>\n• Mode: <b>${escapeHtml(mode.label)}</b>\n• Personality: <b>${escapeHtml(personality.label)}</b>`,
      `\n🧩 <b>Available capabilities</b>\n${capabilities}`,
      stateLines.length ? `\n${stateLines.join("\n")}` : "\n✨ Nothing is waiting on you right now. Start with whatever you have in mind.",
      "\nSend me a message normally — you don’t need to choose a mode or tool first. I’ll route the request through the available execution path.",
    ].join("\n");
  }
}
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export const adaptiveStartExperienceService = new AdaptiveStartExperienceService();
