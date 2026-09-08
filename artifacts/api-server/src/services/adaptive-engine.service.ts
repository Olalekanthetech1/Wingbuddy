import { apiKeyPoolService } from "./api-key-pool.service";
import type { ModeKey } from "../config/mode";
import type { Message } from "@workspace/db";

export interface AdaptiveHistoryOptions {
  mode?: ModeKey;
  currentMessage?: string;
  memoriesCount?: number;
  semanticRecallCount?: number;
  availableMessages?: Array<{ role: string; content: string } | Message>;
}

export interface AdaptiveTimeoutOptions {
  prompt?: string;
  enableSearch?: boolean;
  isDeepReasoning?: boolean;
  isMediaGeneration?: boolean;
  isMultimodal?: boolean;
  hasAudio?: boolean;
  hasVisionOrDocument?: boolean;
  mediaSizeBytes?: number;
  targetKeyId?: string;
}

export class AdaptiveEngineService {
  // =========================================================================
  // 1. ADAPTIVE HISTORY WINDOW BUDGETER (Replaces fixed 20 messages)
  // =========================================================================
  /**
   * Dynamically calculates the optimal number of past messages to include in Gemini's context.
   * Instead of a static/hardcoded number, it dynamically adapts based on:
   * - Message character length & estimated token density
   * - Active assistant mode (coding/reasoning need deeper history; concise needs less)
   * - Injected memory load (semantic recall & profile memories)
   */
  static computeAdaptiveHistoryLimit(options: AdaptiveHistoryOptions = {}): number {
    const {
      mode = "general",
      currentMessage = "",
      memoriesCount = 0,
      semanticRecallCount = 0,
      availableMessages = [],
    } = options;

    // 1. Base dynamic starting window based on mode
    let baseLimit = 25;
    if (mode === "coder" || mode === "architect" || mode === "reasoning" || mode === "tutor") {
      baseLimit = 40; // Needs broad multi-turn code/context tracking
    } else if (mode === "concise" || mode === "casual") {
      baseLimit = 16; // Snappy, short context focus
    } else if (mode === "creative" || mode === "storyteller") {
      baseLimit = 35; // Creative continuity
    }

    // 2. Adjust for incoming prompt complexity
    if (currentMessage.length > 1000) {
      // Long input prompt: trim older history slightly to keep total request tight
      baseLimit = Math.max(12, Math.round(baseLimit * 0.75));
    } else if (currentMessage.length < 50) {
      // Very short follow-up (e.g. "what else?", "continue"): expand history to provide context
      baseLimit = Math.min(50, Math.round(baseLimit * 1.3));
    }

    // 3. Adjust for existing message density if messages are available
    if (availableMessages.length > 0) {
      const sample = availableMessages.slice(-10);
      const totalChars = sample.reduce((acc, m) => acc + (m.content?.length || 0), 0);
      const avgChars = totalChars / Math.max(1, sample.length);

      if (avgChars > 600) {
        // High density (e.g. code blocks or long explanations): scale down to avoid token bloat
        baseLimit = Math.max(10, Math.min(baseLimit, 18));
      } else if (avgChars < 120) {
        // Quick short chat messages: safely allow up to 45-50 messages
        baseLimit = Math.min(50, Math.max(baseLimit, 35));
      }
    }

    // 4. Memory load balance: if RAG recall + profile memories are rich, balance dialogue slice
    const memoryLoad = memoriesCount + semanticRecallCount;
    if (memoryLoad > 10) {
      baseLimit = Math.max(12, baseLimit - 4);
    }

    return Math.max(8, Math.min(60, Math.round(baseLimit)));
  }

