import { Bot, webhookCallback } from "grammy";
import type { Express, Request, Response } from "express";
import { logger } from "../lib/logger";
import { getConfig } from "../config/env";
import { ConversationService } from "../services/conversation.service";
import { GeminiService } from "../gemini/gemini.service";
import { RateLimitService } from "../services/rate-limit.service";
import { isAuthorizedTelegramUser } from "../services/authorization.service";
import { splitTelegramMessage } from "../utils/split-message";
import { startTypingIndicator } from "./typing-indicator";

const PRIVATE_MESSAGE = "Sorry, this bot is currently private.";
const GENERIC_ERROR_MESSAGE =
  "I’m sorry, I couldn’t complete that request right now. Please try again in a moment.";

export interface TelegramBotRuntime {
  bot: Bot;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  mountWebhook: (app: Express) => void;
}

export function createTelegramBot(): TelegramBotRuntime {
  const config = getConfig();
  const bot = new Bot(config.telegramBotToken);
  const conversations = new ConversationService();
  const gemini = new GeminiService(
    config.geminiApiKey,
    config.geminiModel,
    config.geminiTimeoutMs,
  );
  const rateLimiter = new RateLimitService(
    config.rateLimitMaxRequests,
    config.rateLimitWindowMs,
  );

  const authorized = (userId: number): boolean =>
    isAuthorizedTelegramUser(userId, config.allowedTelegramUserIds);

  bot.command("start", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }
    await conversations.upsertUser({
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
    await ctx.reply(
      "Hello! I’m your personal AI assistant. Send me a message anytime and I’ll keep the conversation context for you.\n\nUse /help to see available commands.",
    );
  });

  bot.command("help", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }
    await ctx.reply(
      [
        "Available commands:",
        "/start — welcome message",
        "/help — show this help",
        "/clear — remove conversation messages",
        "/reset — start a completely fresh session",
        "/status — show bot and memory status",
        "",
        "You can also send a normal message to chat naturally with the assistant.",
      ].join("\n"),
    );
  });

  bot.command("clear", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }
    await conversations.clearConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your conversation history has been cleared.");
  });

  bot.command("reset", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }
    await conversations.resetConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your AI session has been completely reset.");
  });

  bot.command("status", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }
    await ctx.reply(
      [
        "Bot status: online",
        `Gemini status: configured`,
        `Current model: ${config.geminiModel}`,
        "Memory status: persistent conversation history enabled",
      ].join("\n"),
    );
  });

  bot.on("message:text", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return;
    }

    if (!rateLimiter.consume(ctx.from.id)) {
      await ctx.reply("You’re sending messages a little too quickly. Please wait a moment and try again.");
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) {
      await ctx.reply("Please send a message with some text and I’ll help.");
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    try {
      await conversations.upsertUser({
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
      const conversationId = await conversations.getOrCreateConversation(
        ctx.from.id,
        ctx.chat.id,
      );
      const history = await conversations.getRecentMessages(
        conversationId,
        config.maxHistoryMessages,
      );
      const reply = await gemini.generateReply(
        history.map((item) => ({
          role: item.role === "model" ? "model" : "user",
          content: item.content,
        })),
        text,
      );

      await conversations.addMessage(conversationId, "user", text);
      await conversations.addMessage(conversationId, "model", reply);
      for (const chunk of splitTelegramMessage(reply)) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      logger.error({ err: error, telegramUserId: ctx.from.id }, "Telegram message handling failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE);
    } finally {
      stopTyping();
    }
  });

  bot.catch((error) => {
    logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "Telegram update failed");
  });

  return {
    bot,
    async start() {
      if (config.usePolling) {
        await bot.api.deleteWebhook();
        await bot.start({
          onStart: (botInfo) => {
            logger.info({ username: botInfo.username }, "Telegram polling started");
          },
        });
        return;
      }
      await bot.api.setWebhook(config.telegramWebhookUrl!, {
        secret_token: config.telegramWebhookSecret,
      });
      logger.info({ webhookUrlConfigured: true }, "Telegram webhook configured");
    },
    async stop() {
      await bot.stop();
      logger.info("Telegram bot stopped");
    },
    mountWebhook(app) {
      if (config.usePolling) return;
      const handler = webhookCallback(
        bot,
        "express",
        config.telegramWebhookSecret
          ? { secretToken: config.telegramWebhookSecret }
          : undefined,
      );
      app.post("/api/telegram/webhook", (req: Request, res: Response) => {
        void handler(req, res);
      });
    },
  };
}