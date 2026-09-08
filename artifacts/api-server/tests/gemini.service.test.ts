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

  it("applies googleSearch tool and appends web citations when search is enabled", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Google I/O 2026 introduced new Gemini 3 models.",
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://blog.google/io", title: "Google I/O Keynote" } },
            ],
          },
        },
      ],
    });
    const service = new GeminiService("secret", "gemini-3.8-flash", 1000, "Be precise", {
      models: { generateContent },
    });

    const reply = await service.generateReply([], "What happened at Google I/O today?", undefined, {
      enableSearch: true,
    });

    expect(reply).toContain("Google I/O 2026 introduced new Gemini 3 models.");
    expect(reply).toContain("🔍 Sources:");
    expect(reply).toContain("Google I/O Keynote: https://blog.google/io");
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          tools: [{ googleSearch: {} }],
        }),
      }),
    );
  });

  it("configures thinkingConfig when thinkingLevel is passed", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "Self-corrected mathematical proof." });
    const service = new GeminiService("secret", "gemini-3.8-flash", 1000, "Be precise", {
      models: { generateContent },
    });

    const reply = await service.generateReply([], "Prove that sqrt(2) is irrational", undefined, {
      thinkingLevel: "LOW",
    });

    expect(reply).toBe("Self-corrected mathematical proof.");
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: { thinkingLevel: "LOW" },
        }),
      }),
    );
  });

  it("embeds text using gemini-embedding-2-preview", async () => {
    const embedContent = vi.fn().mockResolvedValue({
      embedding: { values: [0.1, 0.2, 0.3] },
    });
    const service = new GeminiService("secret", "gemini-3.8-flash", 1000, "Be precise", {
      models: {
        generateContent: vi.fn(),
        embedContent,
      },
    });

    const embedding = await service.embedText("Recall database architecture");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(embedContent).toHaveBeenCalledWith({
      model: "gemini-embedding-2-preview",
      contents: "Recall database architecture",
    });
  });
});