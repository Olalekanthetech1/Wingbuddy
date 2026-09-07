import { Bot, Context, InlineKeyboard, webhookCallback } from "grammy";
import type { Express, Request, Response } from "express";
import { logger } from "../lib/logger";
import { getConfig } from "../config/env";
import { MODES, MODE_KEYS, type ModeKey } from "../config/mode";
import { ConversationService } from "../services/conversation.service";
import { GeminiService } from "../gemini/gemini.service";
import { RateLimitService } from "../services/rate-limit.service";
import { isAuthorizedTelegramUser } from "../services/authorization.service";
import { splitTelegramMessage } from "../utils/split-message";
import { startTypingIndicator } from "./typing-indicator";
import {
  PERSONALITIES,
  PERSONALITY_KEYS,
  type PersonalityKey,
} from "../config/personality";
import {
  feedbackKeyboard,
  feedbackReasonKeyboard,
  helpKeyboard,
  mainMenuKeyboard,
  modeKeyboard,
  personalityKeyboard,
  settingsKeyboard,
} from "./keyboards";
import {
  CHAT_TEXT,
  HELP_TEXT,
  MAIN_MENU_TEXT,
  MEMORY_TEXT,
  REMINDERS_TEXT,
  SETTINGS_TEXT,
  VOICE_TEXT,
  modeText,
  personalityText,
} from "./navigation";

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

  const upsertUser = async (ctx: Context): Promise<void> => {
    if (!ctx.from) return;
    await conversations.upsertUser({
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  };

  const requireAuthorized = async (
    ctx: Context,
  ): Promise<boolean> => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.reply(PRIVATE_MESSAGE);
      return false;
    }
    return true;
  };

  const personalityMenu = async (
    ctx: Context,
  ): Promise<void> => {
    if (!ctx.from) return;
    await upsertUser(ctx);
    const current = await conversations.getUserPersonality(ctx.from.id);
    await ctx.reply(personalityText(current), {
      reply_markup: personalityKeyboard(current),
    });
  };

  const modeMenu = async (
    ctx: Context,
  ): Promise<void> => {
    if (!ctx.from) return;
    await upsertUser(ctx);
    const current = await conversations.getUserMode(ctx.from.id);
    await ctx.reply(modeText(current), { reply_markup: modeKeyboard(current) });
  };

  const clearConversation = async (
    ctx: Context,
  ): Promise<void> => {
    if (!ctx.from || !ctx.chat) return;
    await conversations.clearConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your conversation history has been cleared.", {
      reply_markup: mainMenuKeyboard(),
    });
  };

  bot.command("start", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await upsertUser(ctx);
    await ctx.reply(
      "Hello! I’m your personal AI assistant. I’m playful and chatty by default, and you can change both my tone and task mode from the menu.\n\nSend me a message anytime—I’ll keep normal conversation working without requiring a button.",
      { reply_markup: mainMenuKeyboard() },
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await ctx.reply(HELP_TEXT, { reply_markup: helpKeyboard() });
  });

  bot.command("clear", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await clearConversation(ctx);
  });

  bot.command("reset", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await conversations.resetConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your AI session has been completely reset.", {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("personality", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await personalityMenu(ctx);
  });

  bot.command("mode", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await modeMenu(ctx);
  });

  bot.command("status", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    const personality = await conversations.getUserPersonality(ctx.from.id);
    const mode = await conversations.getUserMode(ctx.from.id);
    await ctx.reply(
      [
        "Bot status: online",
        "Gemini status: configured",
        `Current model: ${config.geminiModel}`,
        "Conversation history: persistent and isolated by user + chat",
        `Personality: ${PERSONALITIES[personality].label}`,
        `Assistant mode: ${MODES[mode].label}`,
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() },
    );
  });

  bot.callbackQuery(/^menu:(main|chat|memory|modes|voice|reminders|settings|help)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const destination = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (destination === "main") {
      await ctx.editMessageText(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
    } else if (destination === "chat") {
      await ctx.editMessageText(CHAT_TEXT, { reply_markup: mainMenuKeyboard() });
    } else if (destination === "memory") {
      await ctx.editMessageText(MEMORY_TEXT, {
        reply_markup: new InlineKeyboard().text("◀️ Back", "menu:main"),
      });
    } else if (destination === "modes") {
      await upsertUser(ctx);
      const current = await conversations.getUserMode(ctx.from.id);
      await ctx.editMessageText(modeText(current), { reply_markup: modeKeyboard(current) });
    } else if (destination === "voice") {
      await ctx.editMessageText(VOICE_TEXT, {
        reply_markup: new InlineKeyboard().text("◀️ Back", "menu:main"),
      });
    } else if (destination === "reminders") {
      await ctx.editMessageText(REMINDERS_TEXT, {
        reply_markup: new InlineKeyboard().text("◀️ Back", "menu:main"),
      });
    } else if (destination === "settings") {
      await ctx.editMessageText(SETTINGS_TEXT, { reply_markup: settingsKeyboard() });
    } else {
      await ctx.editMessageText(HELP_TEXT, { reply_markup: helpKeyboard() });
    }
  });

  bot.callbackQuery("settings:personality", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await upsertUser(ctx);
    const current = await conversations.getUserPersonality(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(personalityText(current), {
      reply_markup: personalityKeyboard(current),
    });
  });

  bot.callbackQuery("settings:mode", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await upsertUser(ctx);
    const current = await conversations.getUserMode(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(modeText(current), {
      reply_markup: modeKeyboard(current, "menu:settings"),
    });
  });

  bot.callbackQuery(/^personality:(playful|balanced|focused|professional)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const personality = ctx.match[1] as PersonalityKey;
    await upsertUser(ctx);
    await conversations.setUserPersonality(ctx.from.id, personality);
    await ctx.answerCallbackQuery({ text: `${PERSONALITIES[personality].label} selected` });
    await ctx.editMessageText(personalityText(personality), {
      reply_markup: personalityKeyboard(personality),
    });
  });

  bot.callbackQuery(/^mode:(general|study|writing|brainstorming|coding|travel)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const mode = ctx.match[1] as ModeKey;
    await upsertUser(ctx);
    await conversations.setUserMode(ctx.from.id, mode);
    await ctx.answerCallbackQuery({ text: `${MODES[mode].label} selected` });
    await ctx.editMessageText(modeText(mode), { reply_markup: modeKeyboard(mode) });
  });

  bot.callbackQuery("action:clear", async (ctx) => {
    if (!ctx.from || !ctx.chat || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await conversations.clearConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Conversation cleared" });
    await ctx.editMessageText("Your conversation history has been cleared.", {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.callbackQuery("feedback:helpful", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    logger.info({ telegramUserId: ctx.from.id, feedback: "helpful" }, "Assistant feedback received");
    await ctx.answerCallbackQuery({ text: "Thanks for the feedback!" });
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Helpful — thanks!", "feedback:no-op"),
    });
  });

  bot.callbackQuery("feedback:not_quite", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "What should I improve?" });
    await ctx.editMessageReplyMarkup({ reply_markup: feedbackReasonKeyboard() });
  });

  bot.callbackQuery(/^feedback:reason:(too_long|incorrect|unclear|tone|other)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    logger.info(
      { telegramUserId: ctx.from.id, feedback: ctx.match[1] },
      "Assistant feedback reason received",
    );
    await ctx.answerCallbackQuery({ text: "Thanks — I’ll keep that in mind." });
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Feedback received", "feedback:no-op"),
    });
  });

  bot.callbackQuery("feedback:no-op", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.on("message:voice", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await ctx.reply("Voice messages aren’t enabled yet, but voice support is planned. For now, please send the message as text.");
  });

  bot.on("message:text", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;

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
      await upsertUser(ctx);
      const conversationId = await conversations.getOrCreateConversation(
        ctx.from.id,
        ctx.chat.id,
      );
      const [personality, mode] = await Promise.all([
        conversations.getUserPersonality(ctx.from.id),
        conversations.getUserMode(ctx.from.id),
      ]);
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
        {
          personalityInstruction: PERSONALITIES[personality].instruction,
          modeInstruction: MODES[mode].instruction,
        },
      );

      await conversations.addMessage(conversationId, "user", text);
      await conversations.addMessage(conversationId, "model", reply);
      const chunks = splitTelegramMessage(reply);
      for (const [index, chunk] of chunks.entries()) {
        await ctx.reply(chunk, {
          reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined,
        });
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