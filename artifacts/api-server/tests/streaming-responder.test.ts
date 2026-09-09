import { describe, expect, it, vi } from "vitest";
import { StreamingResponder } from "../src/telegram/streaming-responder";
import type { Context } from "grammy";

describe("StreamingResponder", () => {
  it("initializes and streams edits within throttle thresholds", async () => {
    const editMessageTextMock = vi.fn().mockResolvedValue(true);
    const replyMock = vi.fn().mockResolvedValue({ message_id: 12345 });

    const mockCtx = {
      chat: { id: 98765 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    const responder = new StreamingResponder(mockCtx);
    const msgId = await responder.init();
    expect(msgId).toBe(12345);
    expect(replyMock).toHaveBeenCalledWith("…", { parse_mode: "HTML" });

    // Feed token chunks
    await responder.onChunk("Hello");
    await responder.finalize("Hello world! This is a complete response.");

    expect(editMessageTextMock).toHaveBeenCalledWith(
      98765,
      12345,
      "Hello world! This is a complete response.",
      { parse_mode: "HTML" },
    );
  });

  it("handles fallback gracefully if placeholder cannot be sent", async () => {
    const replyMock = vi.fn().mockRejectedValueOnce(new Error("Chat not accessible"));

    const mockCtx = {
      chat: { id: 98765 },
      reply: replyMock,
      api: {
        editMessageText: vi.fn(),
      },
    } as unknown as Context;

    const responder = new StreamingResponder(mockCtx);
    const msgId = await responder.init();
    expect(msgId).toBeUndefined();

    // Finalize should call reply with the final text
    replyMock.mockResolvedValueOnce({ message_id: 67890 });
    await responder.finalize("Direct fallback reply");
    expect(replyMock).toHaveBeenLastCalledWith("Direct fallback reply", { parse_mode: "HTML" });
  });
});
