import type { Context } from "grammy";
import {
  interactionPresentationService,
  type InteractionPresentationHints,
} from "./interaction-presentation.service";

/**
 * Acknowledges an accepted Telegram message immediately and keeps native
 * Telegram presence alive while the current interaction is running.
 *
 * Visible Thinking is deliberately not created here. StreamingResponder owns
 * the single editable response message so the final streamed answer replaces
 * the Thinking indicator instead of creating a second placeholder.
 */
export function startTypingIndicator(
  ctx: Context,
  hints: InteractionPresentationHints = {},
): () => void {
  interactionPresentationService.acknowledge(ctx, hints);
  return interactionPresentationService.startPresence(ctx, {
    state: hints.state ?? "generating",
    ...hints,
  });
}
