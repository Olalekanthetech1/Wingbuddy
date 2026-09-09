import { GoogleGenAI } from "@google/genai";
import type {
  AIChatRequest,
  AIChatResponse,
  AIMessage,
  AIProviderAdapter,
  AIProviderRecord,
  AIStreamChunk,
  AIUsage,
} from "./ai-provider.types";
import type { AIProviderId } from "./ai-provider.types";

function requireApiKey(provider: AIProviderRecord, apiKey?: string): string {
  const value = apiKey?.trim() || process.env[provider.apiKeyEnv]?.trim();
  if (!value) throw new Error(`${provider.apiKeyEnv} is not configured`);
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeUsage(usage: any): AIUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? NaN);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? NaN);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokenCount ?? NaN);
  const result: AIUsage = {};
  if (Number.isFinite(inputTokens)) result.inputTokens = inputTokens;
  if (Number.isFinite(outputTokens)) result.outputTokens = outputTokens;
  if (Number.isFinite(totalTokens)) result.totalTokens = totalTokens;
  return Object.keys(result).length ? result : undefined;
}

function asOpenAIMessage(message: AIMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
}

async function requireOk(response: Response, provider: AIProviderId): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  const suffix = body ? `: ${body.slice(0, 800)}` : "";
  throw new Error(`${provider} request failed (${response.status})${suffix}`);
}

async function* parseSSE(
  response: Response,
  mapEvent: (payload: any) => AIStreamChunk | null,
): AsyncGenerator<AIStreamChunk> {
  if (!response.body) throw new Error("Provider returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") continue;
        try {
          const chunk = mapEvent(JSON.parse(data));
          if (chunk) yield chunk;
        } catch {
          // Ignore malformed provider SSE frames; the next valid frame can still complete the response.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

class GeminiAdapter implements AIProviderAdapter {
  readonly providerId = "gemini" as const;

  private toContents(messages: AIMessage[]) {
    return messages
      .filter((message) => message.role !== "tool")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
  }

  private systemInstruction(messages: AIMessage[]): string | undefined {
    return messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") || undefined;
  }

  async chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse> {
    const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) });
    const response: any = await client.models.generateContent({
      model: request.model,
      contents: this.toContents(request.messages),
      config: {
        ...(this.systemInstruction(request.messages) ? { systemInstruction: this.systemInstruction(request.messages) } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      },
    });
    return { provider: this.providerId, model: request.model, text: response.text || "", finishReason: response.candidates?.[0]?.finishReason, usage: normalizeUsage(response.usageMetadata), raw: response };
  }

  async *stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk> {
    const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) });
    const result: any = await client.models.generateContentStream({
      model: request.model,
      contents: this.toContents(request.messages),
      config: {
        ...(this.systemInstruction(request.messages) ? { systemInstruction: this.systemInstruction(request.messages) } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      },
    });
    for await (const chunk of result) {
      const text = typeof chunk?.text === "string" ? chunk.text : "";
      const candidate = chunk?.candidates?.[0];
      yield { provider: this.providerId, model: request.model, delta: text, done: Boolean(candidate?.finishReason), finishReason: candidate?.finishReason, usage: normalizeUsage(chunk?.usageMetadata) };
    }
  }

  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const started = Date.now();
    try { await this.chat({ model, messages: [{ role: "user", content: "ping" }], maxOutputTokens: 4 }, provider, apiKey); return { ok: true, latencyMs: Date.now() - started }; }
    catch (error) { return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }; }
  }
}

abstract class OpenAICompatibleAdapter implements AIProviderAdapter {
  abstract readonly providerId: AIProviderId;
  protected abstract completionPath: string;

  async chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse> {
    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.completionPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireApiKey(provider, apiKey)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: request.model, messages: request.messages.map(asOpenAIMessage), stream: false, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) }),
    });
    await requireOk(response, this.providerId);
    const payload: any = await response.json();
    return { provider: this.providerId, model: request.model, text: payload.choices?.[0]?.message?.content || "", finishReason: payload.choices?.[0]?.finish_reason, usage: normalizeUsage(payload.usage), raw: payload };
  }

  async *stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk> {
    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.completionPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireApiKey(provider, apiKey)}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ model: request.model, messages: request.messages.map(asOpenAIMessage), stream: true, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) }),
    });
    await requireOk(response, this.providerId);
    yield* parseSSE(response, (payload) => {
      const choice = payload.choices?.[0];
      const delta = choice?.delta?.content;
      const finishReason = choice?.finish_reason;
      if (!delta && !finishReason && !payload.usage) return null;
      return { provider: this.providerId, model: request.model, delta: typeof delta === "string" ? delta : "", done: Boolean(finishReason), finishReason, usage: normalizeUsage(payload.usage) };
    });
  }

  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const started = Date.now();
    try { await this.chat({ model, messages: [{ role: "user", content: "ping" }], maxOutputTokens: 4 }, provider, apiKey); return { ok: true, latencyMs: Date.now() - started }; }
    catch (error) { return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }; }
  }
}

class GroqAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "groq" as const;
  protected completionPath = "/chat/completions";
}

class MistralAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "mistral" as const;
  protected completionPath = "/v1/chat/completions";
}

export const aiProviderAdapters: Record<AIProviderId, AIProviderAdapter> = {
  gemini: new GeminiAdapter(),
  groq: new GroqAdapter(),
  mistral: new MistralAdapter(),
};
