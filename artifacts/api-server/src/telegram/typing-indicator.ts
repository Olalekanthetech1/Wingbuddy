import type { Context } from "grammy";
import {
  interactionPresentationService,
  type InteractionPresentationHints,
} from "./interaction-presentation.service";

export interface TypingIndicatorHandle {
  (): void;
  stop: () => void;
  updateReaction: (
    category: "tasks" | "ideas_or_analysis" | "gratitude_or_salute" | "done" | "intake",
  ) => void;
  complete: () => void;
  fail: () => void;
}

/**
 * Acknowledges an accepted Telegram message immediately and maintains a
 * continuous live typing heartbeat (~4s interval) while interaction is in progress.
 */
export function startTypingIndicator(
  ctx: Context,
  hints: InteractionPresentationHints = {},
): TypingIndicatorHandle {
  void interactionPresentationService.acknowledge(ctx, hints);
  const stopPresence = interactionPresentationService.startPresence(ctx, {
    state: hints.state ?? "generating",
    ...hints,
  });

  const handle = (() => {
    stopPresence();
  }) as TypingIndicatorHandle;

  handle.stop = () => {
    stopPresence();
  };

  handle.updateReaction = (category) => {
    void interactionPresentationService.updateReaction(ctx, category, hints);
  };

  handle.complete = () => {
    stopPresence();
    void interactionPresentationService.complete(ctx, hints);
  };

  handle.fail = () => {
    stopPresence();
    void interactionPresentationService.clearReaction(ctx);
  };

  return handle;
}
