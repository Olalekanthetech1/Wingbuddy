import type { Context } from "grammy";
import {
  interactionPresentationService,
  type InteractionPresentationHints,
} from "./interaction-presentation.service";

const THINKING_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.TELEGRAM_THINKING_DELAY_MS ?? "1200", 10) || 1200,
);

/**
 * Acknowledges an accepted Telegram message immediately and keeps the native
 * chat presence alive while work is running. For conversational/interpretation
 * stages, a delayed Thinking message is shown only when the request lasts long
 * enough to need it, then removed when the operation completes.
 */
export function startTypingIndicator(
  ctx: Context,
  hints: InteractionPresentationHints = {},
): () => void {
  interactionPresentationService.acknowledge(ctx, hints);

  const stopPresence = interactionPresentationService.startPresence(ctx, {
    state: hints.state ?? "generating",
    ...hints,
  });

  const shouldShowThinking =
    hints.showThinking !== false &&
    (hints.state === "understanding" || hints.state === "reasoning" || hints.state === undefined);

  let stopped = false;
  let thinkingMessageId: number | undefined;
  let thinkingTimer: NodeJS.Timeout | undefined;

  if (shouldShowThinking) {
    thinkingTimer = setTimeout(() => {
      if (stopped) return;
      void interactionPresentationService
        .renderProgress(ctx, {
          state: "reasoning",
          userFacingProgress: true,
          reaction: null,
        })
        .then((messageId) => {
          if (!stopped) thinkingMessageId = messageId;
          else if (messageId && ctx.chat) void ctx.api.deleteMessage(ctx.chat.id, messageId).catch(() => undefined);
        })
        .catch(() => undefined);
    }, THINKING_DELAY_MS);
  }

  return () => {
    stopped = true;
    if (thinkingTimer) clearTimeout(thinkingTimer);
    stopPresence();
    if (thinkingMessageId && ctx.chat) {
      void ctx.api.deleteMessage(ctx.chat.id, thinkingMessageId).catch(() => undefined);
    }
  };
}
