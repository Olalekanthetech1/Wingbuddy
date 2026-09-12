import { GoogleGenAI } from "@google/genai";
import { InferenceClient } from "@huggingface/inference";
import type { AIChatRequest, AIChatResponse, AIMessage, AIModelCatalogEntry, AIProviderAdapter, AIProviderRecord, AIStreamChunk, AIUsage, AIImageGenerationRequest, AIImageGenerationResponse, AIVideoGenerationRequest, AIVideoGenerationResponse, AIEmbeddingRequest, AIEmbeddingResponse } from "./ai-provider.types";
import type { AIProviderId } from "./ai-provider.types";
import { logger } from "../lib/logger";

function requireApiKey(provider: AIProviderRecord, apiKey?: string): string { const value = apiKey?.trim() || process.env[provider.apiKeyEnv]?.trim(); if (!value) throw new Error(`${provider.apiKeyEnv} is not configured`); return value; }
function normalizeBaseUrl(value: string): string { return value.replace(/\/+$/, ""); }
function normalizeUsage(usage: any): AIUsage | undefined { if (!usage || typeof usage !== "object") return undefined; const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? NaN); const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? NaN); const totalTokens = Number(usage.total_tokens ?? usage.totalTokenCount ?? NaN); const result: AIUsage = {}; if (Number.isFinite(inputTokens)) result.inputTokens = inputTokens; if (Number.isFinite(outputTokens)) result.outputTokens = outputTokens; if (Number.isFinite(totalTokens)) result.totalTokens = totalTokens; return Object.keys(result).length ? result : undefined; }
function asOpenAIMessage(message: AIMessage): Record<string, unknown> { return { role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}), ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) }; }
async function requireOk(response: Response, provider: AIProviderId): Promise<void> { if (response.ok) return; const body = await response.text().catch(() => ""); const suffix = body ? `: ${body.slice(0, 800)}` : ""; throw new Error(`${provider} request failed (${response.status})${suffix}`); }
async function* parseSSE(response: Response, mapEvent: (payload: any) => AIStreamChunk | null): AsyncGenerator<AIStreamChunk> { if (!response.body) throw new Error("Provider returned an empty stream"); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; try { while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ""; for (const event of events) { const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join(""); if (!data || data === "[DONE]") continue; try { const chunk = mapEvent(JSON.parse(data)); if (chunk) yield chunk; } catch { /* Ignore malformed provider SSE frames. */ } } } } finally { reader.releaseLock(); } }
function inferModelCapabilities(provider: AIProviderId, modelId: string, sourceCaps: string[] = []): string[] {
  const caps = new Set<string>(sourceCaps.map((c) => String(c).toLowerCase().trim()).filter(Boolean));
  
  const id = modelId.toLowerCase();

  // Media generation detection
  if (id.includes("flux") || id.includes("stable-diffusion") || id.includes("sdxl") || id.includes("image") || id.includes("dall-e") || id.includes("midjourney")) {
    caps.add("image_generation");
  } else if (id.includes("wan") || id.includes("video") || id.includes("sora") || id.includes("kling") || id.includes("runway")) {
    caps.add("video_generation");
  } else {
    caps.add("chat");
    caps.add("streaming");
  }

  // Reasoning detection (DeepSeek R1, OpenAI o-series, GPT-OSS, QwQ, etc.)
  if (
    id.includes("r1") ||
    id.includes("reasoning") ||
    id.includes("reasoner") ||
    id.includes("qwq") ||
    id.includes("gpt-oss") ||
    id.includes("o1") ||
    id.includes("o3") ||
    id.includes("thinking")
  ) {
    caps.add("reasoning");
  }

  // Fast / latency optimized detection (8b, 9b, small, mini, flash, instant)
  if (
    id.includes("8b") ||
    id.includes("7b") ||
    id.includes("9b") ||
    id.includes("fast") ||
    id.includes("instant") ||
    id.includes("flash") ||
    id.includes("mini") ||
    id.includes("haiku") ||
    id.includes("small")
  ) {
    caps.add("fast");
  }

  // Structured extraction / function calling / tool use
  if (
    id.includes("gpt") ||
    id.includes("llama-3") ||
    id.includes("mistral") ||
    id.includes("mixtral") ||
    id.includes("qwen") ||
    id.includes("gemini") ||
    id.includes("instruct") ||
    id.includes("command")
  ) {
    caps.add("extraction");
  }

  // Embedding models
  if (id.includes("embed") || id.includes("bge") || id.includes("e5")) {
    caps.add("embedding");
    caps.delete("chat");
    caps.delete("streaming");
  }

  return [...caps];
}

