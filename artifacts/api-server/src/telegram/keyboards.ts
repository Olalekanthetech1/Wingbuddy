import { InlineKeyboard } from "grammy";
import { MODES, MODE_KEYS, type ModeKey } from "../config/mode";
import {
  PERSONALITIES,
  PERSONALITY_KEYS,
  type PersonalityKey,
} from "../config/personality";

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💬 Chat", "menu:chat")
    .row()
    .text("🧠 Memory", "menu:memory")
    .text("🎯 Modes", "menu:modes")
    .row()
    .text("🎙️ Voice", "menu:voice")
    .text("⏰ Reminders", "menu:reminders")
    .row()
    .text("⚙️ Settings", "menu:settings")
    .text("❓ Help", "menu:help");
}

export function personalityKeyboard(current: PersonalityKey): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, key] of PERSONALITY_KEYS.entries()) {
    keyboard.text(
      `${key === current ? "✓ " : ""}${PERSONALITIES[key].label}`,
      `personality:${key}`,
    );
    if (index % 2 === 1) keyboard.row();
  }
  return keyboard.text("◀️ Back", "menu:settings");
}

export function modeKeyboard(
  current: ModeKey,
  backCallback = "menu:main",
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, key] of MODE_KEYS.entries()) {
    keyboard.text(
      `${key === current ? "✓ " : ""}${MODES[key].label}`,
      `mode:${key}`,
    );
    if (index % 2 === 1) keyboard.row();
  }
  return keyboard.text("◀️ Back", backCallback);
}

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎭 Personality", "settings:personality")
    .text("🎯 Assistant Mode", "settings:mode")
    .row()
    .text("◀️ Back", "menu:main");
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧹 Clear conversation", "action:clear")
    .row()
    .text("⚙️ Settings", "menu:settings")
    .text("◀️ Back", "menu:main");
}

export function feedbackKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("👍 Helpful", "feedback:helpful")
    .text("👎 Not quite", "feedback:not_quite");
}

export function feedbackReasonKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Too long", "feedback:reason:too_long")
    .text("Incorrect", "feedback:reason:incorrect")
    .row()
    .text("Didn't understand", "feedback:reason:unclear")
    .text("Wrong tone", "feedback:reason:tone")
    .row()
    .text("Other", "feedback:reason:other");
}