import { describe, expect, it, vi } from "vitest";
import { GeminiService } from "../src/gemini/gemini.service";
import { formatMemoriesMenuText } from "../src/telegram/navigation";
import { memoriesKeyboard } from "../src/telegram/keyboards";

describe("Memory Pipeline", () => {
  it("layers memory instruction into system prompt", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "Understood!" });
    const service = new GeminiService("secret", "gemini-test", 1000, "Base instruction", {
      models: { generateContent },
    });

    const memoryBlock = "[USER LONG-TERM MEMORY]\n- [preference] preferred_language: TypeScript";
    await service.generateReply([], "What language should I use?", {
      personalityInstruction: "Be enthusiastic.",
      modeInstruction: "Focus on best practices.",
      memoryInstruction: memoryBlock,
    });

    const calledInstruction = generateContent.mock.calls[0]?.[0].config.systemInstruction;
    expect(calledInstruction).toContain("Base instruction");
    expect(calledInstruction).toContain("Personality guidance:\nBe enthusiastic.");
    expect(calledInstruction).toContain("Assistant mode guidance:\nFocus on best practices.");
    expect(calledInstruction).toContain(memoryBlock);
  });

  it("renders empty memory notice when user has no memories", () => {
    const text = formatMemoriesMenuText([]);
    expect(text).toContain("You don't have any saved memories yet");
    expect(text).toContain("/remember");
  });

  it("renders saved memory items with categories and keys", () => {
    const memories = [
      { id: 1, key: "preferred_stack", content: "TypeScript, PostgreSQL", category: "preference" },
      { id: 2, key: "timezone", content: "UTC+1", category: "fact" },
    ];
    const text = formatMemoriesMenuText(memories);
    expect(text).toContain("🧠 Long-Term Memory (2 saved)");
    expect(text).toContain("1. [preference] *preferred_stack*: TypeScript, PostgreSQL");
    expect(text).toContain("2. [fact] *timezone*: UTC+1");
  });

  it("builds interactive inline keyboard with delete buttons for memories", () => {
    const memories = [
      { id: 1, key: "preferred_stack" },
      { id: 2, key: "timezone" },
    ];
    const keyboard = memoriesKeyboard(memories);
    const inlineButtons = keyboard.inline_keyboard.flat();

    const deleteStackBtn = inlineButtons.find((b) => b.callback_data === "memory:delete:preferred_stack");
    const deleteTzBtn = inlineButtons.find((b) => b.callback_data === "memory:delete:timezone");
    const clearAllBtn = inlineButtons.find((b) => b.callback_data === "memory:clear_all");
    const backBtn = inlineButtons.find((b) => b.callback_data === "menu:main");

    expect(deleteStackBtn).toBeDefined();
    expect(deleteTzBtn).toBeDefined();
    expect(clearAllBtn).toBeDefined();
    expect(backBtn).toBeDefined();
  });
});
