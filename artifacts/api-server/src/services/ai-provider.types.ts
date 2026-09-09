export type AIProviderId = "gemini" | "groq" | "mistral";

export type AIProviderCapability =
  | "chat"
  | "streaming"
  | "tool_calling"
  | "vision"
  | "reasoning"
  | "long_context";

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

export interface AIChatRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
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

export interface AIProviderAdapter {
  readonly providerId: AIProviderId;
  chat(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): Promise<AIChatResponse>;
  stream(request: AIChatRequest, provider: AIProviderRecord, apiKey?: string): AsyncGenerator<AIStreamChunk>;
  test(model: string, provider: AIProviderRecord, apiKey?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  listModels(provider: AIProviderRecord, apiKey?: string): Promise<AIModelCatalogEntry[]>;
}
