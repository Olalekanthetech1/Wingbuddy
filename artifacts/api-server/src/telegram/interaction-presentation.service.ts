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

export interface InteractionPresentationDecision {
  reaction?: string;
  chatAction?: "typing" | "upload_photo" | "upload_video" | "upload_document" | "record_voice" | "record_video";
  visibleProgressText?: string;
}

export interface InteractionPresentationHints {
  state?: InteractionProgressState;
  capability?: string;
  expectsLongRunning?: boolean;
  userFacingProgress?: boolean;
}

/**
 * Presentation policy is deliberately separate from semantic intent resolution.
 * It consumes trusted runtime state/capabilities and never interprets user
 * vocabulary. Reaction and progress UI are best-effort and cannot affect task
 * execution or response correctness.
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

    const capability = hints.capability?.trim().toLowerCase();
    if (capability?.includes("image") || capability?.includes("photo")) {
      return { reaction: this.defaultReaction, chatAction: "upload_photo" };
    }
    if (capability?.includes("video")) {
      return { reaction: this.defaultReaction, chatAction: "upload_video" };
    }
    if (capability?.includes("document") || capability?.includes("file")) {
      return { reaction: this.defaultReaction, chatAction: "upload_document" };
    }

    return {
      reaction: this.defaultReaction,
      chatAction: "typing",
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
