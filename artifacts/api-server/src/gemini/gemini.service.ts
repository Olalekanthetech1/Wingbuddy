import { GoogleGenAI, type Content } from "@google/genai";
import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { apiKeyPoolService, type ApiKeyPoolService, type ManagedKey } from "../services/api-key-pool.service";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { geminiModelPoolService } from "../services/gemini-model-pool.service";

export interface GeminiMessage { role: "user" | "model"; content: string; }
export interface AssistantGuidance { personalityInstruction?: string; modeInstruction?: string; memoryInstruction?: string; }
export interface MultimodalAttachment { mimeType: string; data: string; fileName?: string; }
export interface GenerateReplyOptions { enableSearch?: boolean; thinkingLevel?: string; attachments?: MultimodalAttachment[]; hasAudio?: boolean; hasVisionOrDocument?: boolean; mediaSizeBytes?: number; mode?: string; isDeepReasoning?: boolean; isExtraction?: boolean; }
export interface ExtractedFact { key: string; content: string; category: "preference" | "fact" | "instruction"; }

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) { dot += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i]; }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface GeminiClient {
  models: {
    generateContent: (params: { model: string; contents: Content[]; config?: Record<string, unknown> }) => Promise<GeminiResponse>;
    generateContentStream?: (params: { model: string; contents: Content[]; config?: Record<string, unknown> }) => Promise<AsyncIterable<GeminiResponse>>;
    embedContent?: (params: { model: string; contents: string }) => Promise<{ embedding?: { values?: number[] }; embeddings?: Array<{ values?: number[] }> }>;
  };
}

interface GeminiResponse { text?: string; candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>; webSearchQueries?: string[] } }> };
interface CallContext { prompt?: string; enableSearch?: boolean; targetKeyId?: string; mode?: string; isDeepReasoning?: boolean; isExtraction?: boolean; hasAudio?: boolean; hasVisionOrDocument?: boolean; mediaSizeBytes?: number; }

export class GeminiService {
  private readonly customClient?: GeminiClient;
  private readonly pool: ApiKeyPoolService;
  private readonly clientCache = new Map<string, GeminiClient>();

  constructor(apiKeyOrPool: string | ApiKeyPoolService, private readonly model: string, private readonly timeoutMs: number, private readonly systemInstruction = AI_SYSTEM_INSTRUCTION, client?: GeminiClient) {
    this.customClient = client;
    this.pool = client ? apiKeyPoolService : (typeof apiKeyOrPool === "string" ? apiKeyPoolService : apiKeyOrPool);
  }

  private getClient(keyInfo?: ManagedKey): GeminiClient {
    if (this.customClient) return this.customClient;
    const rawKey = keyInfo?.key || process.env.GEMINI_API_KEY?.trim() || "missing-key";
    let client = this.clientCache.get(rawKey);
    if (!client) { client = new GoogleGenAI({ apiKey: rawKey }) as unknown as GeminiClient; this.clientCache.set(rawKey, client); }
    return client;
  }

  private modelCandidates(context: CallContext): string[] {
    return geminiModelPoolService.getCandidates(this.model, { mode: context.mode, enableSearch: context.enableSearch, isDeepReasoning: context.isDeepReasoning, isExtraction: context.isExtraction });
  }

