import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderAdapters } from "../src/services/ai-provider.adapters";
import type { AIProviderRecord } from "../src/services/ai-provider.types";

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
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
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
