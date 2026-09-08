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

export function tasksKeyboard(
  tasks: Array<{ id: number; title: string; status: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const displayTasks = tasks.slice(0, 5);

  for (const t of displayTasks) {
    const statusIcon = t.status === "active" ? "▶️" : t.status === "paused" ? "⏸️" : "⏳";
    const shortTitle = t.title.length > 18 ? t.title.slice(0, 15) + "..." : t.title;
    keyboard
      .text(`${statusIcon} #${t.id}: ${shortTitle}`, `task:view:${t.id}`)
      .text("❌", `task:cancel:${t.id}`)
      .row();
  }

  if (tasks.length === 0) {
    keyboard.text("➕ Start New Task", "menu:chat").row();
  }

  return keyboard.text("◀️ Back", "menu:main");
}

export function taskDisambiguationKeyboard(
  tasks: Array<{ id: number; title: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const t of tasks) {
    const shortTitle = t.title.length > 20 ? t.title.slice(0, 18) + "..." : t.title;
    keyboard.text(`▶️ Resume Task #${t.id}: ${shortTitle}`, `task:continue:${t.id}`).row();
  }
  return keyboard.text("❌ Cancel Choice", "menu:main");
}

export function memoriesKeyboard(
  memories: Array<{ id: number; key: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const displayMemories = memories.slice(0, 6);
  for (const memory of displayMemories) {
    const label = `🗑️ ${memory.key.length > 18 ? memory.key.slice(0, 15) + "..." : memory.key}`;
    keyboard.text(label, `memory:delete:${memory.key}`).row();
  }
  if (memories.length > 0) {
    keyboard.text("🧹 Clear All Memories", "memory:clear_all").row();
  }
  return keyboard.text("◀️ Back", "menu:main");
}

export function remindersKeyboard(
  reminders: Array<{ id: number; prompt: string }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const displayReminders = reminders.slice(0, 5);
  for (const reminder of displayReminders) {
    const label = `❌ Cancel: ${reminder.prompt.length > 18 ? reminder.prompt.slice(0, 15) + "..." : reminder.prompt}`;
    keyboard.text(label, `rem_cancel:${reminder.id}`).row();
  }
  return keyboard.text("◀️ Back", "menu:main");
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