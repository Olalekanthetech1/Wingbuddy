import type { Context } from "grammy";
import {
  interactionPresentationService,
  type InteractionPresentationHints,
} from "./interaction-presentation.service";

/**
 * Backward-compatible entry point for older Telegram handlers.
 * New runtime code should provide trusted execution metadata so the
 * presentation policy can choose the appropriate presence behavior.
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
