export type AIProviderId = "gemini" | "groq" | "mistral" | "huggingface" | "elevenlabs";

export type AIProviderCapability =
  | "chat"
  | "streaming"
  | "tool_calling"
  | "vision"
  | "reasoning"
  | "long_context"
  | "web_search"
  | "image_generation"
  | "video_generation"
  | "audio_generation";

export interface AIProviderRecord {
  id: AIProviderId;
  name: string;
  adapter: AIProviderId;
  enabled: boolean;
  baseUrl: string;
  apiKeyEnv: string;
  capabilities: AIProviderCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface AIModelCatalogEntry {
  provider: AIProviderId;
  modelId: string;
  name: string;
  status: "active" | "inactive" | "unknown";
  capabilities: string[];
  contextWindow?: number;
  source: "provider_api" | "registry";
}

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface AIChatAttachment {
  mimeType: string;
  data: string;
  fileName?: string;
}

export interface AIChatRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  enableSearch?: boolean;
  thinkingLevel?: string;
  attachments?: AIChatAttachment[];
  metadata?: Record<string, unknown>;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AIChatResponse {
  provider: AIProviderId;
  model: string;
  text: string;
  finishReason?: string;
  usage?: AIUsage;
  raw?: unknown;
}

export interface AIStreamChunk {
  provider: AIProviderId;
  model: string;
  delta: string;
  done: boolean;
  finishReason?: string;
  usage?: AIUsage;
}

export interface AIImageGenerationRequest {
  model?: string;
  prompt: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface AIImageGenerationResponse {
  provider: AIProviderId;
  route: "inference_provider" | "community";
  model: string;
  buffer: Buffer;
  mimeType: string;
  sourceUrl?: string;
  fallbackUsed: boolean;
  raw?: unknown;
}

export interface AIVideoGenerationRequest {
  model?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface AIVideoGenerationResponse {
  provider: AIProviderId;
  route: "inference_provider" | "community";
  model: string;
  buffer: Buffer;
  mimeType: string;
  sourceUrl?: string;
  fallbackUsed: boolean;
  raw?: unknown;
}

export interface AIEmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  metadata?: Record<string, unknown>;
}

export interface AIEmbeddingResponse {
  provider: AIProviderId;
  model: string;
  embeddings: number[][];
  usage?: AIUsage;
  raw?: unknown;
}

export interface AIProviderAdapter {
  readonly providerId: AIProviderId;
  chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse>;
  stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk>;
  test(model: string, provider: AIProviderRecord, apiKey?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]>;
  generateImage?(request: AIImageGenerationRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIImageGenerationResponse>;
  generateVideo?(request: AIVideoGenerationRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIVideoGenerationResponse>;
  generateEmbeddings?(request: AIEmbeddingRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIEmbeddingResponse>;
}