  // =========================================================================
  // 2. ADAPTIVE TIMEOUT CALCULATOR (Replaces fixed 45000 ms)
  // =========================================================================
  /**
   * Dynamically calculates the request timeout in milliseconds for Gemini calls.
   * Instead of a hardcoded 45,000ms for every request, it adapts based on:
   * - Task complexity (Search Grounding, Deep Reasoning, Media Generation)
   * - Estimated prompt length & token generation depth
   * - Rolling historical latency metrics from the active key pool
   */
  static computeAdaptiveTimeout(options: AdaptiveTimeoutOptions = {}): number {
    const {
      prompt = "",
      enableSearch = false,
      isDeepReasoning = false,
      isMediaGeneration = false,
      isMultimodal = false,
      hasAudio = false,
      hasVisionOrDocument = false,
      mediaSizeBytes = 0,
      targetKeyId,
    } = options;

    // 1. Base latency baseline
    let timeoutMs = 15_000; // 15 seconds baseline for normal short chat

    // 2. Add complexity factors
    if (enableSearch) {
      timeoutMs += 12_000; // Search grounding queries require live external indexing
    }

    if (isDeepReasoning) {
      timeoutMs += 18_000; // Multi-step reasoning / code generation
    }

    if (isMediaGeneration) {
      timeoutMs += 30_000; // Multimodal rendering takes longer
    }

    if (isMultimodal || hasAudio || hasVisionOrDocument) {
      timeoutMs += 22_000; // Ingestion and audio waveform/visual token processing
      if (mediaSizeBytes > 500_000) {
        // Dynamically scale extra seconds for larger media files (up to +20s)
        const extraSecs = Math.min(20_000, Math.floor(mediaSizeBytes / 500_000) * 1500);
        timeoutMs += extraSecs;
      }
    }

    // 3. Prompt length scaling (1 extra second per 1000 characters)
    const promptLen = prompt.length;
    if (promptLen > 500) {
      const extraSeconds = Math.min(15, Math.floor(promptLen / 1000) * 1000);
      timeoutMs += extraSeconds;
    }

    // 4. Adapt based on measured key pool latency if available
    try {
      const pool = apiKeyPoolService.getSummary();
      let avgLatency = 0;

      if (targetKeyId) {
        const key = pool.keys.find((k) => k.id === targetKeyId);
        if (key && key.avgLatencyMs) {
          avgLatency = key.avgLatencyMs;
        }
      }

      if (!avgLatency && pool.keys.length > 0) {
        const keysWithLatency = pool.keys.filter((k) => (k.avgLatencyMs || 0) > 0);
        if (keysWithLatency.length > 0) {
          avgLatency =
            keysWithLatency.reduce((sum, k) => sum + (k.avgLatencyMs || 0), 0) /
            keysWithLatency.length;
        }
      }

      // If average latency is known, ensure timeout is at least 3.5x average latency + 4s buffer
      if (avgLatency > 0) {
        const dynamicFloor = Math.round(avgLatency * 3.5) + 4000;
        timeoutMs = Math.max(timeoutMs, dynamicFloor);
      }
    } catch {
      // Fall back to computed timeoutMs
    }

    // Bound between 8 seconds minimum and 70 seconds maximum
    return Math.max(8_000, Math.min(70_000, Math.round(timeoutMs)));
  }

  // =========================================================================
  // 3. ADAPTIVE RATE LIMIT CALCULATOR (Replaces fixed 6 req / 60s)
  // =========================================================================
  /**
   * Computes dynamic rate limit capacity and window according to active key pool health.
   * - Automatically scales capacity up as more healthy keys are available in the pool
   * - Automatically applies backpressure if keys hit rate limits / cooldowns
   * - Provides dynamic burst headroom during smooth operation
   */
  static computeAdaptiveRateLimit(): {
    maxRequests: number;
    windowMs: number;
    healthyKeyCount: number;
    burstHeadroom: number;
  } {
    let healthyCount = 1;
    let inCooldownCount = 0;

    try {
      const summary = apiKeyPoolService.getSummary();
      healthyCount = Math.max(1, summary.healthyKeys || 1);
      inCooldownCount = summary.inCooldownKeys || 0;
    } catch {
      healthyCount = 1;
    }

    // Base: 8 requests per minute per healthy key
    const basePerKey = 8;
    let dynamicMax = basePerKey * healthyCount;

    // Burst headroom (allows +25% burst for interactive brainstorming)
    const burstHeadroom = Math.round(dynamicMax * 0.25);
    dynamicMax += burstHeadroom;

    // If some keys are currently cooling down from 429 errors, reduce slightly to avoid cascading
    if (inCooldownCount > 0) {
      dynamicMax = Math.max(4, dynamicMax - inCooldownCount * 3);
    }

    // Dynamic window: 60s default, tightens slightly to 45s if multi-key pool is active
    const dynamicWindowMs = healthyCount > 1 ? 50_000 : 60_000;

    return {
      maxRequests: Math.max(4, dynamicMax),
      windowMs: dynamicWindowMs,
      healthyKeyCount: healthyCount,
      burstHeadroom,
    };
  }

