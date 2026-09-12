export interface ResearchTelemetrySnapshot {
  requestsToday: number;
  successful: number;
  failed: number;
  cacheHits: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  providerStatus: "healthy" | "degraded" | "unconfigured";
  recentSearches: Array<{
    id: string;
    query: string;
    depth: string;
    resultsCount: number;
    latencyMs: number;
    timestamp: string;
    cached: boolean;
    success: boolean;
    keyId?: string;
  }>;
}

class ResearchObservabilityService {
  private totalRequests = 0;
  private successCount = 0;
  private failCount = 0;
  private cacheHitCount = 0;
  private latencies: number[] = [];
  private history: Array<{
    id: string;
    query: string;
    depth: string;
    resultsCount: number;
    latencyMs: number;
    timestamp: string;
    cached: boolean;
    success: boolean;
    keyId?: string;
  }> = [];

  recordExecution(entry: {
    query: string;
    depth: string;
    resultsCount: number;
    latencyMs: number;
    cached?: boolean;
    success: boolean;
    keyId?: string;
  }): void {
    this.totalRequests += 1;
    if (entry.success) {
      this.successCount += 1;
    } else {
      this.failCount += 1;
    }
    if (entry.cached) {
      this.cacheHitCount += 1;
    }
    if (entry.latencyMs > 0) {
      this.latencies.push(entry.latencyMs);
      if (this.latencies.length > 500) this.latencies.shift();
    }

    const item = {
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      query: entry.query.slice(0, 120),
      depth: entry.depth,
      resultsCount: entry.resultsCount,
      latencyMs: entry.latencyMs,
      timestamp: new Date().toISOString(),
      cached: Boolean(entry.cached),
      success: entry.success,
      keyId: entry.keyId,
    };
    this.history.unshift(item);
    if (this.history.length > 50) this.history.pop();
  }

  getTelemetry(isConfigured: boolean, hasHealthyKeys: boolean): ResearchTelemetrySnapshot {
    const latenciesSorted = [...this.latencies].sort((a, b) => a - b);
    const avgLatencyMs = latenciesSorted.length > 0 
      ? Math.round(latenciesSorted.reduce((a, b) => a + b, 0) / latenciesSorted.length) 
      : 0;
    const p95Index = Math.floor(latenciesSorted.length * 0.95);
    const p95LatencyMs = latenciesSorted.length > 0 ? latenciesSorted[p95Index] || latenciesSorted[latenciesSorted.length - 1] : 0;
    const cacheHitRate = this.totalRequests > 0 
      ? Math.round((this.cacheHitCount / this.totalRequests) * 1000) / 10 
      : 0;

    let providerStatus: "healthy" | "degraded" | "unconfigured" = "unconfigured";
    if (isConfigured || hasHealthyKeys) {
      providerStatus = hasHealthyKeys || isConfigured ? (this.failCount > 0 && this.successCount === 0 ? "degraded" : "healthy") : "unconfigured";
    }

    return {
      requestsToday: this.totalRequests,
      successful: this.successCount,
      failed: this.failCount,
      cacheHits: this.cacheHitCount,
      cacheHitRate,
      avgLatencyMs,
      p95LatencyMs,
      providerStatus,
      recentSearches: this.history,
    };
  }
}

export const researchObservabilityService = new ResearchObservabilityService();