  private buildContents(history: GeminiMessage[], message: string, attachments?: MultimodalAttachment[]): Content[] {
    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: message }];
    for (const att of attachments || []) userParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
    return [...history.map((item) => ({ role: item.role, parts: [{ text: item.content }] })), { role: "user", parts: userParts as unknown as Content["parts"] }];
  }

  private buildConfig(guidance?: AssistantGuidance | string, options?: GenerateReplyOptions): Record<string, unknown> {
    const config: Record<string, unknown> = { systemInstruction: buildSystemInstruction(this.systemInstruction, guidance) };
    if (options?.enableSearch) config.tools = [{ googleSearch: {} }];
    if (options?.thinkingLevel) config.thinkingConfig = { thinkingLevel: options.thinkingLevel };
    return config;
  }

  private timeout(context: CallContext): number {
    return this.timeoutMs > 0 ? this.timeoutMs : AdaptiveEngineService.computeAdaptiveTimeout({ prompt: context.prompt, enableSearch: context.enableSearch, isDeepReasoning: context.isDeepReasoning, hasAudio: context.hasAudio, hasVisionOrDocument: context.hasVisionOrDocument, mediaSizeBytes: context.mediaSizeBytes, targetKeyId: context.targetKeyId });
  }

  async generateReply(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions): Promise<string> {
    const contents = this.buildContents(history, message, options?.attachments);
    const config = this.buildConfig(guidance, options);
    const context: CallContext = { prompt: message, enableSearch: Boolean(options?.enableSearch), mode: options?.mode, isDeepReasoning: options?.isDeepReasoning, isExtraction: options?.isExtraction, hasAudio: options?.hasAudio, hasVisionOrDocument: options?.hasVisionOrDocument, mediaSizeBytes: options?.mediaSizeBytes };
    const keys = this.customClient ? [undefined] : await this.pool.getOrderedKeysForExecution();
    let lastError: unknown;
    for (const keyInfo of keys) {
      const client = this.getClient(keyInfo);
      const started = Date.now();
      for (const model of this.modelCandidates(context)) {
        try {
          const response = await this.callWithTimeout(client, model, contents, config, this.timeout(context));
          const text = this.withGroundingSources(response.text?.trim(), response);
          if (!text) throw new GeminiMalformedResponseError();
          if (keyInfo) this.pool.recordSuccess(keyInfo.id, Date.now() - started);
          logger.debug({ model, keyId: keyInfo?.id, enableSearch: context.enableSearch }, "Gemini model attempt succeeded");
          return text;
        } catch (error) {
          lastError = error;
          logger.warn({ model, keyId: keyInfo?.id, error: safeErrorMetadata(error) }, "Gemini model candidate failed; evaluating next configured candidate");
          if (!isModelFailoverError(error)) break;
        }
      }
      if (keyInfo && lastError) this.pool.recordError(keyInfo.id, lastError);
    }
    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("No configured Gemini model candidate could complete the request.", lastError);
  }

  async generateReplyStream(history: GeminiMessage[], message: string, guidance?: AssistantGuidance | string, options?: GenerateReplyOptions, onChunk?: (accumulatedText: string) => Promise<void> | void): Promise<string> {
    const contents = this.buildContents(history, message, options?.attachments);
    const config = this.buildConfig(guidance, options);
    const context: CallContext = { prompt: message, enableSearch: Boolean(options?.enableSearch), mode: options?.mode, isDeepReasoning: options?.isDeepReasoning, hasAudio: options?.hasAudio, hasVisionOrDocument: options?.hasVisionOrDocument, mediaSizeBytes: options?.mediaSizeBytes };
    const keys = this.customClient ? [undefined] : await this.pool.getOrderedKeysForExecution();
    let lastError: unknown;
    for (const keyInfo of keys) {
      const client = this.getClient(keyInfo);
      for (const model of this.modelCandidates(context)) {
        try {
          const result = await this.streamWithTimeout(client, model, contents, config, this.timeout(context), onChunk);
          if (result.text) return result.text;
        } catch (error) {
          lastError = error;
          logger.warn({ model, keyId: keyInfo?.id, error: safeErrorMetadata(error) }, "Gemini streaming candidate failed; evaluating next configured candidate");
          if (!isModelFailoverError(error)) break;
        }
      }
      if (keyInfo && lastError) this.pool.recordError(keyInfo.id, lastError);
    }
    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("No configured Gemini model candidate could complete the streamed request.", lastError);
  }

  private async callWithTimeout(client: GeminiClient, model: string, contents: Content[], config: Record<string, unknown>, timeoutMs: number): Promise<GeminiResponse> {
    return Promise.race([client.models.generateContent({ model, contents, config }), new Promise<never>((_, reject) => setTimeout(() => reject(new GeminiTimeoutError()), timeoutMs))]);
  }

  private async streamWithTimeout(client: GeminiClient, model: string, contents: Content[], config: Record<string, unknown>, timeoutMs: number, onChunk?: (accumulatedText: string) => Promise<void> | void): Promise<{ text: string }> {
    if (typeof client.models.generateContentStream !== "function") {
      const response = await this.callWithTimeout(client, model, contents, config, timeoutMs);
      const text = this.withGroundingSources(response.text?.trim(), response) || "";
      if (text && onChunk) await onChunk(text);
      if (!text) throw new GeminiMalformedResponseError();
      return { text };
    }
    const stream = await Promise.race([client.models.generateContentStream({ model, contents, config }), new Promise<never>((_, reject) => setTimeout(() => reject(new GeminiTimeoutError()), timeoutMs))]);
    let accumulated = "";
    const sources: Array<{ uri: string; title?: string }> = [];
    try {
      for await (const chunk of stream) {
        if (chunk.text) { accumulated += chunk.text; if (onChunk) await onChunk(accumulated); }
        for (const c of chunk.candidates?.[0]?.groundingMetadata?.groundingChunks || []) if (c.web?.uri && !sources.some((s) => s.uri === c.web?.uri)) sources.push({ uri: c.web.uri, title: c.web.title });
      }
    } catch (error) {
      if (accumulated) throw error;
      throw error;
    }
    let finalText = accumulated.trim();
    if (!finalText) throw new GeminiMalformedResponseError();
    if (sources.length) finalText = `${finalText}\n\n🔍 Sources:\n${sources.slice(0, 8).map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.uri}`).join("\n")}`;
    return { text: finalText };
  }

  private withGroundingSources(text: string | undefined, response: GeminiResponse): string {
    if (!text) return "";
    const sources = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w): w is { uri: string; title?: string } => Boolean(w?.uri)).slice(0, 8);
    if (!sources.length) return text;
    return `${text}\n\n🔍 Sources:\n${sources.map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.uri}`).join("\n")}`;
  }

  async embedText(text: string): Promise<number[]> {
    const model = process.env.GEMINI_EMBEDDING_MODEL?.trim();
    if (!model) return [];
    try {
      const client = this.getClient();
      const embedFn = client.models.embedContent;
      if (typeof embedFn !== "function") return [];
      const response = await embedFn({ model, contents: text });
      return Array.isArray(response.embedding?.values) ? response.embedding.values : Array.isArray(response.embeddings?.[0]?.values) ? response.embeddings[0].values || [] : [];
    } catch (error) {
      logger.debug({ stage: "embed_text", error: safeErrorMetadata(error) }, "Vector embedding skipped");
      return [];
    }
  }

  async extractUserFacts(message: string): Promise<ExtractedFact[]> {
    if (message.trim().length < 4) return [];
    const extractionPrompt = `Analyze this user message and extract durable user facts, preferences, or personal instructions. Return ONLY valid JSON array with schema [{"key":string,"content":string,"category":"preference"|"fact"|"instruction"}]. If none exist return [].\n\nUser message: ${message}`;
    try {
      const text = await this.generateReply([], extractionPrompt, "Return valid JSON only.", { isExtraction: true });
      const cleaned = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === "string" && typeof item.content === "string" && ["preference", "fact", "instruction"].includes(item.category)) : [];
    } catch { return []; }
  }

  async summarizeSession(messages: GeminiMessage[]): Promise<string> {
    if (messages.length < 2) return "";
    try { return await this.generateReply([], `Summarize this conversation into 2-3 concise factual bullet points focused on user context, problems, and decisions.\n\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}`); }
    catch { return ""; }
  }
}