function normalizeCatalogCapabilities(source: any, provider?: AIProviderId, modelId?: string): string[] {
  const explicit: string[] = [];
  if (Array.isArray(source?.capabilities)) {
    explicit.push(...source.capabilities.filter((value: unknown): value is string => typeof value === "string"));
  } else if (source?.capabilities && typeof source.capabilities === "object") {
    explicit.push(...Object.entries(source.capabilities).filter(([, enabled]) => enabled === true).map(([name]) => name));
  }
  if (Array.isArray(source?.supported_actions)) {
    explicit.push(...source.supported_actions.filter((value: unknown): value is string => typeof value === "string"));
  }
  if (provider && modelId) {
    return inferModelCapabilities(provider, modelId, explicit);
  }
  return explicit;
}

function catalogEntry(provider: AIProviderId, modelId: string, name: string | undefined, status: string | undefined, capabilities: string[], contextWindow?: number): AIModelCatalogEntry {
  const dynamicCaps = inferModelCapabilities(provider, modelId, capabilities);
  return {
    provider,
    modelId,
    name: name?.trim() || modelId,
    status: status === "active" ? "active" : status === "inactive" ? "inactive" : "unknown",
    capabilities: dynamicCaps,
    ...(Number.isFinite(contextWindow) && contextWindow! > 0 ? { contextWindow: contextWindow! } : {}),
    source: "provider_api"
  };
}
function safeModel(envName: string, fallback: string): string { return process.env[envName]?.trim() || fallback; }
function detectMime(buffer: Buffer): string { if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4"; if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm"; if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"; if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg"; return "application/octet-stream"; }
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> { return new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); }); }

