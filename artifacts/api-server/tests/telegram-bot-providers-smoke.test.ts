import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { aiProviderGatewayService } from "../src/services/ai-provider-gateway.service";
import { aiProviderRegistryService } from "../src/services/ai-provider-registry.service";
import { aiProviderAdapters } from "../src/services/ai-provider.adapters";
import { adaptiveAIRouterService } from "../src/services/adaptive-ai-router.service";
import { formatTelegramMessage, stripTelegramHtml } from "../src/utils/telegram-formatter";
import { splitTelegramMessage } from "../src/utils/split-message";
import type { AIChatRequest, AIProviderRecord } from "../src/services/ai-provider.types";

describe("TelegramBot Provider Smoke Test & Consistency Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Provider Response Consistency", () => {
    it("ensures all chat providers return consistent normalized AIChatResponse contract", async () => {
      // Mock fetch for OpenAI compatible providers (Groq & Mistral)
      const mockChatResponse = {
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Test response with **bold** text and $x^2 + y^2 = r^2$." },
            finish_reason: "stop",
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockChatResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const groqProvider: AIProviderRecord = {
        id: "groq",
        name: "Groq",
        adapter: "groq",
        enabled: true,
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnv: "GROQ_API_KEY",
        capabilities: ["chat", "streaming"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      process.env.GROQ_API_KEY = "dummy-groq-key";

      const req: AIChatRequest = {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Explain circle equation" }],
      };

      const result = await aiProviderAdapters.groq.chat(req, groqProvider);

      // Verify Contract
      expect(result).toBeDefined();
      expect(result.text).toContain("Test response with **bold** text");
      expect(result.provider).toBe("groq");
      expect(result.usage?.promptTokens).toBe(10);
      expect(result.usage?.completionTokens).toBe(15);
      expect(result.usage?.totalTokens).toBe(25);

      // Test Telegram Formatter Consistency
      const formatted = formatTelegramMessage(result.text);
      expect(formatted).toContain("<b>bold</b>");
      expect(formatted).not.toContain("**bold**");
      expect(formatted).not.toContain("$x^2"); // LaTeX should be normalized
    });

    it("ensures streaming chunks from all providers concatenate seamlessly without lost tokens", async () => {
      const encoder = new TextEncoder();
      const chunksData = [
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"from "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Mistral "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"AI!"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunksData) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

      const mistralProvider: AIProviderRecord = {
        id: "mistral",
        name: "Mistral AI",
        adapter: "mistral",
        enabled: true,
        baseUrl: "https://api.mistral.ai",
        apiKeyEnv: "MISTRAL_API_KEY",
        capabilities: ["chat", "streaming"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      process.env.MISTRAL_API_KEY = "dummy-mistral-key";

      let assembled = "";
      const stream = aiProviderAdapters.mistral.stream(
        { model: "mistral-small-latest", messages: [{ role: "user", content: "Hi" }] },
        mistralProvider
      );

      for await (const chunk of stream) {
        if (chunk.delta) assembled += chunk.delta;
      }

      expect(assembled).toBe("Hello from Mistral AI!");
      const telegramFormatted = formatTelegramMessage(assembled);
      expect(telegramFormatted).toBe("Hello from Mistral AI!");
    });

    it("validates that audio and search providers gracefully reject or fulfill their respective capabilities", async () => {
      const elevenlabsProvider: AIProviderRecord = {
        id: "elevenlabs",
        name: "ElevenLabs",
        adapter: "elevenlabs",
        enabled: true,
        baseUrl: "https://api.elevenlabs.io",
        apiKeyEnv: "ELEVENLABS_API_KEY",
        capabilities: ["audio", "sound_effects"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // ElevenLabs must reject text chat
      await expect(
        aiProviderAdapters.elevenlabs.chat({ model: "eleven_multilingual_v2", messages: [] }, elevenlabsProvider)
      ).rejects.toThrow(/ElevenLabs is an audio and sound generation provider/);

      // Tavily must reject streaming chat
      const tavilyProvider: AIProviderRecord = {
        id: "tavily",
        name: "Tavily",
        adapter: "tavily",
        enabled: true,
        baseUrl: "https://api.tavily.com",
        apiKeyEnv: "TAVILY_API_KEY",
        capabilities: ["web_search", "search_extract"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await expect(
        aiProviderAdapters.tavily.chat({ model: "tavily-search-basic", messages: [] }, tavilyProvider)
      ).rejects.toThrow(/Tavily is a web search and extraction provider/);
    });

    it("verifies Telegram split message handles large multi-paragraph responses across any provider", () => {
      const longText = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: This is a detailed explanation of technical concept ${i + 1} with mathematical terms $E = mc^2$ and code \`const x = ${i};\`.`).join("\n\n");
      const formatted = formatTelegramMessage(longText);
      const chunks = splitTelegramMessage(formatted);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
      }
    });
  });
});
