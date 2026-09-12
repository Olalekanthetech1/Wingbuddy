import { logger } from "../lib/logger";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import { researchObservabilityService } from "./research-observability.service";

const TAVILY_API_URL = "https://api.tavily.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export type TavilySearchDepth = "basic" | "advanced";
export type TavilyTopic = "general" | "news" | "finance";

export interface TavilySearchOptions {
  query: string;
  searchDepth?: TavilySearchDepth;
  topic?: TavilyTopic;
  maxResults?: number;
  timeRange?: "day" | "week" | "month" | "year";
  startDate?: string;
  endDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  includeRawContent?: boolean;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
  rawContent?: string;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
  responseTime?: number;
  requestId?: string;
  provider: "tavily";
  retrievedAt: string;
}

export interface TavilyExtractResult {
  url: string;
  rawContent: string;
  provider: "tavily";
  retrievedAt: string;
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failedResults?: Array<{ url?: string; error?: string }>;
  provider: "tavily";
  retrievedAt: string;
}

export class TavilyService {
  private readonly fallbackApiKey?: string;
  private readonly timeoutMs: number;

  constructor(fallbackApiKey = process.env.TAVILY_API_KEY?.trim() || undefined) {
    this.fallbackApiKey = fallbackApiKey;
    this.timeoutMs = Number(process.env.TAVILY_TIMEOUT_MS) > 0 ? Number(process.env.TAVILY_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    const summary = aiProviderKeyPoolService.getSummary("tavily");
    if (summary.healthyKeys > 0 || summary.totalKeys > 0) return true;
    return Boolean(this.fallbackApiKey);
  }

  async search(options: TavilySearchOptions): Promise<TavilySearchResponse> {
    const query = options.query.trim();
    if (!query) throw new Error("Tavily search requires a non-empty query.");
    const payload: Record<string, unknown> = {
      query,
      search_depth: options.searchDepth || "basic",
      topic: options.topic || "general",
      max_results: Math.min(Math.max(options.maxResults || 5, 1), 20),
      include_answer: false,
      include_raw_content: Boolean(options.includeRawContent),
    };
    if (options.timeRange) payload.time_range = options.timeRange;
    if (options.startDate) payload.start_date = options.startDate;
    if (options.endDate) payload.end_date = options.endDate;
    if (options.includeDomains?.length) payload.include_domains = options.includeDomains;
    if (options.excludeDomains?.length) payload.exclude_domains = options.excludeDomains;
    if (options.country) payload.country = options.country;

    const start = Date.now();
    try {
      const data = await this.requestWithPool("/search", payload);
      const latencyMs = Date.now() - start;
      const results: TavilySearchResult[] = Array.isArray(data.results) ? data.results.map((item: any) => ({
        title: String(item?.title || "Untitled source"),
        url: String(item?.url || ""),
        content: String(item?.content || ""),
        score: typeof item?.score === "number" ? item.score : undefined,
        publishedDate: item?.published_date ? String(item.published_date) : undefined,
        rawContent: item?.raw_content ? String(item.raw_content) : undefined,
      })).filter((item: TavilySearchResult) => item.url) : [];

      researchObservabilityService.recordExecution({
        query,
        depth: options.searchDepth || "basic",
        resultsCount: results.length,
        latencyMs,
        success: true,
      });

      return {
        query,
        results,
        answer: typeof data.answer === "string" ? data.answer : undefined,
        responseTime: typeof data.response_time === "number" ? data.response_time : latencyMs,
        requestId: typeof data.request_id === "string" ? data.request_id : undefined,
        provider: "tavily",
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      researchObservabilityService.recordExecution({
        query,
        depth: options.searchDepth || "basic",
        resultsCount: 0,
        latencyMs,
        success: false,
      });
      throw error;
    }
  }

  async extract(urls: string[], extractDepth: "basic" | "advanced" = "basic"): Promise<TavilyExtractResponse> {
    const normalized = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 20);
    if (!normalized.length) throw new Error("Tavily extract requires at least one URL.");
    const data = await this.requestWithPool("/extract", { urls: normalized, extract_depth: extractDepth });
    return {
      results: Array.isArray(data.results) ? data.results.map((item: any) => ({
        url: String(item?.url || ""), rawContent: String(item?.raw_content || ""), provider: "tavily" as const, retrievedAt: new Date().toISOString(),
      })).filter((item: TavilyExtractResult) => item.url && item.rawContent) : [],
      failedResults: Array.isArray(data.failed_results) ? data.failed_results.map((item: any) => ({ url: item?.url ? String(item.url) : undefined, error: item?.error ? String(item.error) : undefined })) : undefined,
      provider: "tavily",
      retrievedAt: new Date().toISOString(),
    };
  }

  private async requestWithPool(path: string, payload: Record<string, unknown>): Promise<any> {
    await aiProviderKeyPoolService.hydrateProvider("tavily", "TAVILY_API_KEY");
    const orderedKeys = aiProviderKeyPoolService.getOrderedKeys("tavily");

    if (orderedKeys.length > 0) {
      let lastPoolError: unknown;
      for (const managedKey of orderedKeys) {
        const start = Date.now();
        try {
          const result = await this.executeRawRequest(path, payload, managedKey.key);
          aiProviderKeyPoolService.recordSuccess(managedKey.id, Date.now() - start);
          return result;
        } catch (error) {
          aiProviderKeyPoolService.recordFailure(managedKey.id, error);
          lastPoolError = error;
          logger.warn({ keyId: managedKey.id, provider: "tavily", error: String(error) }, "Tavily key pool attempt failed; rotating/failing over");
        }
      }
      throw lastPoolError instanceof Error ? lastPoolError : new Error("All managed Tavily keys in the pool failed.");
    }

    if (this.fallbackApiKey) {
      return this.executeRawRequest(path, payload, this.fallbackApiKey);
    }

    throw new Error("Tavily web research is not configured. Add a Tavily API key in the dashboard or set TAVILY_API_KEY.");
  }

  private async executeRawRequest(path: string, payload: Record<string, unknown>, apiKey: string): Promise<any> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${TAVILY_API_URL}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        const text = await response.text();
        let data: any = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
        if (response.ok) return data;
        const message = String(data?.detail || data?.error || `Tavily request failed with HTTP ${response.status}.`);
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || attempt === MAX_RETRIES) {
          const error = new Error(message);
          (error as Error & { retryable?: boolean }).retryable = retryable;
          throw error;
        }
        lastError = new Error(message);
      } catch (error) {
        lastError = error;
        if ((error as Error & { retryable?: boolean })?.retryable === false || attempt === MAX_RETRIES) break;
      } finally { clearTimeout(timer); }
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
    logger.warn({ provider: "tavily", error: lastError instanceof Error ? lastError.message : String(lastError) }, "TAVILY_REQUEST_FAILED");
    throw lastError instanceof Error ? lastError : new Error("Tavily request failed.");
  }
}

export const tavilyService = new TavilyService();
