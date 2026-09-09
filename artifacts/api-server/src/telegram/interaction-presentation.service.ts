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

export interface InteractionPresentationDecision {
  reaction?: string;
  chatAction?: InteractionChatAction;
  visibleProgressText?: string;
}

export interface InteractionPresentationHints {
  state?: InteractionProgressState;
  chatAction?: InteractionChatAction;
  reaction?: string | null;
  expectsLongRunning?: boolean;
  userFacingProgress?: boolean;
}

/**
 * Presentation policy consumes trusted runtime metadata only. It never
 * interprets user vocabulary or uses substring/regex intent detection.
 */
export class InteractionPresentationService {
  private readonly refreshMs: number;
  private readonly defaultReaction: string;

  constructor(options?: { refreshMs?: number; defaultReaction?: string }) {
    this.refreshMs = Math.max(1_000, options?.refreshMs ?? 4_000);
    this.defaultReaction = options?.defaultReaction ?? "👀";
  }

  decide(hints: InteractionPresentationHints): InteractionPresentationDecision {
    const state = hints.state ?? "received";
    if (state === "completed" || state === "failed") return {};

    return {
      reaction: hints.reaction === null ? undefined : hints.reaction ?? this.defaultReaction,
      chatAction: hints.chatAction ?? "typing",
    };
  }

  acknowledge(ctx: Context, hints: InteractionPresentationHints = {}): void {
    const decision = this.decide({ ...hints, state: "received" });
    if (decision.reaction) void ctx.react(decision.reaction).catch(() => undefined);
    if (decision.chatAction && ctx.chat) {
      void ctx.api.sendChatAction(ctx.chat.id, decision.chatAction).catch(() => undefined);
    }
  }

  startPresence(ctx: Context, hints: InteractionPresentationHints = {}): () => void {
    const decision = this.decide(hints);
    let stopped = false;
    const send = (): void => {
      if (stopped || !ctx.chat || !decision.chatAction) return;
      void ctx.api.sendChatAction(ctx.chat.id, decision.chatAction).catch(() => undefined);
    };
    send();
    const timer = setInterval(send, this.refreshMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}

export const interactionPresentationService = new InteractionPresentationService();
