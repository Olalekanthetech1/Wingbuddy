import { OutputGuardService, type GuardEvaluationResult } from "../output-guard.service";
import { logger } from "../../lib/logger";

export interface StreamingTransportAdapter {
  onStart?(): Promise<void>;
  onDelta(safeDelta: string, releasedTotal: string): Promise<void>;
  onFinal(fullText: string): Promise<void>;
  onInterrupted?(noticeText: string, referenceId?: string): Promise<void>;
}

export interface UnifiedResponderOptions {
  userQuery: string;
  staticInternalRules?: string;
  holdBackTarget?: number;
  transport: StreamingTransportAdapter;
}

export class UnifiedStreamingResponder {
  private accumulatedText = "";
  private releasedText = "";
  private isInterrupted = false;
  private hardBlockResult: GuardEvaluationResult | null = null;
  private readonly holdBackTarget: number;
  private readonly userQuery: string;
  private readonly staticInternalRules?: string;
  private readonly transport: StreamingTransportAdapter;

  constructor(options: UnifiedResponderOptions) {
    this.userQuery = options.userQuery;
    this.staticInternalRules = options.staticInternalRules;
    this.holdBackTarget = options.holdBackTarget ?? OutputGuardService.HOLD_BACK_TARGET;
    this.transport = options.transport;
  }

  public async init(): Promise<void> {
    if (this.transport.onStart) {
      await this.transport.onStart();
    }
  }

  /**
   * Processes an incoming streaming delta.
   * Scans accumulated text for secrets across chunk boundaries.
   * Buffers the trailing hold-back window so no unverified secrets are emitted.
   */
  public async onChunk(delta: string): Promise<{ shouldHalt: boolean; guardResult?: GuardEvaluationResult }> {
    if (this.isInterrupted) {
      return { shouldHalt: true, guardResult: this.hardBlockResult || undefined };
    }

    this.accumulatedText += delta;

    // Scan accumulated buffer for hard secrets
    const guardResult = OutputGuardService.detectLeak({
      response: this.accumulatedText,
      staticInternalRules: this.staticInternalRules,
      userQuery: this.userQuery,
    });

    if (guardResult.isHardBlock) {
      this.isInterrupted = true;
      this.hardBlockResult = guardResult;
      logger.warn(
        { ruleId: guardResult.ruleId, referenceId: guardResult.referenceId },
        "UnifiedStreamingResponder: hard security block tripped. Withholding unreleased buffer.",
      );
      return { shouldHalt: true, guardResult };
    }

    // Release verified text up to word boundary leaving ~holdBackTarget characters
    if (this.accumulatedText.length - this.releasedText.length > this.holdBackTarget) {
      const candidateEnd = this.accumulatedText.length - this.holdBackTarget;
      const lastSpace = this.accumulatedText.lastIndexOf(" ", candidateEnd);
      const lastNewline = this.accumulatedText.lastIndexOf("\n", candidateEnd);
      const boundary = Math.max(lastSpace, lastNewline);
      const releaseUpTo = boundary > this.releasedText.length ? boundary + 1 : candidateEnd;

      if (releaseUpTo > this.releasedText.length) {
        const safeDelta = this.accumulatedText.slice(this.releasedText.length, releaseUpTo);
        this.releasedText += safeDelta;
        await this.transport.onDelta(safeDelta, this.releasedText);
      }
    }

    return { shouldHalt: false };
  }

  /**
   * Finalizes the stream and flushes all remaining buffered text to the transport.
   */
  public async finalize(): Promise<string> {
    if (this.isInterrupted) {
      const notice = "That reply was interrupted. Would you like to retry?";
      if (this.transport.onInterrupted) {
        await this.transport.onInterrupted(notice, this.hardBlockResult?.referenceId);
      }
      return notice;
    }

    // Flush any remaining characters held back in the buffer
    if (this.accumulatedText.length > this.releasedText.length) {
      const finalDelta = this.accumulatedText.slice(this.releasedText.length);
      this.releasedText = this.accumulatedText;
      await this.transport.onDelta(finalDelta, this.releasedText);
    }

    await this.transport.onFinal(this.accumulatedText);
    return this.accumulatedText;
  }

  /**
   * Handles an interruption (upstream failure or guard block).
   */
  public async fail(noticeText = "That reply was interrupted. Would you like to retry?", referenceId?: string): Promise<void> {
    this.isInterrupted = true;
    if (this.transport.onInterrupted) {
      await this.transport.onInterrupted(noticeText, referenceId || this.hardBlockResult?.referenceId);
    }
  }

  public getAccumulatedText(): string {
    return this.accumulatedText;
  }

  public getReleasedText(): string {
    return this.releasedText;
  }

  public isStreamInterrupted(): boolean {
    return this.isInterrupted;
  }
}