  // =========================================================================
  // 4. ADAPTIVE MODEL SELECTOR (Replaces static hardcoded model string)
  // =========================================================================
  /**
   * Dynamically selects the optimal Gemini model variant based on task intent:
   * - Fast Flash tier for quick conversational messages, greetings, and live search grounding
   * - Pro reasoning tier for deep multi-step logic, code generation, and complex math
   * - Lightweight fast tier for background semantic fact extraction
   * - Respects explicit GEMINI_MODEL overrides if configured by user
   */
  static computeAdaptiveModel(options: {
    mode?: ModeKey;
    prompt?: string;
    enableSearch?: boolean;
    isDeepReasoning?: boolean;
    isExtraction?: boolean;
    configuredModel?: string;
  } = {}): string {
    const {
      mode = "general",
      prompt = "",
      enableSearch = false,
      isDeepReasoning = false,
      isExtraction = false,
      configuredModel,
    } = options;

    // 1. If user explicitly provided a non-default custom model, respect it
    if (
      configuredModel &&
      configuredModel !== "auto" &&
      configuredModel !== "adaptive" &&
      configuredModel !== "dynamic" &&
      !configuredModel.includes("default")
    ) {
      return configuredModel;
    }

    // 2. Background JSON/Fact extraction uses fast responsive Flash tier
    if (isExtraction) {
      return "gemini-2.5-flash";
    }

    // 3. Deep code, mathematics, or explicit reasoning tasks adapt to Pro tier
    const isCodeOrMathPrompt =
      /\b(write code|implement|refactor|debug|algorithm|proof|solve equation|architect|dockerfile|kubernetes|regex)\b/i.test(
        prompt,
      );

    if (
      isDeepReasoning ||
      mode === "coder" ||
      mode === "architect" ||
      mode === "reasoning" ||
      isCodeOrMathPrompt
    ) {
      return "gemini-2.5-pro";
    }

    // 4. Web search grounding and general conversational chat adapt to fast, high-rate-limit Flash
    if (enableSearch || mode === "concise" || mode === "casual" || mode === "creative") {
      return "gemini-2.5-flash";
    }

    // 5. Default dynamic model
    return "gemini-2.5-flash";
  }

  // =========================================================================
  // 5. ADAPTIVE STREAMING THROTTLE CALCULATOR (Replaces static 550ms throttle)
  // =========================================================================
  /**
   * Dynamically calculates the optimal streaming update interval for Telegram editMessageText.
   * Adapts in real time to:
   * - Accumulated text length (starts fast ~280ms for instant feedback, then scales smoothly)
   * - Streaming velocity (chars/sec output by the model)
   * - Real-time Telegram API round-trip latency
   */
  static computeAdaptiveStreamingInterval(options: {
    characterLength: number;
    velocityCharsPerSec?: number;
    lastApiLatencyMs?: number;
  }): number {
    const { characterLength, velocityCharsPerSec = 0, lastApiLatencyMs = 0 } = options;

    // 1. Base progression curve: small initial bursts update faster for immediate feedback
    let intervalMs: number;
    if (characterLength < 80) {
      intervalMs = 280; // Instant initial snappy start
    } else if (characterLength < 350) {
      intervalMs = 400; // Early paragraph flow
    } else if (characterLength < 1200) {
      intervalMs = 550; // Standard balanced streaming
    } else {
      intervalMs = 750; // Extended message pace to conserve Telegram edit quota
    }

    // 2. Adjust for streaming velocity if rapid generation is occurring
    if (velocityCharsPerSec > 250) {
      // Very fast token generation: expand interval slightly to batch larger chunks
      intervalMs = Math.min(1000, Math.round(intervalMs * 1.25));
    } else if (velocityCharsPerSec > 0 && velocityCharsPerSec < 30) {
      // Slow token generation (e.g., deep thinking or heavy reasoning): update snappily
      intervalMs = Math.max(300, Math.round(intervalMs * 0.85));
    }

    // 3. Adjust for measured Telegram API round-trip latency
    if (lastApiLatencyMs > 0) {
      const latencyGuardedInterval = lastApiLatencyMs + 80;
      intervalMs = Math.max(intervalMs, latencyGuardedInterval);
    }

    // Telegram per-chat edit rate limit safety floor (250ms) and ceiling (1200ms)
    return Math.max(250, Math.min(1200, intervalMs));
  }

