import { apiKeyPoolService } from "./api-key-pool.service";
import { logger } from "../lib/logger";

export type HealthStatusLevel = "ready" | "degraded" | "offline";

export interface RollingWindowHealth {
  status: HealthStatusLevel;
  statusLabel: string;
  details: string;
  metrics: {
    rollingWindowSeconds: number;
    sampleCount: number;
    successRate: number;
    errorRate: number;
    avgLatencyMs: number;
    healthyProviders: number;
    cooldownProviders: number;
  };
  criteria: string;
  evaluatedAt: string;
}

interface RequestSample {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  provider?: string;
  isRateLimitOrCooldown?: boolean;
}

export class HealthMonitorService {
  private samples: RequestSample[] = [];
  private readonly windowMs = 5 * 60 * 1000; // 5 minute rolling window
  private readonly maxSamples = 200;

  /**
   * Records a request sample into the rolling window
   */
  public recordSample(success: boolean, latencyMs: number, provider?: string, isRateLimitOrCooldown?: boolean): void {
    const now = Date.now();
    this.samples.push({ timestamp: now, success, latencyMs, provider, isRateLimitOrCooldown });
    this.pruneOldSamples(now);
  }

  private pruneOldSamples(now: number): void {
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.timestamp >= cutoff);
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(this.samples.length - this.maxSamples);
    }
  }

  /**
   * Evaluates system health over rolling window + live key-pool status
   * Criteria:
   * 1. Ready / Healthy: Error rate < 5%, at least 1 healthy primary key, 0 systemic provider dropouts.
   * 2. Degraded: Error rate between 5% and 25%, or primary provider in cooldown with fallback provider taking traffic.
   * 3. Offline / Disrupted: Error rate > 25% or 0 usable healthy provider keys.
   */
  public evaluateHealth(): RollingWindowHealth {
    const now = Date.now();
    this.pruneOldSamples(now);

    const keySummary = apiKeyPoolService.getSummary();
    const healthyCount = keySummary.healthyKeys;
    const cooldownCount = keySummary.inCooldownKeys;
    const totalKeys = keySummary.totalKeys;

    const sampleCount = this.samples.length;
    const successCount = this.samples.filter((s) => s.success).length;
    const successRate = sampleCount > 0 ? (successCount / sampleCount) * 100 : 100;
    const errorRate = sampleCount > 0 ? 100 - successRate : 0;
    const avgLatencyMs = sampleCount > 0
      ? Math.round(this.samples.reduce((acc, s) => acc + s.latencyMs, 0) / sampleCount)
      : 0;

    let status: HealthStatusLevel = "ready";
    let statusLabel = "Assistant Ready";
    let details = "Live & responding normally";
    let criteria = "All AI providers operational with <5% rolling error rate.";

    if (totalKeys === 0) {
      status = "offline";
      statusLabel = "Assistant Temporarily Unavailable";
      details = "AI provider connection being restored";
      criteria = "No configured AI provider keys available.";
    } else if (healthyCount === 0) {
      if (cooldownCount > 0) {
        status = "degraded";
        statusLabel = "Running at reduced capacity • Replies may be slower";
        details = "Automatic provider recovery in progress";
        criteria = `All primary keys entered temporary cooldown (${cooldownCount} cooling down).`;
      } else {
        status = "offline";
        statusLabel = "Service Disruption";
        details = "Upstream provider connection retry in progress";
        criteria = "All active provider keys offline or failing.";
      }
    } else if (errorRate >= 25) {
      status = "offline";
      statusLabel = "Service Disruption";
      details = "High error rate detected over rolling 5-minute window";
      criteria = `Rolling 5-minute error rate (${errorRate.toFixed(1)}%) exceeded disruption threshold (>=25%).`;
    } else if (errorRate >= 5 || cooldownCount > 0) {
      status = "degraded";
      statusLabel = "Running at reduced capacity • Replies may be slower";
      details = cooldownCount > 0
        ? `Failover active (${cooldownCount} provider key(s) in cooldown)`
        : `Elevated error rate (${errorRate.toFixed(1)}%) over 5-minute window`;
      criteria = `Rolling error rate between 5%-25% or partial provider cooldown active.`;
    }

    return {
      status,
      statusLabel,
      details,
      metrics: {
        rollingWindowSeconds: this.windowMs / 1000,
        sampleCount,
        successRate: Number(successRate.toFixed(1)),
        errorRate: Number(errorRate.toFixed(1)),
        avgLatencyMs,
        healthyProviders: healthyCount,
        cooldownProviders: cooldownCount,
      },
      criteria,
      evaluatedAt: new Date(now).toISOString(),
    };
  }
}

export const healthMonitorService = new HealthMonitorService();
