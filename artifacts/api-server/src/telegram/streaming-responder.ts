import type { Context } from "grammy";
import { AdaptiveEngineService } from "../services/adaptive-engine.service";
import { safeErrorMetadata } from "../utils/safe-error";
import { formatTelegramMessage, stripTelegramHtml } from "../utils/telegram-formatter";
import { logger } from "../lib/logger";

export interface StreamingResponderOptions {
  placeholderText?: string;
}

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
    this.placeholderText = options.placeholderText ?? "💭 <i>Thinking...</i>";
  }

  /**
   * Sends the initial placeholder message that will be progressively updated.
   */
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

  /**
   * Feeds accumulated token text into the dynamic adaptive streaming engine.
   */
  async onChunk(accumulatedText: string): Promise<void> {
    if (this.isFinalized || !this.messageId) return;

    this.latestText = accumulatedText;
    const now = Date.now();
    const elapsedSinceStart = Math.max(1, (now - (this.streamStartTime || now)) / 1000);
    const velocityCharsPerSec = Math.round(accumulatedText.length / elapsedSinceStart);

    // Compute dynamic adaptive throttle interval
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

  /**
   * Finalizes the streaming response with semantic HTML-aware splitting and formatting.
   */
  async finalize(fullText: string): Promise<void> {
    this.isFinalized = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }

    this.latestText = fullText.trim();
    const rawChunks = AdaptiveEngineService.computeAdaptiveMessageSplit(this.latestText);
    const chunks = rawChunks.map(chunk => formatTelegramMessage(chunk));

    if (!this.messageId) {
      // If initial placeholder failed, send standard split messages
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
      // Fallback without HTML if parsing fails
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

    // If response was larger than single Telegram message, send remaining semantic chunks
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

    // Prepare adaptive preview snippet
    const rawSnippet = isFinal
      ? this.latestText
      : `${this.latestText.slice(0, 3800)} ▍`;

    if (!rawSnippet.trim()) {
      this.isFlushInProgress = false;
      return;
    }

    const formattedSnippet = formatTelegramMessage(rawSnippet);

    try {
      await this.ctx.api.editMessageText(
        this.ctx.chat.id,
        this.messageId,
        formattedSnippet,
        { parse_mode: "HTML" },
      );
    } catch (err: unknown) {
      const errMsg = String(err);
      if (
        errMsg.includes("message is not modified") ||
        errMsg.includes("MESSAGE_NOT_MODIFIED")
      ) {
        // Safe no-op
      } else {
        // If HTML fails during mid-stream unclosed tags, retry with stripped plain text
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
