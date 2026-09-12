import type {
  ExecutionError,
  ExecutionErrorCategory,
  GraphNode,
  NodeRetryPolicy,
  ExecutionTransition
} from "../../planner/types";

export class RetryEngine {
  private static readonly MAX_BACKOFF_MS = 30_000;
  private static readonly BASE_BACKOFF_MS = 1000;

  /**
   * Classifies an unknown error into a structured ExecutionError with retryability.
   */
  classifyError(err: unknown): ExecutionError {
    if (err && typeof err === "object" && "category" in err && "code" in err) {
      return err as ExecutionError;
    }
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    // 1. Timeout
    if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("deadline exceeded")) {
      return {
        code: "EXECUTION_TIMEOUT",
        message,
        retryable: true,
        category: "timeout",
      };
    }

    // 2. Rate Limit
    if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
      return {
        code: "RATE_LIMITED",
        message,
        retryable: true,
        category: "rate_limit",
      };
    }

    // 3. Transient Network / Provider
    if (
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("network") ||
      lower.includes("503") ||
      lower.includes("service unavailable") ||
      lower.includes("bad gateway")
    ) {
      return {
        code: "NETWORK_OR_PROVIDER_ERROR",
        message,
        retryable: true,
        category: lower.includes("503") ? "provider" : "network",
      };
    }

    // 4. Authorization / Authentication (Non-retryable)
    if (
      lower.includes("unauthorized") ||
      lower.includes("forbidden") ||
      lower.includes("capability") ||
      lower.includes("permission denied") ||
      lower.includes("approval")
    ) {
      return {
        code: "AUTHORIZATION_FAILURE",
        message,
        retryable: false,
        category: "authorization",
      };
    }

    // 5. Validation / Parameter error (Non-retryable)
    if (
      lower.includes("invalid") ||
      lower.includes("schema") ||
      lower.includes("binding") ||
      lower.includes("missing required") ||
      lower.includes("not found")
    ) {
      return {
        code: "VALIDATION_FAILURE",
        message,
        retryable: false,
        category: "validation",
      };
    }

    // Fallback: unknown
    return {
      code: "UNKNOWN_EXECUTION_ERROR",
      message,
      retryable: false,
      category: "unknown",
    };
  }

  /**
   * Evaluates a failed node attempt and transitions execution explicitly.
   */
  evaluateTransition(params: {
    node: GraphNode;
    currentAttempt: number;
    error: ExecutionError;
    isDestructiveTool?: boolean;
    hasSideEffect?: boolean;
    isCancelled?: boolean;
  }): ExecutionTransition {
    const { node, currentAttempt, error, isDestructiveTool, hasSideEffect, isCancelled } = params;

    // Rule 1: No retry if graph is cancelled
    if (isCancelled) {
      return { type: "ABORT", reason: "Execution was cancelled." };
    }

    // Recoverable state? (Timeout/Transient errors on nodes with no side effects)
    if (!error.retryable) {
      // Replan if the error is due to something that might be fixed by different reasoning
      if (error.category === "validation" || error.category === "unknown") {
         return { type: "RECOVER", reason: `Attempting recovery for category "${error.category}".` };
      }
      return { type: "ABORT", reason: `Error category "${error.category}" is non-retryable.` };
    }

    // Rule 3: No automatic retries for destructive tools
    if (isDestructiveTool) {
      return { type: "ABORT", reason: "Automatic retries are disallowed for destructive tools without explicit policy." };
    }

    // Rule 4: Disallow blind retry for side-effecting external tools on timeout (Item 4)
    if (
      hasSideEffect &&
      (error.category === "timeout" || error.code === "TIMEOUT" || error.code === "EXECUTION_TIMEOUT")
    ) {
      return { type: "RECOVER", reason: "Automatic retries are disallowed for side-effecting external tools on timeout. Falling back to RECOVER." };
    }

    // Rule 5: Check retry budget
    const policy: NodeRetryPolicy = node.retryPolicy || { maxAttempts: 1, backoffMs: 1000 };
    const maxAttempts = Math.min(Math.max(1, policy.maxAttempts), 5);

    if (currentAttempt >= maxAttempts) {
      return { type: "REPLAN", reason: `Retry budget exhausted (${currentAttempt}/${maxAttempts} attempts). Triggering REPLAN.` };
    }

    // Calculate bounded backoff
    const baseBackoff = Math.max(100, policy.backoffMs || RetryEngine.BASE_BACKOFF_MS);
    const delayMs = Math.min(
      RetryEngine.MAX_BACKOFF_MS,
      baseBackoff * Math.pow(2, currentAttempt - 1),
    );

    return { type: "RETRY", attempt: currentAttempt + 1, delayMs, reason: "Retrying step." };
  }

  /**
   * Evaluates retry eligibility with boolean shouldRetry and delayMs, for test assertion compatibility.
   */
  evaluateRetry(params: {
    node: GraphNode;
    currentAttempt: number;
    error: ExecutionError;
    isDestructiveTool?: boolean;
    hasSideEffect?: boolean;
    isCancelled?: boolean;
  }): { shouldRetry: boolean; attempt?: number; delayMs?: number; reason: string } {
    const transition = this.evaluateTransition(params);
    if (transition.type === "RETRY") {
      return {
        shouldRetry: true,
        attempt: transition.attempt,
        delayMs: transition.delayMs,
        reason: transition.reason,
      };
    }
    return {
      shouldRetry: false,
      attempt: params.currentAttempt,
      reason: transition.reason,
    };
  }

  /**
   * Runs an asynchronous operation with strict runtime timeout via AbortController.
   */
  async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    operationName = "operation",
  ): Promise<T> {
    const boundedTimeout = Math.max(100, Math.min(timeoutMs, 300_000));
    const controller = new AbortController();

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(
          `Node execution timed out after ${boundedTimeout}ms for ${operationName}.`,
        );
        (err as any).category = "timeout";
        (err as any).code = "TIMEOUT";
        (err as any).retryable = true;
        reject(err);
      }, boundedTimeout);
    });

    try {
      return await Promise.race([operation(controller.signal), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const retryEngine = new RetryEngine();
