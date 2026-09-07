import { describe, expect, it } from "vitest";
import { MODES, MODE_KEYS } from "../src/config/mode";
import { mainMenuKeyboard } from "../src/telegram/keyboards";

describe("assistant UI foundation", () => {
  it("exposes the planned mode set with general as the default", () => {
    expect(MODE_KEYS[0]).toBe("general");
    expect(Object.keys(MODES)).toEqual([...MODE_KEYS]);
  });

  it("renders the main menu as a discoverable Telegram keyboard", () => {
    const labels = mainMenuKeyboard().inline_keyboard
      .flat()
      .map((button) => button.text);

    expect(labels).toEqual([
      "💬 Chat",
      "🧠 Memory",
      "🎯 Modes",
      "🎙️ Voice",
      "⏰ Reminders",
      "⚙️ Settings",
      "❓ Help",
    ]);
  });
});