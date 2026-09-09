import type { Context } from "grammy";

export type InteractionProgressState =
  | "received"
  | "understanding"
  | "retrieving_context"
  | "searching"
  | "executing_tool"
  | "reasoning"
  | "generating"
  | "verifying"
  | "finalizing"
  | "completed"
  | "failed";

export type InteractionChatAction =
  | "typing"
  | "upload_photo"
  | "upload_video"
  | "upload_document"
  | "record_voice"
  | "record_video";

export interface InteractionRuntimeEvent {
  state: InteractionProgressState;
  toolName?: string | null;
  operationLabel?: string | null;
  chatAction?: InteractionChatAction | null;
  reaction?: string | null;
  expectsLongRunning?: boolean;
  userFacingProgress?: boolean;
  elapsedMs?: number;
}

export interface InteractionPresentationDecision {
  reaction?: string;
  chatAction?: InteractionChatAction;
  visibleProgressText?: string;
}

export interface InteractionPresentationHints extends Partial<InteractionRuntimeEvent> {}

const STATE_LABELS: Readonly<Record<InteractionProgressState, string>> = {
  received: "Starting",
  understanding: "Understanding",
  retrieving_context: "Loading context",
  searching: "Searching",
  executing_tool: "Running tool",
  reasoning: "Working through it",
  generating: "Generating",
  verifying: "Checking the result",
  finalizing: "Finishing",
  completed: "Completed",
  failed: "Unable to complete",
};

/**
 * Presentation policy consumes trusted runtime metadata only. It never
 * interprets user vocabulary or performs intent detection.
 */
export class InteractionPresentationService {
  private readonly refreshMs: number;
  private readonly defaultReaction: string;

  constructor(options?: { refreshMs?: number; defaultReaction?: string }) {
    this.refreshMs = Math.max(1_000, options?.refreshMs ?? 4_000);
    this.defaultReaction = options?.defaultReaction ?? "👀";
  }

  decide(event: InteractionRuntimeEvent): InteractionPresentationDecision {
    if (event.state === "completed" || event.state === "failed") return {};

    const decision: InteractionPresentationDecision = {
      reaction:
        event.reaction === null
          ? undefined
          : event.reaction ?? this.defaultReaction,
      chatAction:
        event.chatAction === null
          ? undefined
          : event.chatAction ?? this.defaultChatAction(event),
    };

    if (event.userFacingProgress) {
      decision.visibleProgressText = this.progressText(event);
    }

    return decision;
  }

  acknowledge(ctx: Context, hints: InteractionPresentationHints = {}): void {
    const decision = this.decide({
      state: "received",
      ...hints,
    });

    if (decision.reaction) {
      void ctx.react(decision.reaction).catch(() => undefined);
    }
    this.sendChatAction(ctx, decision.chatAction);
  }

  startPresence(ctx: Context, hints: InteractionPresentationHints = {}): () => void {
    const decision = this.decide({
      state: "generating",
      ...hints,
    });
    let stopped = false;

    const send = (): void => {
      if (stopped) return;
      this.sendChatAction(ctx, decision.chatAction);
    };

    send();
    const timer = setInterval(send, this.refreshMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async renderProgress(
    ctx: Context,
    event: InteractionRuntimeEvent,
    progressMessageId?: number,
  ): Promise<number | undefined> {
    const decision = this.decide(event);
    if (!decision.visibleProgressText || !event.userFacingProgress) {
      return progressMessageId;
    }

    try {
      if (progressMessageId) {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          progressMessageId,
          decision.visibleProgressText,
        );
        return progressMessageId;
      }

      if (!ctx.chat) return undefined;
      const message = await ctx.reply(decision.visibleProgressText);
      return message.message_id;
    } catch {
      return progressMessageId;
    }
  }

  private progressText(event: InteractionRuntimeEvent): string {
    const stateLabel = STATE_LABELS[event.state];
    const subject = event.operationLabel?.trim() || event.toolName?.trim();

    if (subject) {
      return `${stateLabel}: ${subject}${this.latencySuffix(event)}`;
    }

    return `${stateLabel}${this.latencySuffix(event)}…`;
  }

  private latencySuffix(event: InteractionRuntimeEvent): string {
    const elapsedMs = event.elapsedMs ?? 0;
    if (!event.expectsLongRunning || elapsedMs < 8_000) return "";
    const seconds = Math.round(elapsedMs / 1_000);
    return ` (${seconds}s)`;
  }

  private defaultChatAction(event: InteractionRuntimeEvent): InteractionChatAction {
    switch (event.state) {
      case "executing_tool":
      case "searching":
      case "retrieving_context":
      case "reasoning":
      case "generating":
      case "verifying":
      case "finalizing":
        return "typing";
      default:
        return "typing";
    }
  }

  private sendChatAction(ctx: Context, chatAction?: InteractionChatAction): void {
    if (!ctx.chat || !chatAction) return;
    void ctx.api.sendChatAction(ctx.chat.id, chatAction).catch(() => undefined);
  }
}

export const interactionPresentationService = new InteractionPresentationService();
