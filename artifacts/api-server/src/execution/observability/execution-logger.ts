import { logger } from "../../lib/logger";
import type { ExecutionEventName, ExecutionEventPayload } from "../types";

export interface ExecutionMetrics {
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  cancelledExecutions: number;
  totalNodeExecutions: number;
  completedNodeExecutions: number;
  failedNodeExecutions: number;
  retriedNodeExecutions: number;
  timedOutNodeExecutions: number;
  verificationFailures: number;
  staleLeasesRecovered: number;
}

const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "secret",
  "password",
  "passwd",
  "authorization",
  "credentials",
  "bot_token",
  "bottoken",
]);

export function redactSensitiveData(data: unknown): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (REDACTED_KEYS.has(lowerKey)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class ExecutionObservabilityService {
  private static instance: ExecutionObservabilityService;

  private readonly recentEvents: ExecutionEventPayload[] = [];
  private readonly metrics: ExecutionMetrics = {
    totalExecutions: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    cancelledExecutions: 0,
    totalNodeExecutions: 0,
    completedNodeExecutions: 0,
    failedNodeExecutions: 0,
    retriedNodeExecutions: 0,
    timedOutNodeExecutions: 0,
    verificationFailures: 0,
    staleLeasesRecovered: 0,
  };

  public static getInstance(): ExecutionObservabilityService {
    if (!ExecutionObservabilityService.instance) {
      ExecutionObservabilityService.instance = new ExecutionObservabilityService();
    }
    return ExecutionObservabilityService.instance;
  }

  logEvent(payload: ExecutionEventPayload): void {
    const sanitizedDetails = payload.details ? redactSensitiveData(payload.details) : undefined;
    const sanitizedPayload: ExecutionEventPayload = {
      ...payload,
      details: sanitizedDetails as Record<string, unknown> | undefined,
    };

    this.updateMetrics(payload.event);

    this.recentEvents.push(sanitizedPayload);
    if (this.recentEvents.length > 500) {
      this.recentEvents.shift();
    }

    logger.info(
      {
        event: payload.event,
        timestamp: payload.timestamp,
        requestId: payload.requestId,
        taskId: payload.taskId,
        graphId: payload.graphId,
        revisionId: payload.revisionId,
        nodeId: payload.nodeId,
        executionId: payload.executionId,
        attempt: payload.attempt,
        details: sanitizedDetails,
      },
      payload.event,
    );
  }

  private updateMetrics(event: ExecutionEventName): void {
    switch (event) {
      case "EXECUTION_STARTED":
        this.metrics.totalExecutions++;
        break;
      case "GRAPH_COMPLETED":
        this.metrics.completedExecutions++;
        break;
      case "GRAPH_FAILED":
        this.metrics.failedExecutions++;
        break;
      case "EXECUTION_CANCELLED":
        this.metrics.cancelledExecutions++;
        break;
      case "NODE_STARTED":
        this.metrics.totalNodeExecutions++;
        break;
      case "NODE_COMPLETED":
        this.metrics.completedNodeExecutions++;
        break;
      case "NODE_FAILED":
        this.metrics.failedNodeExecutions++;
        break;
      case "NODE_RETRY_SCHEDULED":
        this.metrics.retriedNodeExecutions++;
        break;
      case "NODE_TIMEOUT":
        this.metrics.timedOutNodeExecutions++;
        break;
      case "NODE_VERIFICATION_COMPLETED":
        // Counted if failure in details
        break;
    }
  }

  recordVerificationFailure(): void {
    this.metrics.verificationFailures++;
  }

  recordStaleLeaseRecovery(): void {
    this.metrics.staleLeasesRecovered++;
  }

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  getRecentEvents(limit: number = 50): ExecutionEventPayload[] {
    return this.recentEvents.slice(-limit);
  }

  resetMetrics(): void {
    this.recentEvents.length = 0;
    Object.keys(this.metrics).forEach((k) => {
      (this.metrics as any)[k] = 0;
    });
  }
}

export const executionObservability = ExecutionObservabilityService.getInstance();