  // =========================================================================
  // 6. ADAPTIVE SEMANTIC MESSAGE SPLITTER (Replaces fixed 4000/4096 character cutoffs)
  // =========================================================================
  /**
   * Dynamically segments long text into natural semantic chunks while preserving
   * Markdown hierarchy, code fences, bullet lists, and sentence boundaries.
   */
  static computeAdaptiveMessageSplit(
    text: string,
    options: {
      maxLimit?: number;
      targetPreferredLength?: number;
    } = {},
  ): string[] {
    const raw = text.trim();
    if (!raw) return [];

    const maxLimit = options.maxLimit ?? 4096;
    if (raw.length <= maxLimit) return [raw];

    // Compute dynamic preferred slice target (leaving headroom for syntax auto-repair)
    const preferredTarget = options.targetPreferredLength ?? Math.min(maxLimit - 128, 3800);

    const chunks: string[] = [];
    let remaining = raw;
    let activeCodeFenceLang: string | null = null;

    while (remaining.length > 0) {
      if (remaining.length <= maxLimit) {
        // If an unclosed code fence is active, close it properly
        let finalChunk = remaining;
        if (activeCodeFenceLang !== null) {
          finalChunk = `\`\`\`${activeCodeFenceLang}\n${finalChunk}`;
        }
        chunks.push(finalChunk.trim());
        break;
      }

      // Find best semantic boundary within the preferred window
      const searchWindow = remaining.slice(0, maxLimit);
      let breakIndex = -1;

      // Priority 1: Markdown code block boundaries
      const codeFenceIndex = searchWindow.lastIndexOf("\n```");
      if (codeFenceIndex > preferredTarget * 0.5) {
        breakIndex = codeFenceIndex + 4;
      }

      // Priority 2: Markdown headers (# or ##)
      if (breakIndex === -1) {
        const headerMatch = searchWindow.match(/\n(#{1,4}\s+[^\n]+)/g);
        if (headerMatch) {
          const lastHeader = headerMatch[headerMatch.length - 1];
          const headerIdx = searchWindow.lastIndexOf(lastHeader);
          if (headerIdx > preferredTarget * 0.5) {
            breakIndex = headerIdx;
          }
        }
      }

      // Priority 3: Paragraph breaks (\n\n)
      if (breakIndex === -1) {
        const paragraphIdx = searchWindow.lastIndexOf("\n\n");
        if (paragraphIdx > preferredTarget * 0.5) {
          breakIndex = paragraphIdx;
        }
      }

      // Priority 4: Bullet lists or itemized lines (\n- , \n* , \n1. )
      if (breakIndex === -1) {
        const listMatch = searchWindow.match(/\n(?:\d+\.|\*|-|•)\s+/g);
        if (listMatch) {
          const lastList = listMatch[listMatch.length - 1];
          const listIdx = searchWindow.lastIndexOf(lastList);
          if (listIdx > preferredTarget * 0.55) {
            breakIndex = listIdx;
          }
        }
      }

      // Priority 5: Single line breaks
      if (breakIndex === -1) {
        const newlineIdx = searchWindow.lastIndexOf("\n");
        if (newlineIdx > preferredTarget * 0.6) {
          breakIndex = newlineIdx;
        }
      }

      // Priority 6: Sentence terminators (. ! ?)
      if (breakIndex === -1) {
        const sentenceMatch = searchWindow.match(/[.!?]\s+/g);
        if (sentenceMatch) {
          const lastSentence = sentenceMatch[sentenceMatch.length - 1];
          const sentenceIdx = searchWindow.lastIndexOf(lastSentence);
          if (sentenceIdx > preferredTarget * 0.65) {
            breakIndex = sentenceIdx + 1;
          }
        }
      }

      // Priority 7: Word space
      if (breakIndex === -1) {
        const spaceIdx = searchWindow.lastIndexOf(" ");
        if (spaceIdx > preferredTarget * 0.5) {
          breakIndex = spaceIdx;
        } else {
          breakIndex = maxLimit;
        }
      }

      let currentChunk = remaining.slice(0, breakIndex).trim();

      // Check if this chunk has an unclosed code block
      const codeFenceCount = (currentChunk.match(/```/g) || []).length;
      const isInsideCodeBlock = codeFenceCount % 2 !== 0;

      if (isInsideCodeBlock) {
        // Extract the language of the active code block if available
        const langMatch = currentChunk.match(/```(\w+)?/);
        activeCodeFenceLang = langMatch?.[1] || "";
        currentChunk = `${currentChunk}\n\`\`\``;
      } else {
        activeCodeFenceLang = null;
      }

      // Balance open Telegram HTML tags (<b>, <i>, <s>, <u>, <code>, <pre>)
      const openHtmlTagsStack: string[] = [];
      const tagRegex = /<\/?(b|i|s|u|code|pre)\b[^>]*>/gi;
      const tagMatches = [...currentChunk.matchAll(tagRegex)];
      for (const m of tagMatches) {
        const fullTag = m[0];
        const tagName = m[1].toLowerCase();
        if (fullTag.startsWith("</")) {
          const idx = openHtmlTagsStack.lastIndexOf(tagName);
          if (idx !== -1) openHtmlTagsStack.splice(idx, 1);
        } else {
          openHtmlTagsStack.push(tagName);
        }
      }

      if (openHtmlTagsStack.length > 0) {
        const closingTags = openHtmlTagsStack.slice().reverse().map((t) => `</${t}>`).join("");
        currentChunk = currentChunk + closingTags;
      }

      chunks.push(currentChunk);
      remaining = remaining.slice(breakIndex).trim();
      if (activeCodeFenceLang !== null && remaining.length > 0 && !remaining.startsWith("```")) {
        remaining = `\`\`\`${activeCodeFenceLang}\n${remaining}`;
      } else if (openHtmlTagsStack.length > 0 && remaining.length > 0) {
        const openingTags = openHtmlTagsStack.map((t) => `<${t}>`).join("");
        remaining = `${openingTags}${remaining}`;
      }
    }

    return chunks;
  }
}

