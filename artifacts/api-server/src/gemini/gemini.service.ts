import { GoogleGenAI, type Content } from "@google/genai";
import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { apiKeyPoolService, type ApiKeyPoolService, type ManagedKey } from "../services/api-key-pool.service";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";

export interface GeminiMessage {
  role: "user" | "model";
  content: string;
}

export interface AssistantGuidance {
  personalityInstruction?: string;
  modeInstruction?: string;
  memoryInstruction?: string;
}

export interface MultimodalAttachment {
  mimeType: string;
  data: string; // Base64 representation
  fileName?: string;
}

export interface GenerateReplyOptions {
  enableSearch?: boolean;
  thinkingLevel?: string;
  attachments?: MultimodalAttachment[];
  hasAudio?: boolean;
  hasVisionOrDocument?: boolean;
  mediaSizeBytes?: number;
}

export interface ExtractedFact {
  key: string;
  content: string;
  category: "preference" | "fact" | "instruction";
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface GeminiClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: Content[];
      config?: {
        systemInstruction?: string;
        tools?: Array<{ googleSearch?: Record<string, unknown> }>;
        thinkingConfig?: { thinkingLevel?: string };
        [key: string]: unknown;
      };
    }) => Promise<{
      text?: string;
      candidates?: Array<{
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
          webSearchQueries?: string[];
        };
      }>;
    }>;
    embedContent?: (params: {
      model: string;
      contents: string;
    }) => Promise<{
      embedding?: { values?: number[] };
      embeddings?: Array<{ values?: number[] }>;
    }>;
  };
}

export class GeminiService {
  private readonly customClient?: GeminiClient;
  private readonly pool: ApiKeyPoolService;
  private readonly clientCache: Map<string, GeminiClient> = new Map();
  private readonly maxAttempts = 2;

  constructor(
    apiKeyOrPool: string | ApiKeyPoolService,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly systemInstruction = AI_SYSTEM_INSTRUCTION,
    client?: GeminiClient,
  ) {
    if (client) {
      this.customClient = client;
      this.pool = apiKeyPoolService;
    } else if (typeof apiKeyOrPool === "string") {
      this.pool = apiKeyPoolService;
    } else {
      this.pool = apiKeyOrPool;
    }
  }

  private getClient(keyInfo?: ManagedKey): GeminiClient {
    if (this.customClient) return this.customClient;
    const rawKey = keyInfo?.key || process.env.GEMINI_API_KEY?.trim() || "missing-key";
    let cached = this.clientCache.get(rawKey);
    if (!cached) {
      cached = new GoogleGenAI({ apiKey: rawKey }) as unknown as GeminiClient;
      this.clientCache.set(rawKey, cached);
    }
    return cached;
  }

