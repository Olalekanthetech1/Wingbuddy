import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";

describe("Telegram Webhook Endpoint", () => {
  it("responds 200 OK to Telegram webhook updates on /api/telegram/webhook even if token is pending", async () => {
    const res = await request(app)
      .post("/api/telegram/webhook")
      .send({
        update_id: 998877,
        message: {
          message_id: 1,
          from: { id: 1000001, is_bot: false, first_name: "Test" },
          chat: { id: 1000001, type: "private" },
          date: 1788880000,
          text: "/help",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("responds 200 OK to Telegram webhook updates on /telegram/webhook alias", async () => {
    const res = await request(app)
      .post("/telegram/webhook")
      .send({
        update_id: 998878,
        message: {
          message_id: 2,
          from: { id: 1000001, is_bot: false, first_name: "Test" },
          chat: { id: 1000001, type: "private" },
          date: 1788880000,
          text: "Hello",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects invalid payload format with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/telegram/webhook")
      .send({ not_a_valid_telegram_update: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
