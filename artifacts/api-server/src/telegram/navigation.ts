import { MODES, type ModeKey } from "../config/mode";
import {
  PERSONALITIES,
  PERSONALITY_KEYS,
  type PersonalityKey,
} from "../config/personality";
import type { AIPersona } from "../services/persona.service";
import type { UserTier } from "../services/user-tier.service";

export function formatPersonasMenuText(
  personas: AIPersona[],
  current: AIPersona,
  userTier: UserTier = "free",
): string {
  const lines = [
    `🎭 <b>AI Personas & Specialized Agents</b>`,
    "",
    `Current Active Persona: <b>${current.emoji} ${current.name}</b>`,
    `<i>${current.tagline}</i>`,
    "",
    "<b>Available Personas:</b>",
  ];

  for (const p of personas) {
    const isCurrent = p.id === current.id;
    const tierBadge = p.requiredTier === "vip" ? " [👑 VIP]" : p.requiredTier === "pro" ? " [⚡ PRO]" : "";
    lines.push(
      `${isCurrent ? "👉 " : "• "}<b>${p.emoji} ${p.name}</b>${tierBadge}\n   <i>${p.tagline}</i>`
    );
  }

  lines.push("");
  lines.push("Tap any button below to immediately change the bot's behavior, tone, and underlying model routing.");
  lines.push("Shortcut: Use <code>/persona &lt;name&gt;</code> (e.g. <code>/persona architect</code>).");

  return lines.join("\n");
}

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

export interface MemoryViewItem {
  id: number;
  key: string;
  content: string;
  category: string;
}

export function formatMemoriesMenuText(memories: MemoryViewItem[]): string {
  if (memories.length === 0) {
    return [
      "🧠 Long-Term Memory (Profile)",
      "",
      "You don't have any saved memories yet.",
      "",
      "How to teach me:",
      "• Send /remember <fact> (e.g. /remember stack: TypeScript, PostgreSQL)",
      "• Or naturally tell me about your preferences in chat (e.g. \"Remember that I prefer concise answers\")",
      "",
      "Stored memories are permanently remembered across all your sessions.",
    ].join("\n");
  }

  const items = memories.map(
    (m, i) => `${i + 1}. [${m.category}] *${m.key}*: ${m.content}`,
  );

  return [
    `🧠 Long-Term Memory (${memories.length} saved)`,
    "",
    "These are the facts and preferences I've saved for you:",
    "",
    ...items,
    "",
    "To delete a memory, tap its delete button below or use /forget <key>.",
    "To add new ones: /remember <key>: <content>",
  ].join("\n");
}

export const MEMORY_TEXT = [
  "🧠 Memory",
  "",
  "Conversation history is saved separately for each Telegram user and chat.",
  "",
  "Your personal preferences and learned facts are preserved across all your sessions.",
].join("\n");

export const VOICE_TEXT = [
  "🎙️ Voice Notes & Audio Understanding",
  "",
  "Native voice memo processing is fully active!",
  "",
  "• Simply hold the microphone button in Telegram and send any voice note.",
  "• Gemini will listen, accurately transcribe accents & nuance, and reply with full context.",
  "• You can also send voice notes alongside captions or instructions.",
].join("\n");

export interface ReminderViewItem {
  id: number;
  prompt: string;
  dueAt: Date;
  snoozeCount: number;
}

export function formatRemindersMenuText(reminders: ReminderViewItem[]): string {
  if (reminders.length === 0) {
    return [
      "⏰ Proactive Reminders",
      "",
      "You don't have any pending reminders scheduled.",
      "",
      "How to set a reminder:",
      "• Send: /remind in 15 mins to check oven",
      "• Send: /remind tomorrow at 9am review pull request",
      "• Or just type naturally in chat: \"Remind me tonight at 8pm to call mom\"",
      "",
      "When the time arrives, I will proactively send you a notification with Done & Snooze buttons!",
    ].join("\n");
  }

  const items = reminders.map((r, i) => {
    const timeStr = r.dueAt.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const snoozeStr = r.snoozeCount > 0 ? ` (snoozed ${r.snoozeCount}x)` : "";
    return `${i + 1}. 📌 *${r.prompt}*\n   🕒 Due: ${timeStr}${snoozeStr}`;
  });

  return [
    `⏰ Active Scheduled Reminders (${reminders.length})`,
    "",
    ...items,
    "",
    "To cancel a reminder, tap its cancel button below or use /reminders.",
  ].join("\n");
}

export const REMINDERS_TEXT = [
  "⏰ Proactive Reminders",
  "",
  "Natural language scheduling is active! Tell me when and what to remind you about.",
  "",
  "Examples:",
  "• \"Remind me in 30 minutes to stretch\"",
  "• \"Remind me tomorrow at 8am to take vitamins\"",
  "• \"/remind in 2 hours check deployment pipeline\"",
].join("\n");


export const HELP_TEXT = [
  "❓ Help",
  "",
  "Chat naturally by sending any text message—no Chat button or command is required.",
  "",
  "Smart features enabled:",
  "• 🎨 High-Res Image Generation: Hugging Face FLUX.1 & Free Community art generation with Gemini Flash enhancement",
  "• 🎬 Hybrid Video Generation: Hugging Face & Free Community video generation with cinematic camera enhancement",
  "• 🌐 Real-Time Web Grounding: Automatic Google Search for up-to-date facts, news, and citations",
  "• 🧠 Multi-Step Reasoning: Deep thinking mode with self-correction for logic, code, & math",
  "• 🧬 Semantic Vector Memory: Dense embedding & hybrid RAG recall across your entire chat history",
  "",
  "⚡ Dynamic Adaptation:",
  "You do NOT need to switch modes manually! The assistant automatically detects whether you need video generation, image generation, live web search, deep multi-step thinking, code generation, or casual chat on every message.",
  "",
  "Available shortcuts:",
  "/start — open the main menu",
  "/persona — switch specialized AI Persona & agent brain",
  "/tier — view your account tier and daily quota",
  "/image <prompt> — generate free high-res art with Gemini enhancement",
  "/video <prompt> — generate animated/cinematic video clip",
  "/search <query> — explicitly force live web search",
  "/think <problem> — explicitly trigger deep reasoning",
  "/memories — view your long-term memories",
  "/remember <fact> — save a preference or fact",
  "/forget <key> — delete a remembered fact",
  "/clear — remove conversation messages",
  "/reset — start a completely fresh session",
  "/personality — choose how I sound",
  "/mode — optional mode override (Deep Reasoning, Web Researcher, etc.)",
  "/status — show bot and conversation status",
  "",
  "Personality controls communication style. Assistant modes adapt dynamically to your intent.",
  "Conversation history and long-term memories are persistent in PostgreSQL and isolated by user.",
].join("\n");