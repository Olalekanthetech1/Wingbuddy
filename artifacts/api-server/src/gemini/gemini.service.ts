import { GoogleGenAI, type Content } from "@google/genai";
import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";

export interface GeminiMessage {
  role: "user" | "model";
  content: string;
}

export interface AssistantGuidance {
  personalityInstruction?: string;
  modeInstruction?: string;
}

interface GeminiClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: Content[];
      config: { systemInstruction: string };
    }) => Promise<{ text?: string }>;
  };
}

export class GeminiService {
  private readonly client: GeminiClient;
  private readonly maxAttempts = 2;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly systemInstruction = AI_SYSTEM_INSTRUCTION,
    client?: GeminiClient,
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async generateReply(
    history: GeminiMessage[],
    message: string,
    guidance?: AssistantGuidance | string,
  ): Promise<string> {
    const contents: Content[] = [
      ...history.map((item) => ({
        role: item.role,
        parts: [{ text: item.content }],
      })),
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        let response: { text?: string };
        try {
          response = await Promise.race([
            this.client.models.generateContent({
              model: this.model,
              contents,
              config: {
                systemInstruction: buildSystemInstruction(this.systemInstruction, guidance),
              },
            }),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new GeminiTimeoutError()), this.timeoutMs);
            }),
          ]);
        } catch (error) {
          logger.error(
            {
              stage: "gemini_request",
              model: this.model,
              attempt,
              error: safeErrorMetadata(error),
            },
            "Gemini request failed",
          );
          throw error;
        }

        try {
          const reply = response.text?.trim();
          if (!reply) throw new GeminiMalformedResponseError();
          return reply;
        } catch (error) {
          logger.error(
            {
              stage: "gemini_response_parsing",
              model: this.model,
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
        if (!isRetryableGeminiError(error) || attempt === this.maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }

    if (lastError instanceof GeminiError) throw lastError;
    throw new GeminiServiceError("Gemini request failed.", lastError);
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
  const sections = [baseInstruction];
  if (personalityInstruction) {
    sections.push(`Personality guidance:\n${personalityInstruction}`);
  }
  if (modeInstruction) {
    sections.push(`Assistant mode guidance:\n${modeInstruction}`);
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