class GeminiAdapter implements AIProviderAdapter {
  readonly providerId = "gemini" as const;
  private toContents(messages: AIMessage[]) { return messages.filter((message) => message.role !== "tool").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })); }
  private systemInstruction(messages: AIMessage[]): string | undefined { return messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") || undefined; }
  async chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse> { const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) }); const response: any = await client.models.generateContent({ model: request.model, contents: this.toContents(request.messages), config: { ...(this.systemInstruction(request.messages) ? { systemInstruction: this.systemInstruction(request.messages) } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { topP: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}) } }); return { provider: this.providerId, model: request.model, text: response.text || "", finishReason: response.candidates?.[0]?.finishReason, usage: normalizeUsage(response.usageMetadata), raw: response }; }
  async *stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk> { const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) }); const result: any = await client.models.generateContentStream({ model: request.model, contents: this.toContents(request.messages), config: { ...(this.systemInstruction(request.messages) ? { systemInstruction: this.systemInstruction(request.messages) } : {}), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { topP: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}) } }); for await (const chunk of result) { const text = typeof chunk?.text === "string" ? chunk.text : ""; const candidate = chunk?.candidates?.[0]; yield { provider: this.providerId, model: request.model, delta: text, done: Boolean(candidate?.finishReason), finishReason: candidate?.finishReason, usage: normalizeUsage(chunk?.usageMetadata) }; } }
  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const started = Date.now();
    try {
      if (model.toLowerCase().includes("embed")) {
        await this.generateEmbeddings({ model, input: "ping", dimensions: 768 }, provider, apiKey);
        return { ok: true, latencyMs: Date.now() - started };
      }
      await this.chat({ model, messages: [{ role: "user", content: "hi" }], maxOutputTokens: 1, temperature: 0 }, provider, apiKey);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]> { const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) }); const results: AIModelCatalogEntry[] = []; const pager = await client.models.list(); for await (const item of pager) { const raw: any = item; const modelName = typeof raw?.name === "string" ? raw.name.replace(/^models\//, "") : ""; if (!modelName) continue; results.push(catalogEntry(this.providerId, modelName, raw?.displayName || raw?.name, "active", normalizeCatalogCapabilities(raw), Number(raw?.inputTokenLimit || NaN))); } return results; }
  async generateEmbeddings(request: AIEmbeddingRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIEmbeddingResponse> {
    const client = new GoogleGenAI({ apiKey: requireApiKey(provider, apiKey) });
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const embeddings: number[][] = [];
    const rawModel = request.model?.trim() || "text-embedding-004";
    const model = rawModel === "text-embedding-004" || rawModel === "gemini-embedding-2" ? "text-embedding-004" : rawModel;
    for (const text of inputs) {
      const config = request.dimensions ? { outputDimensionality: request.dimensions } : { outputDimensionality: 768 };
      const response: any = await client.models.embedContent({
        model,
        contents: text,
        config
      });
      const vals = response.embedding?.values || response.embeddings?.[0]?.values || [];
      embeddings.push(vals);
    }
    return { provider: this.providerId, model, embeddings };
  }
}

abstract class OpenAICompatibleAdapter implements AIProviderAdapter {
  abstract readonly providerId: AIProviderId; protected abstract completionPath: string; protected modelPath = "/models"; protected embeddingPath = "/embeddings";
  async chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse> { const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.completionPath}`, { method: "POST", headers: { Authorization: `Bearer ${requireApiKey(provider, apiKey)}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: request.model, messages: request.messages.map(asOpenAIMessage), stream: false, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) }) }); await requireOk(response, this.providerId); const payload: any = await response.json(); return { provider: this.providerId, model: request.model, text: payload.choices?.[0]?.message?.content || "", finishReason: payload.choices?.[0]?.finish_reason, usage: normalizeUsage(payload.usage), raw: payload }; }
  async *stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk> { const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.completionPath}`, { method: "POST", headers: { Authorization: `Bearer ${requireApiKey(provider, apiKey)}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ model: request.model, messages: request.messages.map(asOpenAIMessage), stream: true, ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) }) }); await requireOk(response, this.providerId); yield* parseSSE(response, (payload) => { const choice = payload.choices?.[0]; const delta = choice?.delta?.content; const finishReason = choice?.finish_reason; if (!delta && !finishReason && !payload.usage) return null; return { provider: this.providerId, model: request.model, delta: typeof delta === "string" ? delta : "", done: Boolean(finishReason), finishReason, usage: normalizeUsage(payload.usage) }; }); }
  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const started = Date.now();
    try {
      if (model.toLowerCase().includes("embed")) {
        await this.generateEmbeddings({ model, input: "ping" }, provider, apiKey);
        return { ok: true, latencyMs: Date.now() - started };
      }
      await this.chat({ model, messages: [{ role: "user", content: "hi" }], maxOutputTokens: 1, temperature: 0 }, provider, apiKey);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]> { const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.modelPath}`, { headers: { Authorization: `Bearer ${requireApiKey(provider, apiKey)}`, Accept: "application/json" } }); await requireOk(response, this.providerId); const payload: any = await response.json(); const rows = Array.isArray(payload?.data) ? payload.data : []; return rows.map((raw: any) => { const modelId = typeof raw?.id === "string" ? raw.id.trim() : ""; if (!modelId) return null; return catalogEntry(this.providerId, modelId, raw?.name || raw?.id, raw?.active === false || raw?.archived === true ? "inactive" : "active", normalizeCatalogCapabilities(raw), Number(raw?.context_window ?? raw?.max_context_length ?? NaN)); }).filter((item: AIModelCatalogEntry | null): item is AIModelCatalogEntry => Boolean(item)); }
  async generateEmbeddings(request: AIEmbeddingRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIEmbeddingResponse> {
    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}${this.embeddingPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey(provider, apiKey)}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        ...(request.dimensions ? { dimensions: request.dimensions } : {})
      })
    });
    await requireOk(response, this.providerId);
    const payload: any = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const embeddings: number[][] = rows.map((r: any) => r?.embedding || []);
    return {
      provider: this.providerId,
      model: request.model,
      embeddings,
      usage: normalizeUsage(payload.usage)
    };
  }
}

class HuggingFaceAdapter implements AIProviderAdapter {
  readonly providerId = "huggingface" as const;

  private client(apiKey?: string): InferenceClient { return new InferenceClient(requireApiKey({ ...({ id: "huggingface", name: "Hugging Face", adapter: "huggingface", enabled: true, baseUrl: "https://huggingface.co", apiKeyEnv: "HF_TOKEN", capabilities: [], createdAt: "", updatedAt: "" } as AIProviderRecord), apiKeyEnv: "HF_TOKEN" }, apiKey)); }

  async chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse> {
    const token = requireApiKey(provider, apiKey);
    const client = new InferenceClient(token);
    const response: any = await withTimeout(client.chatCompletion({ model: request.model, provider: "auto", messages: request.messages.map(asOpenAIMessage), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) } as any), 60_000, "Hugging Face chat");
    return { provider: this.providerId, model: request.model, text: response.choices?.[0]?.message?.content || "", finishReason: response.choices?.[0]?.finish_reason, usage: normalizeUsage(response.usage), raw: response };
  }

  async *stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk> {
    const token = requireApiKey(provider, apiKey);
    const client = new InferenceClient(token);
    const stream: any = client.chatCompletionStream({ model: request.model, provider: "auto", messages: request.messages.map(asOpenAIMessage), ...(request.temperature !== undefined ? { temperature: request.temperature } : {}), ...(request.topP !== undefined ? { top_p: request.topP } : {}), ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}) } as any);
    for await (const chunk of stream) { const choice = chunk?.choices?.[0]; const delta = typeof choice?.delta?.content === "string" ? choice.delta.content : ""; const finishReason = choice?.finish_reason; if (!delta && !finishReason) continue; yield { provider: this.providerId, model: request.model, delta, done: Boolean(finishReason), finishReason, usage: normalizeUsage(chunk?.usage) }; }
  }

  async generateImage(request: AIImageGenerationRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIImageGenerationResponse> {
    const token = apiKey?.trim() || process.env.HF_TOKEN?.trim();
    const model = request.model?.trim() || safeModel("HF_IMAGE_MODEL", "Qwen/Qwen-Image");
    const width = Number.isFinite(request.width) && request.width! > 0 ? Math.floor(request.width!) : 1024;
    const height = Number.isFinite(request.height) && request.height! > 0 ? Math.floor(request.height!) : 1024;

    if (token) {
      const client = new InferenceClient(token);
      try {
        const controller = new AbortController();
        const image = await withTimeout(client.textToImage({ model, provider: "auto", inputs: request.prompt, parameters: { width, height } } as any, { outputType: "blob", signal: controller.signal } as any), 90_000, "Hugging Face image");
        const buffer = Buffer.from(await image.arrayBuffer());
        if (buffer.length > 2000 && detectMime(buffer).startsWith("image/")) {
          logger.info({ model, width, height, route: "inference_provider" }, "Hugging Face image generation succeeded");
          return { provider: this.providerId, route: "inference_provider", model, buffer, mimeType: detectMime(buffer), fallbackUsed: false };
        }
        throw new Error("Hugging Face returned an invalid image payload");
      } catch (error) {
        logger.warn({ model, error: String(error) }, "Hugging Face authenticated image route failed; switching to community fallback");
      }
    } else {
      logger.info({ model }, "HF_TOKEN unavailable; using community image fallback");
    }

    return this.generateImageViaCommunity(request, model);
  }

  private async generateImageViaCommunity(request: AIImageGenerationRequest, model: string): Promise<AIImageGenerationResponse> {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const width = Number.isFinite(request.width) && request.width! > 0 ? Math.floor(request.width!) : 1024;
    const height = Number.isFinite(request.height) && request.height! > 0 ? Math.floor(request.height!) : 1024;
    const encoded = encodeURIComponent(request.prompt.slice(0, 1000));
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&model=flux&nologo=true&seed=${seed}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "image/jpeg,image/png,image/*", "User-Agent": "Wingbuddy/3.0" } });
      if (!response.ok) throw new Error(`Community image endpoint returned HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = detectMime(buffer);
      if (buffer.length < 2000 || !mimeType.startsWith("image/")) throw new Error("Community image endpoint returned invalid media");
      logger.info({ model, route: "community", width, height }, "Hugging Face provider selected community image fallback");
      return { provider: this.providerId, route: "community", model, buffer, mimeType, sourceUrl: url, fallbackUsed: true };
    } finally { clearTimeout(timeout); }
  }

  async generateVideo(request: AIVideoGenerationRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIVideoGenerationResponse> {
    const token = apiKey?.trim() || process.env.HF_TOKEN?.trim();
    const model = request.model?.trim() || safeModel("HF_VIDEO_MODEL", "Wan-AI/Wan2.2-TI2V-5B");

    if (token) {
      const client = new InferenceClient(token);
      try {
        const video = await withTimeout(client.textToVideo({ model, provider: "auto", inputs: request.prompt } as any, { signal: new AbortController().signal } as any), 180_000, "Hugging Face video");
        const buffer = Buffer.from(await video.arrayBuffer());
        const mimeType = detectMime(buffer);
        if (buffer.length > 2000 && mimeType.startsWith("video/")) {
          logger.info({ model, route: "inference_provider" }, "Hugging Face video generation succeeded");
          return { provider: this.providerId, route: "inference_provider", model, buffer, mimeType, fallbackUsed: false };
        }
        throw new Error("Hugging Face returned an invalid video payload");
      } catch (error) {
        logger.warn({ model, error: String(error) }, "Hugging Face video generation attempt failed; switching to community motion fallback");
      }
    } else {
      logger.info({ model }, "HF_TOKEN unavailable; using community motion fallback");
    }

    return this.generateVideoViaCommunity(request, model);
  }

  private async generateVideoViaCommunity(request: AIVideoGenerationRequest, model: string): Promise<AIVideoGenerationResponse> {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const crypto = await import("node:crypto");
    const { execFile } = await import("node:child_process");

    const imageRequest: AIImageGenerationRequest = {
      prompt: request.prompt,
      width: 1024,
      height: 576,
      metadata: request.metadata,
    };
    const imageResponse = await this.generateImageViaCommunity(imageRequest, model);
    const uniqueId = crypto.randomUUID();
    const tmpInputImage = path.join(os.tmpdir(), `wingbuddy_vframe_${uniqueId}.png`);
    const tmpOutputVideo = path.join(os.tmpdir(), `wingbuddy_vout_${uniqueId}.mp4`);

    try {
      await fs.writeFile(tmpInputImage, imageResponse.buffer);

      const ffmpegArgs = [
        "-y",
        "-loop", "1",
        "-i", tmpInputImage,
        "-vf", "zoompan=z=\x27min(zoom+0.0012,1.18)\x27:d=96:x=\x27iw/2-(iw/zoom/2)\x27:y=\x27ih/2-(ih/zoom/2)\x27:s=1024x576,fps=24",
        "-c:v", "libx264",
        "-t", "4",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        tmpOutputVideo,
      ];

      await new Promise<void>((resolve, reject) => {
        execFile("ffmpeg", ffmpegArgs, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      const videoBuffer = await fs.readFile(tmpOutputVideo);
      const mimeType = detectMime(videoBuffer);
      if (videoBuffer.length > 2000 && mimeType === "video/mp4") {
        logger.info({ model, route: "community", size: videoBuffer.length }, "Synthesized cinematic motion video via community route");
        return {
          provider: this.providerId,
          route: "community",
          model: `${model}+cinematic-motion`,
          buffer: videoBuffer,
          mimeType,
          sourceUrl: imageResponse.sourceUrl,
          fallbackUsed: true,
        };
      }
      throw new Error("Community video synthesis did not yield a valid MP4 stream");
    } finally {
      await fs.unlink(tmpInputImage).catch(() => {});
      await fs.unlink(tmpOutputVideo).catch(() => {});
    }
  }

  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const started = Date.now();
    try {
      const token = requireApiKey(provider, apiKey);
      // Fetch model info to check its pipeline_tag
      const res = await fetch(`https://huggingface.co/api/models/${model}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid Hugging Face token");
        if (res.status === 404) throw new Error("Model not found on Hugging Face");
        throw new Error(`HTTP ${res.status} when looking up model`);
      }
      const info = await res.json();
      
      // If it's not a text generation model, we can't test it with chat completion.
      // We consider it OK if the model exists and is accessible.
      if (info.pipeline_tag && !["text-generation", "text2text-generation"].includes(info.pipeline_tag)) {
        return { ok: true, latencyMs: Date.now() - started };
      }

      await this.chat({ model, messages: [{ role: "user", content: "hi" }], maxOutputTokens: 1, temperature: 0 }, provider, apiKey);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]> {
    const token = apiKey?.trim() || process.env.HF_TOKEN?.trim();
    const models = [
      process.env.HF_TEXT_MODEL?.trim(),
      process.env.HF_IMAGE_MODEL?.trim(),
      process.env.HF_VIDEO_MODEL?.trim(),
    ].filter((value): value is string => Boolean(value));
    const unique = [...new Set(models)];
    if (!token || !unique.length) return unique.map((modelId) => catalogEntry(this.providerId, modelId, modelId, "unknown", []));
    try {
      const response = await fetch("https://huggingface.co/api/models?inference_provider=all&limit=100", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`HF model discovery failed (${response.status})`);
      const payload: any = await response.json();
      const rows = Array.isArray(payload) ? payload : [];
      return rows.filter((row: any) => typeof row?.id === "string").map((row: any) => catalogEntry(this.providerId, row.id, row.id, "active", normalizeCatalogCapabilities(row), Number(row?.config?.max_position_embeddings ?? NaN)));
    } catch (error) {
      logger.warn({ error: String(error) }, "Hugging Face model discovery failed; returning configured models");
      return unique.map((modelId) => catalogEntry(this.providerId, modelId, modelId, "unknown", []));
    }
  }

  async generateEmbeddings(request: AIEmbeddingRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIEmbeddingResponse> {
    const token = apiKey?.trim() || process.env.HF_TOKEN?.trim();
    const client = new InferenceClient(token);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const embeddings: number[][] = [];
    for (const text of inputs) {
      const res: any = await withTimeout(client.featureExtraction({
        model: request.model,
        inputs: text
      }), 60_000, "Hugging Face embedding");
      if (Array.isArray(res)) {
        embeddings.push(res as number[]);
      }
    }
    return {
      provider: this.providerId,
      model: request.model,
      embeddings
    };
  }
}

class GroqAdapter extends OpenAICompatibleAdapter { readonly providerId = "groq" as const; protected completionPath = "/chat/completions"; }
class MistralAdapter extends OpenAICompatibleAdapter { readonly providerId = "mistral" as const; protected completionPath = "/v1/chat/completions"; protected modelPath = "/v1/models"; protected embeddingPath = "/v1/embeddings"; }

class ElevenLabsAdapter implements AIProviderAdapter {
  readonly providerId = "elevenlabs" as const;

  async test(model: string, provider: AIProviderRecord, apiKey?: string) {
    const key = apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim();
    if (!key) return { ok: false, latencyMs: 0, error: "Missing ElevenLabs API key" };
    const started = Date.now();
    try {
      const response = await fetch(`${provider.baseUrl}/v1/user`, {
        headers: { "xi-api-key": key },
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return { ok: false, latencyMs: Date.now() - started, error: `ElevenLabs authentication failed (${response.status}): ${errorText.slice(0, 250)}` };
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]> {
    const key = apiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim();
    if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
    try {
      const response = await fetch(`${provider.baseUrl}/v1/models`, {
        headers: { "xi-api-key": key },
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`ElevenLabs models request failed (${response.status}): ${errorText.slice(0, 200)}`);
      }
      const data: any = await response.json();
      const models = Array.isArray(data) ? data : (Array.isArray(data?.models) ? data.models : []);
      const entries: AIModelCatalogEntry[] = models.map((m: any) => catalogEntry(
        this.providerId,
        m.model_id || m.id,
        m.name || m.model_id || m.id,
        "active",
        ["audio_generation", "sound_generation", "text_to_speech"]
      ));
      if (!entries.some(e => e.modelId === "elevenlabs-sound-effects")) {
        entries.unshift(catalogEntry(
          this.providerId,
          "elevenlabs-sound-effects",
          "ElevenLabs Sound Effects (Foley & Ambient)",
          "active",
          ["audio_generation", "sound_generation"]
        ));
      }
      return entries;
    } catch (error) {
      logger.warn({ error: String(error) }, "ElevenLabs live model discovery failed; returning defaults");
      return [
        catalogEntry(this.providerId, "elevenlabs-sound-effects", "ElevenLabs Sound Effects (Foley & Ambient)", "active", ["audio_generation", "sound_generation"]),
        catalogEntry(this.providerId, "eleven_multilingual_v2", "Eleven Multilingual v2", "active", ["audio_generation", "text_to_speech"]),
        catalogEntry(this.providerId, "eleven_turbo_v2_5", "Eleven Turbo v2.5", "active", ["audio_generation", "text_to_speech"]),
      ];
    }
  }

  async chat(): Promise<any> {
    throw new Error("ElevenLabs is an audio and sound generation provider, not a text chat provider.");
  }

  async *stream(): AsyncGenerator<any> {
    throw new Error("ElevenLabs is an audio and sound generation provider, not a text chat provider.");
  }
}

class TavilyAdapter implements AIProviderAdapter {
  readonly providerId: AIProviderId = "tavily";

  async test(model: string, provider: AIProviderRecord, apiKey?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const key = apiKey?.trim() || process.env.TAVILY_API_KEY?.trim();
    if (!key) return { ok: false, latencyMs: 0, error: "TAVILY_API_KEY is not configured" };
    const start = Date.now();
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ping test", max_results: 1, search_depth: "basic" }),
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 150)}` };
      }
      return { ok: true, latencyMs };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]> {
    return [
      catalogEntry(this.providerId, "tavily-search-basic", "Tavily Web Search (Basic)", "active", ["web_search"]),
      catalogEntry(this.providerId, "tavily-search-advanced", "Tavily Deep Web Research (Advanced)", "active", ["web_search"]),
      catalogEntry(this.providerId, "tavily-extract", "Tavily Web Extract (Direct Parsing)", "active", ["web_extract"]),
    ];
  }

  async chat(): Promise<any> {
    throw new Error("Tavily is a web research and search provider, not a conversational LLM.");
  }

  async *stream(): AsyncGenerator<any> {
    throw new Error("Tavily is a web research and search provider, not a conversational LLM.");
  }
}

export const aiProviderAdapters: Record<AIProviderId, AIProviderAdapter & { listModels: (provider: AIProviderRecord, apiKey?: string) => Promise<AIModelCatalogEntry[]> }> = {
  gemini: new GeminiAdapter(),
  groq: new GroqAdapter(),
  mistral: new MistralAdapter(),
  huggingface: new HuggingFaceAdapter(),
  elevenlabs: new ElevenLabsAdapter(),
  tavily: new TavilyAdapter(),
};