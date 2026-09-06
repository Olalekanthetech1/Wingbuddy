import type { Context } from "grammy";

const TYPING_REFRESH_MS = 4_000;

export function startTypingIndicator(ctx: Context): () => void {
  let stopped = false;
  const sendTyping = (): void => {
    if (stopped) return;
    void ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => undefined);
  };

  sendTyping();
  const timer = setInterval(sendTyping, TYPING_REFRESH_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}