  async generateReply(
    history: GeminiMessage[],
    message: string,
    guidance?: AssistantGuidance | string,
    options?: GenerateReplyOptions,
  ): Promise<string> {
    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: message },
    ];
    if (options?.attachments && options.attachments.length > 0) {
      for (const att of options.attachments) {
        userParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data,
          },
        });
      }
    }

    const contents: Content[] = [
      ...history.map((item) => ({
        role: item.role,
        parts: [{ text: item.content }],
      })),
      {
        role: "user",
        parts: userParts as unknown as Content["parts"],
      },
    ];

    const requestConfig: Record<string, unknown> = {
      systemInstruction: buildSystemInstruction(this.systemInstruction, guidance),
    };
    if (options?.enableSearch) {
      requestConfig.tools = [{ googleSearch: {} }];
    }
    if (options?.thinkingLevel) {
      requestConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
    }

    if (this.customClient) {
      return this.executeOnClient(this.customClient, contents, requestConfig, {
        prompt: message,
        enableSearch: Boolean(options?.enableSearch),
        hasAudio: options?.hasAudio,
        hasVisionOrDocument: options?.hasVisionOrDocument,
        mediaSizeBytes: options?.mediaSizeBytes,
      });
    }

    const candidateKeys = this.pool.getOrderedKeysForExecution();
    let lastError: unknown;

    for (const keyInfo of candidateKeys) {
      const client = this.getClient(keyInfo);
      const start = Date.now();
      try {
        const reply = await this.executeOnClient(client, contents, requestConfig, {
          prompt: message,
          enableSearch: Boolean(options?.enableSearch),
          targetKeyId: keyInfo.id,
          hasAudio: options?.hasAudio,
          hasVisionOrDocument: options?.hasVisionOrDocument,
          mediaSizeBytes: options?.mediaSizeBytes,
        });
        this.pool.recordSuccess(keyInfo.id, Date.now() - start);
        return reply;
      } catch (error) {
        lastError = error;
        this.pool.recordError(keyInfo.id, error);
        logger.warn(
          {
            keyId: keyInfo.id,
            keyName: keyInfo.name,
            error: safeErrorMetadata(error),
          },
          "Gemini key attempt failed; failing over to next available key in pool",
        );
      }
    }

    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("All Gemini API keys in pool failed.", lastError);
  }

  async generateReplyStream(
    history: GeminiMessage[],
    message: string,
    guidance?: AssistantGuidance | string,
    options?: GenerateReplyOptions,
    onChunk?: (accumulatedText: string) => Promise<void> | void,
  ): Promise<string> {
    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: message },
    ];
    if (options?.attachments && options.attachments.length > 0) {
      for (const att of options.attachments) {
        userParts.push({
          inlineData: {
            mimeType: att.mimeType,
            data: att.data,
          },
        });
      }
    }

    const contents: Content[] = [
      ...history.map((item) => ({
        role: item.role,
        parts: [{ text: item.content }],
      })),
      {
        role: "user",
        parts: userParts as unknown as Content["parts"],
      },
    ];

    const requestConfig: Record<string, unknown> = {
      systemInstruction: buildSystemInstruction(this.systemInstruction, guidance),
    };
    if (options?.enableSearch) {
      requestConfig.tools = [{ googleSearch: {} }];
    }
    if (options?.thinkingLevel) {
      requestConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
    }

    if (this.customClient) {
      return this.executeStreamOnClient(
        this.customClient,
        contents,
        requestConfig,
        {
          prompt: message,
          enableSearch: Boolean(options?.enableSearch),
          hasAudio: options?.hasAudio,
          hasVisionOrDocument: options?.hasVisionOrDocument,
          mediaSizeBytes: options?.mediaSizeBytes,
        },
        onChunk,
      );
    }

    const candidateKeys = this.pool.getOrderedKeysForExecution();
    let lastError: unknown;

    for (const keyInfo of candidateKeys) {
      const client = this.getClient(keyInfo);
      const start = Date.now();
      try {
        const reply = await this.executeStreamOnClient(
          client,
          contents,
          requestConfig,
          {
            prompt: message,
            enableSearch: Boolean(options?.enableSearch),
            targetKeyId: keyInfo.id,
            hasAudio: options?.hasAudio,
            hasVisionOrDocument: options?.hasVisionOrDocument,
            mediaSizeBytes: options?.mediaSizeBytes,
          },
          onChunk,
        );
        this.pool.recordSuccess(keyInfo.id, Date.now() - start);
        return reply;
      } catch (error) {
        lastError = error;
        this.pool.recordError(keyInfo.id, error);
        logger.warn(
          {
            keyId: keyInfo.id,
            keyName: keyInfo.name,
            error: safeErrorMetadata(error),
          },
          "Gemini streaming key attempt failed; failing over to next available key",
        );
      }
    }

    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("All Gemini API keys in pool failed during streaming.", lastError);
  }

  private async executeStreamOnClient(
    client: GeminiClient,
    contents: Content[],
    requestConfig: Record<string, unknown>,
    options?: {
      prompt?: string;
      enableSearch?: boolean;
      targetKeyId?: string;
      hasAudio?: boolean;
      hasVisionOrDocument?: boolean;
      mediaSizeBytes?: number;
    },
    onChunk?: (accumulatedText: string) => Promise<void> | void,
  ): Promise<string> {
    // If client does not support generateContentStream (e.g. mock test client), fall back to standard generation
    if (typeof (client.models as Record<string, unknown>).generateContentStream !== "function") {
      const result = await this.executeOnClient(client, contents, requestConfig, options);
      if (onChunk) await onChunk(result);
      return result;
    }

    let currentModel = AdaptiveEngineService.computeAdaptiveModel({
      prompt: options?.prompt,
      enableSearch: Boolean(options?.enableSearch),
      configuredModel: this.model,
    });

    const effectiveTimeout =
      this.timeoutMs && this.timeoutMs < 1000
        ? this.timeoutMs
        : AdaptiveEngineService.computeAdaptiveTimeout({
            prompt: options?.prompt,
            enableSearch: Boolean(options?.enableSearch),
            targetKeyId: options?.targetKeyId,
            hasAudio: options?.hasAudio,
            hasVisionOrDocument: options?.hasVisionOrDocument,
            mediaSizeBytes: options?.mediaSizeBytes,
          });

    try {
      // Execute the SDK stream with timeout guard
      const streamPromise = (
        (client.models as unknown) as {
          generateContentStream: (params: {
            model: string;
            contents: Content[];
            config?: Record<string, unknown>;
          }) => Promise<AsyncIterable<{ text?: string; candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }> }>>;
        }
      ).generateContentStream({
        model: currentModel,
        contents,
        config: requestConfig,
      });

      const stream = await Promise.race([
        streamPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new GeminiTimeoutError()), effectiveTimeout);
        }),
      ]);

      let accumulated = "";
      const sources: Array<{ uri: string; title?: string }> = [];

      for await (const chunk of stream) {
        if (chunk.text) {
          accumulated += chunk.text;
          if (onChunk) {
            await onChunk(accumulated);
          }
        }
        const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (Array.isArray(chunks)) {
          for (const c of chunks) {
            if (c.web?.uri && !sources.some((s) => s.uri === c.web?.uri)) {
              sources.push({ uri: c.web.uri, title: c.web.title });
            }
          }
        }
      }

      let finalText = accumulated.trim();
      if (!finalText) {
        // If stream ended empty, fallback to standard generateContent
        return this.executeOnClient(client, contents, requestConfig, options);
      }

      if (sources.length > 0) {
        const citationLines = sources
          .slice(0, 4)
          .map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.uri}`);
        finalText = `${finalText}\n\n🔍 Sources:\n${citationLines.join("\n")}`;
      }

      return finalText;
    } catch (error) {
      logger.warn(
        { model: currentModel, error: safeErrorMetadata(error) },
        "Streaming attempt encountered error; falling back to non-streaming execution",
      );
      return this.executeOnClient(client, contents, requestConfig, options);
    }
  }

  private async executeOnClient(
    client: GeminiClient,
    contents: Content[],
    requestConfig: Record<string, unknown>,
    options?: {
      prompt?: string;
      enableSearch?: boolean;
      targetKeyId?: string;
      hasAudio?: boolean;
      hasVisionOrDocument?: boolean;
      mediaSizeBytes?: number;
    },
  ): Promise<string> {
    let currentModel = AdaptiveEngineService.computeAdaptiveModel({
      prompt: options?.prompt,
      enableSearch: Boolean(options?.enableSearch),
      configuredModel: this.model,
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        let response: {
          text?: string;
          candidates?: Array<{
            groundingMetadata?: {
              groundingChunks?: Array<{
                web?: { uri?: string; title?: string };
              }>;
              webSearchQueries?: string[];
            };
          }>;
        };
        const effectiveTimeout =
          this.timeoutMs && this.timeoutMs < 1000
            ? this.timeoutMs
            : AdaptiveEngineService.computeAdaptiveTimeout({
                prompt: options?.prompt,
                enableSearch: Boolean(options?.enableSearch),
                targetKeyId: options?.targetKeyId,
                hasAudio: options?.hasAudio,
                hasVisionOrDocument: options?.hasVisionOrDocument,
                mediaSizeBytes: options?.mediaSizeBytes,
              });

        try {
          response = await Promise.race([
            client.models.generateContent({
              model: currentModel,
              contents,
              config: requestConfig,
            }),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new GeminiTimeoutError()), effectiveTimeout);
            }),
          ]);
        } catch (error) {
          logger.warn(
            {
              stage: "gemini_request",
              model: currentModel,
              attempt,
              error: safeErrorMetadata(error),
            },
            "Gemini request attempt encountered issue",
          );
          throw error;
        }

        try {
          let reply = response.text?.trim();
          if (!reply) throw new GeminiMalformedResponseError();

          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (Array.isArray(chunks) && chunks.length > 0) {
            const sources = chunks
              .map((c) => c.web)
              .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
              .slice(0, 4);
            if (sources.length > 0) {
              const citationLines = sources.map(
                (s) => `• ${s.title ? `${s.title}: ` : ""}${s.uri}`,
              );
              reply = `${reply}\n\n🔍 Sources:\n${citationLines.join("\n")}`;
            }
          }

          return reply;
        } catch (error) {
          logger.error(
            {
              stage: "gemini_response_parsing",
              model: currentModel,
              attempt,
              responseTextPopulated: Boolean(response.text?.trim()),
              error: safeErrorMetadata(error),
            },
            "Gemini response parsing failed",
          );
          throw error;
        }
      } catch (error) {
        lastError = error;
        if (!isRetryableGeminiError(error)) break;

        // Graceful fallback for free-tier keys: if tools or thinkingConfig triggered an error, strip them and retry cleanly
        if (requestConfig.tools || requestConfig.thinkingConfig) {
          logger.warn(
            { stage: "gemini_tool_fallback", error: safeErrorMetadata(error) },
            "Tool or thinking configuration failed; falling back to standard generation without optional tools",
          );
          delete requestConfig.tools;
          delete requestConfig.thinkingConfig;
          continue;
        }

        // Graceful fallback for free-tier quotas: if Pro model is rate-limited, fall back to high-capacity Flash
        if (currentModel !== "gemini-2.5-flash" && attempt < this.maxAttempts) {
          logger.info(
            { fromModel: currentModel, toModel: "gemini-2.5-flash" },
            "Falling back from Pro to Flash tier for resilient free-tier delivery",
          );
          currentModel = "gemini-2.5-flash";
          continue;
        }

        if (attempt === this.maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }

    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("Gemini request failed.", lastError);
  }

  async embedText(text: string): Promise<number[]> {
    try {
      const client = this.getClient();
      const embedFn = client.models.embedContent;
      if (typeof embedFn !== "function") return [];
      const response = await embedFn({
        model: "gemini-embedding-2-preview",
        contents: text,
      });
      const values = response.embedding?.values || response.embeddings?.[0]?.values;
      return Array.isArray(values) ? values : [];
    } catch (error) {
      logger.debug(
        { stage: "embed_text", error: safeErrorMetadata(error) },
        "Vector embedding skipped",
      );
      return [];
    }
  }

  async extractUserFacts(message: string): Promise<ExtractedFact[]> {
    const trimmed = message.trim();
    if (trimmed.length < 4) return [];

    // Detect first-person statements, preferences, instructions, or biographical disclosures
    const selfDisclosureRegex =
      /\b(i|i'm|im|my|me|mine|call me|prefer|preference|favorite|favourite|like|love|dislike|hate|usually|always|never|work as|working as|work at|live in|living in|based in|speak|study|stack|role|job|engineer|developer|timezone|don't|do not|please|remember)\b/i;

    if (!selfDisclosureRegex.test(trimmed)) return [];

    try {
      const client = this.getClient();
      const extractionModel = AdaptiveEngineService.computeAdaptiveModel({
        isExtraction: true,
        configuredModel: this.model,
      });

      const response = await client.models.generateContent({
        model: extractionModel,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analyze this user message and extract any durable user facts, preferences, or personal instructions.
Return ONLY a valid JSON array of objects with schema: [{"key": string, "content": string, "category": "preference"|"fact"|"instruction"}].
Keep keys concise and descriptive (e.g., "preferred_stack", "timezone", "name", "role", "coding_style").
If no durable personal facts are mentioned, return [].

User message: "${message.replace(/"/g, '\\"')}"`,
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            "You are a precise JSON extractor. Output valid JSON only, without markdown code fences.",
        },
      });

      const text = (response.text ?? "").trim();
      const cleaned = text
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();
      if (!cleaned || cleaned === "[]") return [];
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            typeof item.key === "string" &&
            typeof item.content === "string",
        );
      }
      return [];
    } catch {
      return [];
    }
  }

  async summarizeSession(messages: GeminiMessage[]): Promise<string> {
    if (messages.length < 2) return "";
    try {
      const client = this.getClient();
      const dialog = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      const response = await client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Summarize the following chat conversation into 2-3 concise bullet points focusing on key user context, problems discussed, and decisions made:\n\n${dialog}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            "You are a concise conversation summarizer. Provide clear, compact factual bullet points.",
        },
      });
      return (response.text ?? "").trim();
    } catch {
      return "";
    }
  }
}

