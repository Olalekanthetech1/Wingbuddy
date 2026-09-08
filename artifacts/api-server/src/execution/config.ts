import type { ExecutionEngineConfig } from "./types";

/**
 * Execution Engine V1 Configuration
 * Production Status: ENABLED (defaults to true; disable with EXECUTION_ENGINE_ENABLED=false).
 */

export function getExecutionConfig(): ExecutionEngineConfig {
  const envVal = process.env.EXECUTION_ENGINE_ENABLED;
  const enabled = envVal === undefined || envVal === "" || envVal === "true" || envVal === "1";
  const maxConcurrency = Math.max(1, Math.min(50, Number(process.env.EXECUTION_MAX_CONCURRENCY) || 10));
  const maxPerUser = Math.max(1, Math.min(20, Number(process.env.EXECUTION_MAX_PER_USER) || 3));
  const maxPerGraph = Math.max(1, Math.min(20, Number(process.env.EXECUTION_MAX_PER_GRAPH) || 5));
  const maxPerTool = Math.max(1, Math.min(10, Number(process.env.EXECUTION_MAX_PER_TOOL) || 2));
  const leaseDurationMs = Math.max(5000, Math.min(120_000, Number(process.env.EXECUTION_LEASE_DURATION_MS) || 30_000));
  const staleLeaseThresholdMs = Math.max(10_000, Math.min(300_000, Number(process.env.EXECUTION_STALE_LEASE_THRESHOLD_MS) || 60_000));
  const defaultTimeoutMs = Math.max(1000, Math.min(300_000, Number(process.env.EXECUTION_DEFAULT_TIMEOUT_MS) || 60_000));
  const maxRetries = Math.max(0, Math.min(5, Number(process.env.EXECUTION_MAX_RETRIES) || 3));

  return {
    enabled,
    maxConcurrency,
    maxPerUser,
    maxPerGraph,
    maxPerTool,
    leaseDurationMs,
    staleLeaseThresholdMs,
    defaultTimeoutMs,
    maxRetries,
  };
}
