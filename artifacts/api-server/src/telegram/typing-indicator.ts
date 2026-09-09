import type { Context } from "grammy";

const TYPING_REFRESH_MS = 4_000;
const ACK_REACTION = "👀";

/**
 * Starts Telegram's typing presence and immediately acknowledges the current
 * incoming message. Both are presentation-only and must never affect the
 * underlying execution outcome.
 */
export function startTypingIndicator(ctx: Context): () => void {
  let stopped = false;

  // Telegram reactions are best-effort: chat permissions, message type, or
  // platform restrictions must never block the actual assistant response.
  void ctx.react(ACK_REACTION).catch(() => undefined);

  const sendTyping = (): void => {
    if (stopped || !ctx.chat) return;
    void ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
  };

  sendTyping();
  const timer = setInterval(sendTyping, TYPING_REFRESH_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