function buildSystemInstruction(
  baseInstruction: string,
  guidance?: AssistantGuidance | string,
): string {
  if (!guidance) return baseInstruction;
  const personalityInstruction =
    typeof guidance === "string" ? guidance : guidance.personalityInstruction;
  const modeInstruction =
    typeof guidance === "string" ? undefined : guidance.modeInstruction;
  const memoryInstruction =
    typeof guidance === "string" ? undefined : guidance.memoryInstruction;
  const sections = [baseInstruction];
  if (personalityInstruction) {
    sections.push(`Personality guidance:\n${personalityInstruction}`);
  }
  if (modeInstruction) {
    sections.push(`Assistant mode guidance:\n${modeInstruction}`);
  }
  if (memoryInstruction) {
    sections.push(memoryInstruction);
  }
  return sections.join("\n\n");
}

function isRetryableGeminiError(error: unknown): boolean {
  if (error instanceof GeminiMalformedResponseError) return false;
  if (error instanceof GeminiTimeoutError) return true;
  if (error instanceof GeminiError) return false;

  const record = typeof error === "object" && error !== null ? error : undefined;
  const status = record && "status" in record && typeof record.status === "number"
    ? record.status
    : undefined;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("rate limit") ||
    message.includes("temporarily unavailable") ||
    message.includes("service unavailable") ||
    message.includes("timeout");
}

export class GeminiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class GeminiTimeoutError extends GeminiError {
  constructor() {
    super("Gemini request timed out.");
  }
}

export class GeminiMalformedResponseError extends GeminiError {
  constructor() {
    super("Gemini returned an empty response.");
  }
}

export class GeminiServiceError extends GeminiError {}