function buildSystemInstruction(baseInstruction: string, guidance?: AssistantGuidance | string): string {
  if (!guidance) return baseInstruction;
  const personality = typeof guidance === "string" ? guidance : guidance.personalityInstruction;
  const mode = typeof guidance === "string" ? undefined : guidance.modeInstruction;
  const memory = typeof guidance === "string" ? undefined : guidance.memoryInstruction;
  return [baseInstruction, personality ? `Personality guidance:\n${personality}` : "", mode ? `Assistant mode guidance:\n${mode}` : "", memory || ""].filter(Boolean).join("\n\n");
}

function isModelFailoverError(error: unknown): boolean {
  if (error instanceof GeminiMalformedResponseError) return false;
  if (error instanceof GeminiTimeoutError) return true;
  if (error instanceof GeminiError) return false;
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : undefined;
  const status = typeof record?.status === "number" ? record.status : undefined;
  if (status === 404 || status === 429 || status === 500 || status === 502 || status === 503) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("quota") || message.includes("resource_exhausted") || message.includes("rate limit") || message.includes("temporarily unavailable") || message.includes("service unavailable") || message.includes("model not found");
}

export class GeminiError extends Error { constructor(message: string, public readonly cause?: unknown) { super(message); this.name = new.target.name; } }
export class GeminiTimeoutError extends GeminiError { constructor() { super("Gemini request timed out."); } }
export class GeminiMalformedResponseError extends GeminiError { constructor() { super("Gemini returned an empty response."); } }
export class GeminiServiceError extends GeminiError {}

let defaultGeminiServiceInstance: GeminiService | null = null;
export function getDefaultGeminiService(): GeminiService {
  if (!defaultGeminiServiceInstance) {
    const configured = process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_DEFAULT_MODEL?.trim();
    if (!configured) throw new Error("GEMINI_MODEL or GEMINI_DEFAULT_MODEL must be configured.");
    const timeout = Number(process.env.GEMINI_TIMEOUT_MS) || 0;
    defaultGeminiServiceInstance = new GeminiService(apiKeyPoolService, configured, timeout);
  }
  return defaultGeminiServiceInstance;
}
