import { MODES, type ModeKey } from "../config/mode";
import {
  PERSONALITIES,
  PERSONALITY_KEYS,
  type PersonalityKey,
} from "../config/personality";

export const MAIN_MENU_TEXT = [
  "🤖 AI Assistant",
  "",
  "How can I help?",
  "",
  "You can tap an option below, or simply send me a message anytime.",
].join("\n");

export const CHAT_TEXT =
  "💬 Chat is ready. Just send a message whenever you’re ready.";

export const SETTINGS_TEXT = [
  "⚙️ Settings",
  "",
  "Choose what you want to adjust. Only settings that are currently available are shown.",
].join("\n");

export function personalityText(current: PersonalityKey): string {
  return [
    "🎭 Personality",
    "",
    "Choose how you want me to sound:",
    "",
    ...PERSONALITY_KEYS.map(
      (key) =>
        `${key === current ? "✓ " : ""}${PERSONALITIES[key].label} — ${PERSONALITIES[key].description}`,
    ),
    "",
    "Your choice is saved for future conversations.",
  ].join("\n");
}

export function modeText(current: ModeKey): string {
  return [
    "🎯 Assistant mode",
    "",
    "Modes change how I approach a task; personality changes how I communicate.",
    "",
    ...Object.entries(MODES).map(
      ([key, mode]) =>
        `${key === current ? "✓ " : ""}${mode.label} — ${mode.description}`,
    ),
    "",
    "Your choice is saved for future conversations.",
  ].join("\n");
}

export const MEMORY_TEXT = [
  "🧠 Memory",
  "",
  "Conversation history is already saved separately for each Telegram user and chat.",
  "",
  "Long-term personal memories—such as preferences you explicitly ask me to remember—are being prepared for a later phase. I won’t silently turn every message into a permanent memory.",
].join("\n");

export const VOICE_TEXT = [
  "🎙️ Voice",
  "",
  "Voice message support is planned, but it isn’t enabled yet. You can still type naturally and use Telegram’s voice-to-text keyboard if available.",
].join("\n");

export const REMINDERS_TEXT = [
  "⏰ Reminders",
  "",
  "Reminders are planned for a later phase. Once enabled, you’ll be able to describe a reminder naturally and confirm it before it is scheduled.",
].join("\n");

export const HELP_TEXT = [
  "❓ Help",
  "",
  "Chat naturally by sending any text message—no Chat button is required.",
  "",
  "Available shortcuts:",
  "/start — open the main menu",
  "/help — show this help",
  "/clear — remove conversation messages",
  "/reset — start a completely fresh session",
  "/personality — choose how I sound",
  "/status — show bot and conversation status",
  "",
  "Personality controls communication style. Assistant modes change how I approach the task.",
  "Conversation history is persistent and isolated by Telegram user and chat.",
  "Long-term memory, voice, reminders, and external tools are not enabled yet.",
].join("\n");