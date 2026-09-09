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
  progressText?: string | null;
  chatAction?: InteractionChatAction | null;
  reaction?: string | null;
  expectsLongRunning?: boolean;
  userFacingProgress?: boolean;
  showThinking?: boolean;
  elapsedMs?: number;
}

export interface InteractionPresentationDecision {
  reaction?: string;
  chatAction?: InteractionChatAction;
  visibleProgressText?: string;
}

export interface InteractionPresentationHints extends Partial<InteractionRuntimeEvent> {}

function configuredReaction(): string {
  const configured = process.env.TELEGRAM_DEFAULT_REACTION?.trim();
  return configured || "👀";
}

function configuredThinkingText(): string {
  const configured = process.env.TELEGRAM_THINKING_TEXT?.trim();
  return configured || "💭 Thinking";
}

/**
 * Presentation policy consumes trusted runtime metadata only. It never
 * interprets user vocabulary or performs intent detection.
 */
export class InteractionPresentationService {
  private readonly refreshMs: number;
  private readonly defaultReaction: string;
  private readonly thinkingText: string;

  constructor(options?: {
    refreshMs?: number;
    defaultReaction?: string;
    thinkingText?: string;
  }) {
    this.refreshMs = Math.max(1_000, options?.refreshMs ?? 4_000);
    this.defaultReaction = options?.defaultReaction ?? configuredReaction();
    this.thinkingText = options?.thinkingText ?? configuredThinkingText();
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
      const progress = this.progressText(event);
      if (progress) decision.visibleProgressText = progress;
    }

    return decision;
  }

  acknowledge(ctx: Context, hints: InteractionPresentationHints = {}): void {
    const decision = this.decide({ state: "received", ...hints });
    if (decision.reaction) void ctx.react(decision.reaction).catch(() => undefined);
    this.sendChatAction(ctx, decision.chatAction);
  }

  startPresence(ctx: Context, hints: InteractionPresentationHints = {}): () => void {
    const decision = this.decide({ state: "generating", ...hints });
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
    if (!decision.visibleProgressText) return progressMessageId;

    try {
      if (progressMessageId) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMessageId, decision.visibleProgressText);
        return progressMessageId;
      }
      if (!ctx.chat) return undefined;
      const message = await ctx.reply(decision.visibleProgressText);
      return message.message_id;
    } catch {
      return progressMessageId;
    }
  }

  private progressText(event: InteractionRuntimeEvent): string | undefined {
    const explicit = event.progressText?.trim();
    if (explicit) return `${explicit}${this.latencySuffix(event)}`;

    if (event.state === "reasoning" && event.showThinking !== false) {
      return `${this.thinkingText}${this.latencySuffix(event)}`;
    }

    const subject = event.operationLabel?.trim() || event.toolName?.trim();
    if (!subject) return undefined;

    if (event.state === "executing_tool") {
      return `Running tool: ${subject}…${this.latencySuffix(event)}`;
    }
    if (event.state === "generating") {
      return `Generating: ${subject}${this.latencySuffix(event)}`;
    }

    return `${subject}${this.latencySuffix(event)}`;
  }

  private latencySuffix(event: InteractionRuntimeEvent): string {
    const elapsedMs = event.elapsedMs ?? 0;
    if (!event.expectsLongRunning || elapsedMs < 8_000) return "";
    return ` (${Math.round(elapsedMs / 1_000)}s)`;
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
