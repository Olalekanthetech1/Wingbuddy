import type { Context } from "grammy";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { safeErrorMetadata } from "../utils/safe-error";
import { formatTelegramMessage, stripTelegramHtml } from "../utils/telegram-formatter";
import { logger } from "../lib/logger";
import {
  interactionPresentationService,
  type InteractionRuntimeEvent,
} from "./interaction-presentation.service";

export interface StreamingResponderOptions {
  /**
   * Deprecated compatibility escape hatch. New callers should provide a
   * presentationEvent so the visible placeholder is derived from runtime
   * state rather than a hard-coded task label.
   */
  placeholderText?: string;
  presentationEvent?: InteractionRuntimeEvent;
}

const DEFAULT_STREAM_PLACEHOLDER = "…";

export class StreamingResponder {
  private lastEditTime = 0;
  private pendingTimer?: NodeJS.Timeout;
  private latestText = "";
  private isFinalized = false;
  private messageId?: number;
  private readonly placeholderText: string;
  private streamStartTime = 0;
  private lastApiLatencyMs = 0;
  private isFlushInProgress = false;

  constructor(
    private readonly ctx: Context,
    options: StreamingResponderOptions = {},
  ) {
    const runtimePlaceholder = options.presentationEvent
      ? interactionPresentationService.decide(options.presentationEvent).visibleProgressText
      : undefined;

    // Runtime presentation is authoritative. The legacy placeholder is retained
    // only for backwards compatibility; the neutral fallback remains "…".
    this.placeholderText = runtimePlaceholder ?? options.placeholderText ?? DEFAULT_STREAM_PLACEHOLDER;
  }

  async init(): Promise<number | undefined> {
    try {
      this.streamStartTime = Date.now();
      const sent = await this.ctx.reply(this.placeholderText, {
        parse_mode: "HTML",
      });
      this.messageId = sent.message_id;
      this.lastEditTime = Date.now();
      return this.messageId;
    } catch (err) {
      logger.warn(
        { error: safeErrorMetadata(err) },
        "Could not send initial streaming placeholder; will send single message on finish",
      );
      return undefined;
    }
  }

  async onChunk(accumulatedText: string): Promise<void> {
    if (this.isFinalized || !this.messageId) return;

    this.latestText = accumulatedText;
    const now = Date.now();
    const elapsedSinceStart = Math.max(1, (now - (this.streamStartTime || now)) / 1000);
    const velocityCharsPerSec = Math.round(accumulatedText.length / elapsedSinceStart);

    const dynamicIntervalMs = AdaptiveEngineService.computeAdaptiveStreamingInterval({
      characterLength: accumulatedText.length,
      velocityCharsPerSec,
      lastApiLatencyMs: this.lastApiLatencyMs,
    });

    const elapsed = now - this.lastEditTime;

    if (elapsed >= dynamicIntervalMs && !this.isFlushInProgress) {
      this.lastEditTime = now;
      await this.flushEdit(false);
    } else if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = undefined;
        if (!this.isFinalized && !this.isFlushInProgress) {
          this.lastEditTime = Date.now();
          void this.flushEdit(false);
        }
      }, Math.max(50, dynamicIntervalMs - elapsed));
    }
  }

  async finalize(fullText: string): Promise<void> {
    this.isFinalized = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }

    this.latestText = fullText.trim();
    const rawChunks = AdaptiveEngineService.computeAdaptiveMessageSplit(this.latestText);
    const chunks = rawChunks.map((chunk, idx) => formatTelegramMessage(chunk, {
      telegramUserId: this.ctx.from?.id,
      chunkIndex: idx,
      source: "StreamingResponder.finalize",
    }));

    if (!this.messageId) {
      for (const chunk of chunks) {
        await this.ctx.reply(chunk, { parse_mode: "HTML" }).catch(async () => {
          await this.ctx.reply(stripTelegramHtml(chunk));
        });
      }
      return;
    }

    const firstChunk = chunks[0] || "...";

    try {
      await this.ctx.api.editMessageText(
        this.ctx.chat!.id,
        this.messageId,
        firstChunk,
        { parse_mode: "HTML" },
      );
    } catch {
      try {
        await this.ctx.api.editMessageText(
          this.ctx.chat!.id,
          this.messageId,
          stripTelegramHtml(firstChunk),
        );
      } catch (e) {
        logger.debug({ error: safeErrorMetadata(e) }, "Final edit error (safe to ignore)");
      }
    }

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      await this.ctx.reply(chunk, { parse_mode: "HTML" }).catch(async () => {
        await this.ctx.reply(stripTelegramHtml(chunk));
      });
    }
  }

  private async flushEdit(isFinal: boolean): Promise<void> {
    if (!this.messageId || !this.ctx.chat || this.isFlushInProgress) return;

    this.isFlushInProgress = true;
    const startCall = Date.now();

    const rawSnippet = isFinal
      ? this.latestText
      : `${this.latestText.slice(0, 3800)} ▍`;

    if (!rawSnippet.trim()) {
      this.isFlushInProgress = false;
      return;
    }

    const formattedSnippet = formatTelegramMessage(rawSnippet, {
      telegramUserId: this.ctx.from?.id,
      source: `StreamingResponder.flushEdit(isFinal=${isFinal})`,
      isStreaming: !isFinal,
    });

    try {
      await this.ctx.api.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        formattedSnippet,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      const errMsg = String(err);
      if (
        errMsg.includes("message is not modified") ||
        errMsg.includes("MESSAGE_NOT_MODIFIED")
      ) {
        // Safe no-op
      } else {
        try {
          await this.ctx.api.editMessageText(
            this.ctx.chat.id,
            this.messageId,
            stripTelegramHtml(formattedSnippet),
          );
        } catch {
          // Ignore transient stream throttle rejections
        }
      }
    } finally {
      this.lastApiLatencyMs = Date.now() - startCall;
      this.isFlushInProgress = false;
    }
  }
}
