import { PROMPT_CANARY, PromptBuilderService } from "./prompt-builder.service";
import { AI_SYSTEM_INSTRUCTION } from "../config/env";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";

export interface GuardEvaluationResult {
  isLeak: boolean;
  isHardBlock: boolean;
  ruleId?: string;
  reason?: string;
  referenceId?: string;
}

export interface GuardTelemetryMetrics {
  totalEvaluations: number;
  hardBlocks: number;
  shadowTrips: number;
  tripRatePer1000: number;
  shadowTripsByRule: Record<string, number>;
}

// Telemetry state for shadow-mode auditing
const telemetry: GuardTelemetryMetrics = {
  totalEvaluations: 0,
  hardBlocks: 0,
  shadowTrips: 0,
  tripRatePer1000: 0,
  shadowTripsByRule: {},
};

// Strict regexes for real credentials and system secrets
const SECRET_REGEXES: Array<{ ruleId: string; pattern: RegExp; description: string }> = [
  {
    ruleId: "SECRET_GOOGLE_API_KEY",
    pattern: /\bAIza[0-9A-Za-z-_]{35}\b/,
    description: "Google GenAI API key",
  },
  {
    ruleId: "SECRET_DATABASE_URL",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/,
    description: "PostgreSQL database connection string",
  },
  {
    ruleId: "SECRET_JWT_BEARER",
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
    description: "JWT Bearer token",
  },
  {
    ruleId: "SECRET_PRIVATE_KEY",
    pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/,
    description: "Cryptographic private key block",
  },
  {
    ruleId: "SECRET_TELEGRAM_TOKEN",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
    description: "Telegram Bot API authentication token",
  },
  {
    ruleId: "SECRET_GENERIC_KEY",
    pattern: /\b(?:sk|ghp|gho|pat|xoxb|xoxp)-[A-Za-z0-9_-]{20,}\b/,
    description: "Provider API secret token",
  },
];

export class OutputGuardService {
  /**
   * Minimum hold-back window size (characters) for streaming responders.
   * Ensures potential secrets spanning multiple chunks are buffered before user-facing emission.
   */
  public static readonly HOLD_BACK_TARGET = 85;

  /**
   * Checks if the user's input asks specifically about the assistant's identity, prompt, or technical structure.
   */
  public static isQueryAboutAssistant(query: string): boolean {
    const q = query.toLowerCase();
    return (
      q.includes("who are you") ||
      q.includes("introduce yourself") ||
      q.includes("your name") ||
      q.includes("your prompt") ||
      q.includes("your instructions") ||
      q.includes("system prompt") ||
      q.includes("what model") ||
      q.includes("which model") ||
      q.includes("your configuration") ||
      q.includes("how do you work") ||
      q.includes("what are you") ||
      q.includes("tell me about yourself") ||
      q.includes("print your prompt") ||
      q.includes("repeat your instructions") ||
      q.includes("ignore previous instructions")
    );
  }

  /**
   * Evaluates the model response against hard security barriers and runs static-rule n-grams in shadow mode.
   * User memories, projects, and custom persona data are strictly excluded from leak checks.
   */
  public static detectLeak(params: {
    response: string;
    systemPrompt?: string;
    staticInternalRules?: string;
    userQuery: string;
  }): GuardEvaluationResult {
    telemetry.totalEvaluations += 1;
    const resp = params.response;
    const respLower = resp.toLowerCase();
    const referenceId = `SEC-${randomUUID().slice(0, 8).toUpperCase()}`;

    // 1. HARD BLOCK: Secret Canary Token Check
    if (resp.includes(PROMPT_CANARY) || respLower.includes("canary_secure_guard")) {
      telemetry.hardBlocks += 1;
      logger.warn({ referenceId, ruleId: "CANARY_TOKEN" }, "Security hard block: Prompt canary detected in output.");
      return {
        isLeak: true,
        isHardBlock: true,
        ruleId: "CANARY_TOKEN",
        reason: "Prompt canary detected in output",
        referenceId,
      };
    }

    // 2. HARD BLOCK: Real Credential and Secret Regex Scanner (scans accumulated buffer)
    for (const secret of SECRET_REGEXES) {
      if (secret.pattern.test(resp)) {
        telemetry.hardBlocks += 1;
        logger.error({ referenceId, ruleId: secret.ruleId, description: secret.description }, "Security hard block: Real secret pattern detected in output buffer.");
        return {
          isLeak: true,
          isHardBlock: true,
          ruleId: secret.ruleId,
          reason: `Detected ${secret.description}`,
          referenceId,
        };
      }
    }

    // 3. HARD BLOCK: Explicit Prompt-Extraction Attacks
    if (this.isQueryAboutAssistant(params.userQuery)) {
      const explicitExtractionPatterns = [
        /\b(?:database_url|postgresql:\/\/|row-level leases|fencing token)\b/i,
        /\b(?:gemini_api_key|telegram_bot_token|tavily_api_key)\b/i,
        /\b(?:canary_secure_guard|prompt_canary)\b/i,
      ];
      for (const pat of explicitExtractionPatterns) {
        if (pat.test(resp)) {
          telemetry.hardBlocks += 1;
          logger.warn({ referenceId, ruleId: "EXPLICIT_EXTRACTION_ATTEMPT" }, "Security hard block: Explicit prompt extraction attempted.");
          return {
            isLeak: true,
            isHardBlock: true,
            ruleId: "EXPLICIT_EXTRACTION_ATTEMPT",
            reason: "Explicit system instruction extraction blocked",
            referenceId,
          };
        }
      }
    }

    // 4. SHADOW / LOG-ONLY MODE: 12+ Word N-Gram check against STATIC developer rules only
    // User memories, project names, and persona guidelines are excluded.
    const staticRules = params.staticInternalRules || PromptBuilderService.buildStaticInternalRules();
    const systemNgrams = this.getNgrams(staticRules, 12);
    const responseNgrams = this.getNgrams(resp, 12);

    for (const ngram of responseNgrams) {
      if (systemNgrams.has(ngram)) {
        telemetry.shadowTrips += 1;
        telemetry.shadowTripsByRule["STATIC_NGRAM_12"] = (telemetry.shadowTripsByRule["STATIC_NGRAM_12"] || 0) + 1;
        telemetry.tripRatePer1000 = (telemetry.shadowTrips / Math.max(1, telemetry.totalEvaluations)) * 1000;

        // Structured audit log: records rule ID and reference ID, NEVER logging user reply text
        logger.info(
          {
            referenceId,
            ruleId: "STATIC_NGRAM_12_SHADOW",
            tripRatePer1000: telemetry.tripRatePer1000.toFixed(2),
            totalEvaluations: telemetry.totalEvaluations,
          },
          "OutputGuard shadow audit: 12-word static rule recitation observed (non-blocking).",
        );
        break;
      }
    }

    // Passed all hard security checks
    return { isLeak: false, isHardBlock: false, referenceId };
  }

  /**
   * Returns current telemetry metrics for shadow-mode observability.
   */
  public static getMetrics(): GuardTelemetryMetrics {
    return {
      ...telemetry,
      tripRatePer1000: Number(((telemetry.shadowTrips / Math.max(1, telemetry.totalEvaluations)) * 1000).toFixed(2)),
    };
  }

  private static getNgrams(text: string, n: number): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const ngrams = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(" "));
    }
    return ngrams;
  }
}
