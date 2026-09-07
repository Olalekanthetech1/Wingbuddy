import { describe, expect, it, vi } from "vitest";
import {
  GeminiService,
  GeminiServiceError,
  GeminiTimeoutError,
} from "../src/gemini/gemini.service";

describe("GeminiService", () => {
  it("passes model, system instruction, and context to the official client", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "A helpful answer" });
    const service = new GeminiService("secret", "gemini-test", 1000, "Be precise", {
      models: { generateContent },
    });

    await expect(
      service.generateReply([{ role: "user", content: "My name is Sam." }], "What is my name?"),
    ).resolves.toBe("A helpful answer");
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-test",
      contents: [
        { role: "user", parts: [{ text: "My name is Sam." }] },
        { role: "user", parts: [{ text: "What is my name?" }] },
      ],
      config: { systemInstruction: "Be precise" },
    });
  });

  it("layers personality guidance onto the base system instruction", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "Sounds good!" });
    const service = new GeminiService("secret", "gemini-test", 1000, "Be precise", {
      models: { generateContent },
    });

    await service.generateReply([], "Tell me something fun.", "Be playful and chatty.");

    expect(generateContent.mock.calls[0]?.[0].config.systemInstruction).toBe(
      "Be precise\n\nPersonality guidance:\nBe playful and chatty.",
    );
  });

  it("keeps personality and assistant mode guidance separate", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "Let's work through it." });
    const service = new GeminiService("secret", "gemini-test", 1000, "Be precise", {
      models: { generateContent },
    });

    await service.generateReply([], "Teach me this.", {
      personalityInstruction: "Be warm and playful.",
      modeInstruction: "Teach step by step.",
    });

    expect(generateContent.mock.calls[0]?.[0].config.systemInstruction).toBe(
      "Be precise\n\nPersonality guidance:\nBe warm and playful.\n\nAssistant mode guidance:\nTeach step by step.",
    );
  });

  it("fails safely when generation times out", async () => {
    const service = new GeminiService("secret", "gemini-test", 5, "Be precise", {
      models: {
        generateContent: () => new Promise(() => undefined),
      },
    });
    await expect(service.generateReply([], "Hello")).rejects.toBeInstanceOf(GeminiTimeoutError);
  });

  it("surfaces a non-retryable model/API error without retrying it", async () => {
    const apiError = Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: "This model is no longer available.",
          },
        }),
      ),
      { status: 404 },
    );
    const generateContent = vi.fn().mockRejectedValue(apiError);
    const service = new GeminiService("secret", "gemini-3.6-flash", 1000, "Be precise", {
      models: { generateContent },
    });

    await expect(service.generateReply([], "Reply with exactly: OK")).rejects.toBeInstanceOf(
      GeminiServiceError,
    );
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});