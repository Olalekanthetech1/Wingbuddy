import type { Context } from "grammy";
import { interactionPresentationService } from "./interaction-presentation.service";

/**
 * Backward-compatible entry point used by the Telegram runtime.
 * Presentation policy now owns reactions/chat actions so transport code does
 * not decide user-facing interaction behavior itself.
 */
export function startTypingIndicator(ctx: Context): () => void {
  interactionPresentationService.acknowledge(ctx, { state: "received" });
  return interactionPresentationService.startPresence(ctx, { state: "generating" });
}
