import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { list: mocks.list },
  })),
}));

import { aiProviderAdapters } from "../src/services/ai-provider.adapters";
import type { AIProviderRecord } from "../src/services/ai-provider.types";

const gemini: AIProviderRecord = {
  id: "gemini",
  name: "Google Gemini",
  adapter: "gemini",
  enabled: true,
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKeyEnv: "GEMINI_API_KEY",
  capabilities: ["chat", "streaming", "vision", "reasoning", "long_context", "web_search"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const groq: AIProviderRecord = {
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

const mistral: AIProviderRecord = {
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

afterEach(() => {
  vi.restoreAllMocks();
  mocks.list.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
});

describe("Gemini provider adapter", () => {
  it("awaits the model pager and normalizes supported actions into model capabilities", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mocks.list.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          name: "models/gemini-dynamic-test",
          displayName: "Gemini Dynamic Test",
          supportedActions: ["generateContent"],
          thinking: true,
          inputTokenLimit: 123_456,
        };
      },
    });

    const result = await aiProviderAdapters.gemini.listModels(gemini);

    expect(mocks.list).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "gemini",
      modelId: "gemini-dynamic-test",
      name: "Gemini Dynamic Test",
      contextWindow: 123_456,
    });
    expect(result[0]?.capabilities).toEqual(expect.arrayContaining(["generate", "reasoning"]));
  });
});

describe("OpenAI-compatible provider adapters", () => {
  it("sends a normalized Groq chat request and normalizes the response", async () => {
    process.env.GROQ_API_KEY = "test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await aiProviderAdapters.groq.chat({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 8,
    }, groq);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.text).toBe("hello");
    expect(result.provider).toBe("groq");
    expect(result.usage?.totalTokens).toBe(5);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("parses Mistral SSE streaming chunks", async () => {
    process.env.MISTRAL_API_KEY = "test-key";
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));

    const chunks = [];
    for await (const chunk of aiProviderAdapters.mistral.stream({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
    }, mistral)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.delta).join("")).toBe("Hello");
    expect(chunks.at(-1)?.done).toBe(true);
  });
});
