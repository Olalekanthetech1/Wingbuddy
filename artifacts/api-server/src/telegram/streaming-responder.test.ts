import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingResponder } from "./streaming-responder";

const reply = vi.fn();
const deleteMessage = vi.fn();
const editMessageText = vi.fn();
const sendChatAction = vi.fn();

const ctx = {
  chat: { id: 42 },
  from: { id: 99 },
  reply,
  api: { deleteMessage, editMessageText, sendChatAction },
} as any;

describe("StreamingResponder thinking lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.TELEGRAM_THINKING_TEXT;
  });

  it("uses configured thinking text as the initial streaming message", async () => {
    process.env.TELEGRAM_THINKING_TEXT = "💬 Thinking";
    reply.mockResolvedValue({ message_id: 123 });

    const responder = new StreamingResponder(ctx);
    const messageId = await responder.init();

    expect(messageId).toBe(123);
    expect(reply).toHaveBeenCalledWith("💬 Thinking", { parse_mode: "HTML" });
  });

  it("replaces that same message with the first final stream chunk", async () => {
    reply.mockResolvedValue({ message_id: 123 });
    editMessageText.mockResolvedValue({});

    const responder = new StreamingResponder(ctx);
    await responder.init();
    await responder.finalize("A streamed answer.");

    expect(reply).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(42, 123, "A streamed answer.", {
      parse_mode: "HTML",
    });
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("does not recreate a placeholder when final text is empty", async () => {
    reply.mockResolvedValue({ message_id: 123 });
    deleteMessage.mockResolvedValue({});

    const responder = new StreamingResponder(ctx);
    await responder.init();
    await responder.finalize("");

    expect(reply).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith(42, 123);
  });
});
