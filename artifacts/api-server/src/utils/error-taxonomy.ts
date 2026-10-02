import crypto from "node:crypto";
import { logger } from "../lib/logger";

export type ErrorCategory = "capacity" | "quota" | "timeout" | "policy" | "unknown";

export interface TaxonomicalError {
  category: ErrorCategory;
  userMessage: string;
  referenceId: string;
}

const ERROR_MAP: Record<ErrorCategory, string> = {
  capacity: "The AI service is currently experiencing extremely high demand. We have logged this, and our adaptive routing will try to recover shortly.",
  quota: "You have reached your allocated usage limits for this feature. Please review your account tier settings.",
  timeout: "The request took longer than expected to complete. Please try submitting your request again.",
  policy: "This request cannot be fulfilled as it violates our safe-use or identification policies.",
  unknown: "A transient system issue occurred. We have logged the trace for our administrators to inspect.",
};

export function categorizeAndLogError(error: unknown): TaxonomicalError {
  const referenceId = `ERR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errLower = errorMessage.toLowerCase();

  let category: ErrorCategory = "unknown";

  if (
    errLower.includes("quota") ||
    errLower.includes("limit") ||
    errLower.includes("exhausted") ||
    errLower.includes("429")
  ) {
    category = "quota";
  } else if (
    errLower.includes("timeout") ||
    errLower.includes("deadline") ||
    errLower.includes("timed out")
  ) {
    category = "timeout";
  } else if (
    errLower.includes("capacity") ||
    errLower.includes("busy") ||
    errLower.includes("overloaded") ||
    errLower.includes("unavailable") ||
    errLower.includes("503")
  ) {
    category = "capacity";
  } else if (
    errLower.includes("policy") ||
    errLower.includes("safety") ||
    errLower.includes("blocked") ||
    errLower.includes("unauthorized") ||
    errLower.includes("forbidden") ||
    errLower.includes("leak")
  ) {
    category = "policy";
  }

  // Log full server-side trace with the Reference ID
  logger.error(
    { referenceId, category, error: error instanceof Error ? { message: error.message, stack: error.stack } : error },
    `Taxonomical Error [${category.toUpperCase()}]: ${errorMessage}`
  );

  return {
    category,
    userMessage: `${ERROR_MAP[category]} (Reference ID: ${referenceId})`,
    referenceId,
  };
}
