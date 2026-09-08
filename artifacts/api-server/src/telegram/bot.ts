import { Bot, Context, InlineKeyboard, InputFile, webhookCallback } from "grammy";
import type { Express, Request, Response } from "express";
import { logger } from "../lib/logger";
import { getConfig } from "../config/env";
import { MODES, MODE_KEYS, type ModeKey } from "../config/mode";
import { ConversationService } from "../services/conversation.service";
import { GlobalContextService } from "../services/global-context.service";
import { GeminiService } from "../gemini/gemini.service";
import { AdaptiveIntentService } from "../services/adaptive-intent.service";
import { ImageGenerationService } from "../services/image-generation.service";
import { VideoGenerationService } from "../services/video-generation.service";
import { MediaProcessorService, type ProcessedMedia } from "../services/media-processor.service";
import { RateLimitService } from "../services/rate-limit.service";
import { isAuthorizedTelegramUser } from "../services/authorization.service";
import { telegramWorkerQueue } from "../services/worker-queue.service";
import { splitTelegramMessage } from "../utils/split-message";
import { safeErrorMetadata } from "../utils/safe-error";
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
  memoriesKeyboard,
  modeKeyboard,
  personalityKeyboard,
  remindersKeyboard,
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
  formatMemoriesMenuText,
  formatRemindersMenuText,
  modeText,
  personalityText,
} from "./navigation";
import {
  ReminderService,
  reminderScheduler,
  reminderService,
} from "../services/reminder.service";
import { StreamingResponder } from "./streaming-responder";


const PRIVATE_MESSAGE = "Sorry, this bot is currently private.";
const GENERIC_ERROR_MESSAGE =
  "I’m sorry, I couldn’t complete that request right now. Please try again in a moment.";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
  const globalContext = new GlobalContextService(conversations);
  const gemini = new GeminiService(
    config.geminiApiKey,
    config.geminiModel,
    process.env.GEMINI_TIMEOUT_MS ? config.geminiTimeoutMs : 0,
  );
  const rateLimiter = new RateLimitService(
    process.env.RATE_LIMIT_MAX_REQUESTS ? config.rateLimitMaxRequests : undefined,
    process.env.RATE_LIMIT_WINDOW_MS ? config.rateLimitWindowMs : undefined,
  );

  const authorized = (userId: number): boolean =>
    isAuthorizedTelegramUser(userId, config.allowedTelegramUserIds);

  const runStage = async <T>(
    stage: string,
    context: { telegramUserId?: number; chatId?: number },
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      logger.error(
        { stage, ...context, error: safeErrorMetadata(error) },
        "Telegram chat stage failed",
      );
      throw error;
    }
  };

  const upsertUser = async (ctx: Context): Promise<void> => {
    if (!ctx.from) return;
    await runStage(
      "database_user_upsert",
      { telegramUserId: ctx.from.id, chatId: ctx.chat?.id },
      () =>
        conversations.upsertUser({
          id: ctx.from!.id,
          username: ctx.from!.username,
          firstName: ctx.from!.first_name,
          lastName: ctx.from!.last_name,
        }),
    );
  };

  const requireAuthorized = async (
    ctx: Context,
  ): Promise<boolean> => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      logger.warn(
        { stage: "authorization", telegramUserId: ctx.from?.id },
        "Telegram update rejected by authorization policy",
      );
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

  bot.command(["purge", "privacy", "deletedata"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await conversations.purgeUserData(ctx.from.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply(
      "🔒 <b>All personal data purged.</b>\n\nYour user profile, conversations, messages, long-term memories, and active reminders have been completely removed from the database in compliance with GDPR cascading deletion.",
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
    );
  });


  bot.command("reset", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
    const recent = await conversations.getRecentMessages(conversationId, 20);
    if (recent.length >= 2) {
      const summary = await gemini.summarizeSession(
        recent.map((m) => ({ role: m.role as "user" | "model", content: m.content })),
      );
      if (summary) {
        await conversations.setSessionSummary(conversationId, summary);
      }
    }
    await conversations.resetConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your AI session has been reset. Stored long-term memories remain intact.", {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("memories", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const memories = await conversations.getUserMemories(ctx.from.id);
    await ctx.reply(formatMemoriesMenuText(memories), {
      reply_markup: memoriesKeyboard(memories),
    });
  });

  bot.command("remember", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawText = ctx.match?.trim();
    if (!rawText) {
      await ctx.reply(
        "Please provide what you want me to remember.\n\nExamples:\n/remember stack: TypeScript, PostgreSQL\n/remember I prefer concise bullet points",
      );
      return;
    }

    let key: string;
    let content: string;
    let category = "fact";

    if (rawText.includes(":")) {
      const parts = rawText.split(":");
      key = parts[0].trim().toLowerCase().replace(/\s+/g, "_");
      content = parts.slice(1).join(":").trim();
    } else {
      const sanitized = rawText.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const words = sanitized.split(/\s+/).slice(0, 3);
      key = words.join("_") || "user_fact";
      content = rawText;
      if (rawText.toLowerCase().includes("prefer") || rawText.toLowerCase().includes("like")) {
        category = "preference";
      }
    }

    let embedding: number[] | undefined;
    try {
      if (typeof gemini.embedText === "function") {
        const vec = await gemini.embedText(`${key}: ${content}`);
        if (vec.length > 0) embedding = vec;
      }
    } catch {}

    await conversations.saveUserMemory(ctx.from.id, key, content, category, embedding);
    await ctx.reply(`🧠 Remembered:\n• [${category}] *${key}*: ${content}`, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("🧠 View All Memories", "menu:memory")
        .row()
        .text("◀️ Main Menu", "menu:main"),
    });
  });

  bot.command("forget", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const key = ctx.match?.trim().toLowerCase();
    if (!key) {
      await ctx.reply("Please specify the memory key to forget.\nExample: /forget preferred_stack");
      return;
    }
    const deleted = await conversations.deleteUserMemory(ctx.from.id, key);
    if (deleted) {
      await ctx.reply(`🗑️ Forgotten memory: ${key}`);
    } else {
      await ctx.reply(`No memory found with key: ${key}`);
    }
  });

  bot.command(["reminders", "reminder"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const active = await reminderService.getActiveUserReminders(ctx.from.id);
    await ctx.reply(formatRemindersMenuText(active), {
      parse_mode: "Markdown",
      reply_markup: remindersKeyboard(active),
    });
  });

  bot.command("remind", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const rawInput = ctx.match?.trim();
    if (!rawInput) {
      await ctx.reply(
        "Please provide a time and task description.\n\nExamples:\n• /remind in 15 mins to check deploy\n• /remind tomorrow at 9am standup meeting\n• /remind tonight at 8pm call team",
      );
      return;
    }
    const parsed = ReminderService.parseNaturalReminder(`remind me ${rawInput}`);
    if (!parsed) {
      await ctx.reply(
        "Could not parse that reminder time.\nTry formats like:\n• /remind in 20 minutes <task>\n• /remind tomorrow at 10am <task>\n• /remind at 4:30 pm <task>",
      );
      return;
    }
    const created = await reminderService.createReminder({
      telegramUserId: ctx.from.id,
      chatId: ctx.chat.id,
      prompt: parsed.prompt,
      dueAt: parsed.dueAt,
    });
    await ctx.reply(
      `⏰ <b>Reminder scheduled!</b>\n\n📌 <b>Task:</b> ${escapeHtml(parsed.prompt)}\n🕒 <b>Due:</b> ${parsed.humanReadableTime}`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("❌ Cancel", `rem_cancel:${created.id}`),
      },
    );
  });

  bot.command("search", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply(
        "Please provide a search topic or question.\nExample: /search Google I/O latest announcements",
      );
      return;
    }
    const stopTyping = startTypingIndicator(ctx);
    try {
      const globalContextData = await globalContext.getContextForCompletion({
        telegramUserId: ctx.from.id,
        chatId: ctx.chat.id,
        userProfile: {
          id: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        },
        maxHistoryMessages: config.maxHistoryMessages,
        message: query,
        geminiService: gemini,
      });

      const reply = await gemini.generateReply(
        globalContextData.recentHistory,
        query,
        {
          personalityInstruction: globalContextData.userProfile.personalityInstruction,
          modeInstruction: MODES.research.instruction,
          memoryInstruction: globalContextData.promptInstruction || undefined,
        },
        { enableSearch: true },
      );

      await conversations.addMessage(globalContextData.conversationId, "user", `/search ${query}`);
      await conversations.addMessage(globalContextData.conversationId, "model", reply);

      const chunks = splitTelegramMessage(reply);
      for (const [index, chunk] of chunks.entries()) {
        await ctx.reply(chunk, {
          reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined,
        });
      }
    } catch (error) {
      logger.error({ stage: "search_command", error: safeErrorMetadata(error) }, "Search failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE);
    } finally {
      stopTyping();
    }
  });

  bot.command("think", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply(
        "Please provide a problem to reason through.\nExample: /think Design a distributed idempotency lock in Redis",
      );
      return;
    }
    const stopTyping = startTypingIndicator(ctx);
    try {
      const globalContextData = await globalContext.getContextForCompletion({
        telegramUserId: ctx.from.id,
        chatId: ctx.chat.id,
        userProfile: {
          id: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        },
        maxHistoryMessages: config.maxHistoryMessages,
        message: query,
        geminiService: gemini,
      });

      const reply = await gemini.generateReply(
        globalContextData.recentHistory,
        query,
        {
          personalityInstruction: globalContextData.userProfile.personalityInstruction,
          modeInstruction: MODES.reasoning.instruction,
          memoryInstruction: globalContextData.promptInstruction || undefined,
        },
        { thinkingLevel: "LOW" },
      );

      await conversations.addMessage(globalContextData.conversationId, "user", `/think ${query}`);
      await conversations.addMessage(globalContextData.conversationId, "model", reply);

      const chunks = splitTelegramMessage(reply);
      for (const [index, chunk] of chunks.entries()) {
        await ctx.reply(chunk, {
          reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined,
        });
      }
    } catch (error) {
      logger.error({ stage: "think_command", error: safeErrorMetadata(error) }, "Thinking mode failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE);
    } finally {
      stopTyping();
    }
  });

  bot.command(["image", "draw", "img"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawPrompt = ctx.match?.trim();
    if (!rawPrompt) {
      await ctx.reply(
        "Please provide a prompt for the image!\nExample: /image a cybernetic tiger walking through rainy neon Tokyo, 8k render",
      );
      return;
    }

    const rateLimit = rateLimiter.check(ctx.from.id);
    if (!rateLimit.allowed) {
      await ctx.reply(RATE_LIMIT_MESSAGE(rateLimit.retryAfterSeconds));
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    await ctx.sendChatAction("upload_photo").catch(() => {});
    try {
      const result = await ImageGenerationService.generate(rawPrompt, gemini);

      const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
      await conversations.addMessage(conversationId, "user", `/image ${rawPrompt}`);
      await conversations.addMessage(
        conversationId,
        "model",
        `[Generated Image for: "${rawPrompt}"] Enhanced: "${result.enhancedPrompt}"`,
      );

      const imageBadge = result.provider === "huggingface" ? "<i>Engine: 🤗 Hugging Face (FLUX.1)</i>" : "<i>Engine: 🌐 Free Community (FLUX.1)</i>";
      const caption = [
        `<b>🎨 Prompt:</b> ${escapeHtml(result.originalPrompt)}`,
        result.enhancedPrompt.toLowerCase() !== result.originalPrompt.toLowerCase()
          ? `<i>✨ Gemini Enhanced:</i> ${escapeHtml(result.enhancedPrompt)}`
          : null,
        imageBadge,
      ]
        .filter(Boolean)
        .join("\n\n");

      const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;

      if (!result?.buffer || !Buffer.isBuffer(result.buffer) || result.buffer.length < 500) {
        throw new Error("Image generation did not produce a valid image buffer");
      }

      await ctx.replyWithPhoto(
        new InputFile(result.buffer, "image.jpg"),
        {
          caption: safeCaption,
          parse_mode: "HTML",
          reply_markup: feedbackKeyboard(),
        },
      );
    } catch (error) {
      logger.error({ stage: "image_generation", error: safeErrorMetadata(error) }, "Image generation failed");
      await ctx.reply("Sorry, I encountered an issue generating that image. Please try again or rephrase your prompt.");
    } finally {
      stopTyping();
    }
  });

  bot.command(["video", "vid", "clip"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawPrompt = ctx.match?.trim();
    if (!rawPrompt) {
      await ctx.reply(
        "Please provide a prompt for the video!\nExample: /video a golden retriever running along a sunny beach, slow motion cinematography",
      );
      return;
    }

    const rateLimit = rateLimiter.check(ctx.from.id);
    if (!rateLimit.allowed) {
      await ctx.reply(RATE_LIMIT_MESSAGE(rateLimit.retryAfterSeconds));
      return;
    }

    const stopTyping = startTypingIndicator(ctx);
    await ctx.sendChatAction("upload_video").catch(() => {});
    const progressMsg = await ctx.reply("🎬 Rendering your visual clip... this usually takes ~15-30s.").catch(() => null);

    try {
      const result = await VideoGenerationService.generate(rawPrompt, gemini);

      const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
      await conversations.addMessage(conversationId, "user", `/video ${rawPrompt}`);
      await conversations.addMessage(
        conversationId,
        "model",
        `[Generated Visual (${result.provider}) for: "${rawPrompt}"] Enhanced: "${result.enhancedPrompt}"`,
      );

      const providerBadge = result.provider === "huggingface" ? "🤗 Hugging Face" : "🌐 Free Community";
      const caption = [
        `<b>🎬 Prompt:</b> ${escapeHtml(result.originalPrompt)}`,
        result.enhancedPrompt.toLowerCase() !== result.originalPrompt.toLowerCase()
          ? `<i>✨ Gemini Enhanced:</i> ${escapeHtml(result.enhancedPrompt)}`
          : null,
        `<i>Engine: ${providerBadge}</i>`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;

      if (progressMsg) {
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
      }

      if (result.isVideo && Buffer.isBuffer(result.buffer) && result.buffer.length > 1000) {
        await ctx.replyWithVideo(
          new InputFile(result.buffer, "video.mp4"),
          {
            caption: safeCaption,
            parse_mode: "HTML",
            reply_markup: feedbackKeyboard(),
          },
        );
      } else if (Buffer.isBuffer(result.buffer) && result.buffer.length > 500) {
        await ctx.replyWithPhoto(
          new InputFile(result.buffer, "storyboard.jpg"),
          {
            caption: `${safeCaption}\n\n<i>(Rendered as a cinematic storyboard concept frame)</i>`,
            parse_mode: "HTML",
            reply_markup: feedbackKeyboard(),
          },
        );
      } else {
        throw new Error("Video service did not produce a valid visual buffer");
      }
    } catch (error) {
      logger.error({ stage: "video_generation", error: safeErrorMetadata(error) }, "Video generation failed");
      if (progressMsg) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          "Sorry, video generation timed out or encountered an issue. Please try again with a shorter prompt.",
        ).catch(() => {});
      } else {
        await ctx.reply("Sorry, I encountered an issue generating that visual. Please try again.");
      }
    } finally {
      stopTyping();
    }
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
    const userContext = await conversations.getUserWithFullContext(ctx.from.id);
    const personalityKey = (userContext?.personality as PersonalityKey) || "playful";
    const modeKey = (userContext?.mode as ModeKey) || "general";
    const personality = isPersonalityKey(personalityKey) ? personalityKey : "playful";
    const mode = isModeKey(modeKey) ? modeKey : "general";
    const activeReminders = userContext?.reminders?.length ?? 0;
    const memoryCount = userContext?.memories?.length ?? 0;
    const activeSessions = userContext?.conversations?.length ?? 0;

    await ctx.reply(
      [
        "🤖 <b>Bot status:</b> online",
        "⚡ <b>Gemini status:</b> configured",
        `🧠 <b>Current model:</b> ${config.geminiModel}`,
        `💬 <b>Active sessions:</b> ${activeSessions}`,
        `📚 <b>Long-term memories:</b> ${memoryCount} saved`,
        `⏰ <b>Pending reminders:</b> ${activeReminders}`,
        `🎭 <b>Personality:</b> ${PERSONALITIES[personality].label}`,
        `🎯 <b>Assistant mode:</b> ${MODES[mode].label}`,
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard() },
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
      await upsertUser(ctx);
      const memories = await conversations.getUserMemories(ctx.from.id);
      await ctx.editMessageText(formatMemoriesMenuText(memories), {
        reply_markup: memoriesKeyboard(memories),
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
      await upsertUser(ctx);
      const active = await reminderService.getActiveUserReminders(ctx.from.id);
      await ctx.editMessageText(formatRemindersMenuText(active), {
        parse_mode: "Markdown",
        reply_markup: remindersKeyboard(active),
      });
    } else if (destination === "settings") {
      await ctx.editMessageText(SETTINGS_TEXT, { reply_markup: settingsKeyboard() });
    } else {
      await ctx.editMessageText(HELP_TEXT, { reply_markup: helpKeyboard() });
    }
  });

  bot.callbackQuery(/^rem_done:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    await reminderService.completeReminder(reminderId, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "✅ Marked reminder as done!" });
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Completed", "feedback:no-op"),
    });
  });

  bot.callbackQuery(/^rem_snooze:(\d+):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    const minutes = parseInt(ctx.match[2], 10) || 10;
    const updated = await reminderService.snoozeReminder(reminderId, minutes, ctx.from.id);
    if (updated) {
      const timeStr = updated.dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      await ctx.answerCallbackQuery({ text: `⏰ Snoozed for ${minutes}m (until ${timeStr})` });
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(`⏰ Snoozed until ${timeStr}`, "feedback:no-op"),
      });
    } else {
      await ctx.answerCallbackQuery({ text: "Reminder not found or already completed." });
    }
  });

  bot.callbackQuery(/^rem_cancel:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    await reminderService.cancelReminder(reminderId, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "❌ Reminder cancelled." });
    const active = await reminderService.getActiveUserReminders(ctx.from.id);
    await ctx.editMessageText(formatRemindersMenuText(active), {
      parse_mode: "Markdown",
      reply_markup: remindersKeyboard(active),
    }).catch(async () => {
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text("❌ Cancelled", "feedback:no-op"),
      });
    });
  });


  bot.callbackQuery(/^memory:delete:(.+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const key = ctx.match[1];
    await conversations.deleteUserMemory(ctx.from.id, key);
    await ctx.answerCallbackQuery({ text: `Deleted memory: ${key}` });
    const memories = await conversations.getUserMemories(ctx.from.id);
    await ctx.editMessageText(formatMemoriesMenuText(memories), {
      reply_markup: memoriesKeyboard(memories),
    });
  });

  bot.callbackQuery("memory:clear_all", async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await conversations.clearUserMemories(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "All long-term memories cleared." });
    const memories = await conversations.getUserMemories(ctx.from.id);
    await ctx.editMessageText(formatMemoriesMenuText(memories), {
      reply_markup: memoriesKeyboard(memories),
    });
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

  async function handleIncomingTelegramMessage(
    ctx: Context,
    payload: {
      rawText?: string;
      media?: {
        fileId: string;
        mediaType: "image" | "document" | "voice" | "audio";
        reportedMime?: string;
        fileName?: string;
        fileSize?: number;
      };
    },
  ) {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;

    if (!rateLimiter.consume(ctx.from.id)) {
      logger.warn(
        { stage: "rate_limiting", telegramUserId: ctx.from.id },
        "Telegram message rejected by rate limiter",
      );
      await ctx.reply("You’re sending messages a little too quickly. Please wait a moment and try again.");
      return;
    }

    const { rawText, media } = payload;

    // If text-only, check for empty string
    if (!media && (!rawText || !rawText.trim())) {
      await ctx.reply("Please send a message with some text or attach an image, document, or voice note.");
      return;
    }

    const prompt = MediaProcessorService.buildMultimodalPrompt(
      rawText,
      media?.mediaType,
      media?.fileName,
    );

    // Natural Reminder Detection: only for plain text messages without media attachments
    if (!media && rawText) {
      const naturalReminder = ReminderService.parseNaturalReminder(rawText);
      if (naturalReminder) {
        try {
          const created = await reminderService.createReminder({
            telegramUserId: ctx.from.id,
            chatId: ctx.chat.id,
            prompt: naturalReminder.prompt,
            dueAt: naturalReminder.dueAt,
          });
          await ctx.reply(
            `⏰ <b>Reminder scheduled!</b>\n\n📌 <b>Task:</b> ${escapeHtml(naturalReminder.prompt)}\n🕒 <b>Due:</b> ${naturalReminder.humanReadableTime}`,
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().text("❌ Cancel", `rem_cancel:${created.id}`),
            },
          );
          return;
        } catch (err) {
          logger.warn({ error: safeErrorMetadata(err) }, "Failed saving natural reminder");
        }
      }
    }

    const stopTyping = startTypingIndicator(ctx);
    try {
      // 1. Download media if attached
      let processedMedia: ProcessedMedia | undefined;
      if (media) {
        try {
          processedMedia = await MediaProcessorService.downloadTelegramMedia(
            ctx.api,
            config.telegramBotToken,
            media.fileId,
            {
              expectedType: media.mediaType,
              reportedMime: media.reportedMime,
              fileName: media.fileName,
            },
          );
        } catch (mediaErr) {
          logger.error(
            { error: safeErrorMetadata(mediaErr), mediaType: media.mediaType },
            "Failed downloading Telegram media for multimodal processing",
          );
          await ctx.reply("⚠️ Sorry, I could not download the attached media from Telegram. Please try sending it again.");
          return;
        }
      }

      // 2. Automatically associate message with user ID and query Global Context with Semantic Vector Recall
      const globalContextData = await runStage(
        "global_context_retrieval",
        { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
        () =>
          globalContext.getContextForCompletion({
            telegramUserId: ctx.from!.id,
            chatId: ctx.chat!.id,
            userProfile: {
              id: ctx.from!.id,
              username: ctx.from!.username,
              firstName: ctx.from!.first_name,
              lastName: ctx.from!.last_name,
            },
            maxHistoryMessages: config.maxHistoryMessages,
            message: prompt,
            geminiService: gemini,
          }),
      );

      // 3. Systematic & Dynamic Adaptation:
      const adaptivePlan = AdaptiveIntentService.analyze(
        prompt,
        globalContextData.userProfile.mode,
        globalContextData.recentHistory,
      );

      // 4a. Natural Video Generation Intent (text-only):
      if (!media && adaptivePlan.detectedIntent === "video_generation" && adaptivePlan.videoPrompt) {
        await ctx.sendChatAction("upload_video").catch(() => {});
        const progressMsg = await ctx.reply("🎬 Rendering your video clip... this usually takes ~30-50s.").catch(() => null);
        try {
          const videoResult = await VideoGenerationService.generate(
            adaptivePlan.videoPrompt,
            gemini,
          );

          await runStage(
            "user_message_save",
            { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
            () => conversations.addMessage(globalContextData.conversationId, "user", prompt),
          );
          await runStage(
            "model_response_save",
            { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
            () =>
              conversations.addMessage(
                globalContextData.conversationId,
                "model",
                `[Generated Video (${videoResult.provider}) for: "${adaptivePlan.videoPrompt}"] Enhanced: "${videoResult.enhancedPrompt}"`,
              ),
          );

          const providerBadge = videoResult.provider === "huggingface" ? "🤗 Hugging Face" : "🌐 Free Community";
          const caption = [
            `<b>🎬 Prompt:</b> ${escapeHtml(videoResult.originalPrompt)}`,
            videoResult.enhancedPrompt.toLowerCase() !== videoResult.originalPrompt.toLowerCase()
              ? `<i>✨ Gemini Enhanced:</i> ${escapeHtml(videoResult.enhancedPrompt)}`
              : null,
            `<i>Engine: ${providerBadge}</i>`,
          ]
            .filter(Boolean)
            .join("\n\n");

          const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;

          if (progressMsg) {
            await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
          }

          if (videoResult.isVideo && Buffer.isBuffer(videoResult.buffer) && videoResult.buffer.length > 1000) {
            await ctx.replyWithVideo(
              new InputFile(videoResult.buffer, "video.mp4"),
              {
                caption: safeCaption,
                parse_mode: "HTML",
                reply_markup: feedbackKeyboard(),
              },
            );
          } else if (Buffer.isBuffer(videoResult.buffer) && videoResult.buffer.length > 500) {
            await ctx.replyWithPhoto(
              new InputFile(videoResult.buffer, "concept_frame.jpg"),
              {
                caption: `${safeCaption}\n\n<i>(Rendered as a cinematic storyboard concept frame)</i>`,
                parse_mode: "HTML",
                reply_markup: feedbackKeyboard(),
              },
            );
          } else {
            throw new Error("Natural video generation did not produce a valid buffer");
          }
          return;
        } catch (vidError) {
          logger.warn(
            { vidError: safeErrorMetadata(vidError) },
            "Natural video generation failed; falling back to conversational Gemini reply",
          );
          if (progressMsg) {
            await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
          }
          // Falls through to standard text reply
        }
      }

      // 4b. Natural Image Generation Intent (text-only):
      if (!media && adaptivePlan.detectedIntent === "image_generation" && adaptivePlan.imagePrompt) {
        await ctx.sendChatAction("upload_photo").catch(() => {});
        try {
          const imageResult = await ImageGenerationService.generate(
            adaptivePlan.imagePrompt,
            gemini,
          );

          await runStage(
            "user_message_save",
            { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
            () => conversations.addMessage(globalContextData.conversationId, "user", prompt),
          );
          await runStage(
            "model_response_save",
            { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
            () =>
              conversations.addMessage(
                globalContextData.conversationId,
                "model",
                `[Generated Image for: "${adaptivePlan.imagePrompt}"] Enhanced: "${imageResult.enhancedPrompt}"`,
              ),
          );

          const imageBadge = imageResult.provider === "huggingface" ? "<i>Engine: 🤗 Hugging Face (FLUX.1)</i>" : "<i>Engine: 🌐 Free Community (FLUX.1)</i>";
          const caption = [
            `<b>🎨 Prompt:</b> ${escapeHtml(imageResult.originalPrompt)}`,
            imageResult.enhancedPrompt.toLowerCase() !== imageResult.originalPrompt.toLowerCase()
              ? `<i>✨ Gemini Enhanced:</i> ${escapeHtml(imageResult.enhancedPrompt)}`
              : null,
            imageBadge,
          ]
            .filter(Boolean)
            .join("\n\n");

          const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;

          if (!Buffer.isBuffer(imageResult.buffer) || imageResult.buffer.length < 500) {
            throw new Error("Natural image generation did not produce a valid buffer");
          }

          await ctx.replyWithPhoto(
            new InputFile(imageResult.buffer, "image.jpg"),
            {
              caption: safeCaption,
              parse_mode: "HTML",
              reply_markup: feedbackKeyboard(),
            },
          );
          return;
        } catch (imgError) {
          logger.warn(
            { imgError: safeErrorMetadata(imgError) },
            "Natural image generation failed; falling back to conversational Gemini reply",
          );
          // Falls through to standard text reply
        }
      }

      // 5. Build dynamic placeholder message for live progressive streaming
      let initialPlaceholder = "💭 <i>Thinking...</i>";
      if (media?.mediaType === "voice" || media?.mediaType === "audio") {
        initialPlaceholder = "🎧 <i>Transcribing and understanding voice note...</i>";
      } else if (media?.mediaType === "image") {
        initialPlaceholder = "🔍 <i>Analyzing visual image...</i>";
      } else if (media?.mediaType === "document") {
        initialPlaceholder = `📄 <i>Reading document (${escapeHtml(media.fileName || "attachment")})...</i>`;
      }

      const streamingResponder = new StreamingResponder(ctx, {
        placeholderText: initialPlaceholder,
      });
      await streamingResponder.init();

      const reply = await runStage(
        "gemini_request",
        { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
        () =>
          gemini.generateReplyStream(
            globalContextData.recentHistory,
            prompt,
            {
              personalityInstruction: globalContextData.userProfile.personalityInstruction,
              modeInstruction: adaptivePlan.effectiveModeInstruction,
              memoryInstruction: globalContextData.promptInstruction || undefined,
            },
            {
              enableSearch: adaptivePlan.enableSearch,
              thinkingLevel: adaptivePlan.thinkingLevel,
              attachments: processedMedia
                ? [
                    {
                      mimeType: processedMedia.mimeType,
                      data: processedMedia.data,
                      fileName: processedMedia.fileName,
                    },
                  ]
                : undefined,
              hasAudio: media?.mediaType === "voice" || media?.mediaType === "audio",
              hasVisionOrDocument: media?.mediaType === "image" || media?.mediaType === "document",
              mediaSizeBytes: processedMedia?.sizeBytes,
            },
            async (accumulated) => {
              await streamingResponder.onChunk(accumulated);
            },
          ),
      );

      await runStage(
        "telegram_streaming_finalize",
        { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
        () => streamingResponder.finalize(reply),
      );

      // 6. Save message pair associated with user conversation
      const persistentUserMessage = media
        ? `[Attached ${media.mediaType}: ${media.fileName || media.reportedMime || "file"}]\n${prompt}`
        : prompt;

      await runStage(
        "user_message_save",
        { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
        () => conversations.addMessage(globalContextData.conversationId, "user", persistentUserMessage),
      );
      await runStage(
        "model_response_save",
        { telegramUserId: ctx.from.id, chatId: ctx.chat.id },
        () => conversations.addMessage(globalContextData.conversationId, "model", reply),
      );

      // Asynchronous passive memory acquisition (background fact extraction)
      void (async () => {
        try {
          const facts = await gemini.extractUserFacts(prompt);
          for (const fact of facts) {
            await conversations.saveUserMemory(
              ctx.from!.id,
              fact.key,
              fact.content,
              fact.category,
            );
            logger.info(
              {
                stage: "passive_memory_saved",
                telegramUserId: ctx.from!.id,
                key: fact.key,
                category: fact.category,
              },
              "Learned user personal memory from message context",
            );
          }
        } catch (error) {
          logger.debug(
            { stage: "passive_memory_extraction", error: safeErrorMetadata(error) },
            "Passive memory extraction completed without changes",
          );
        }
      })();
    } catch (error) {
      logger.error(
        {
          stage: "telegram_message_handling",
          telegramUserId: ctx.from.id,
          chatId: ctx.chat.id,
          error: safeErrorMetadata(error),
        },
        "Telegram message handling failed",
      );
      await ctx.reply(GENERIC_ERROR_MESSAGE).catch(() => {});
    } finally {
      stopTyping();
    }
  }

  bot.on("message:text", async (ctx) => {
    await handleIncomingTelegramMessage(ctx, {
      rawText: ctx.message.text,
    });
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const highestResPhoto = photos[photos.length - 1];
    await handleIncomingTelegramMessage(ctx, {
      rawText: ctx.message.caption,
      media: {
        fileId: highestResPhoto.file_id,
        mediaType: "image",
        reportedMime: "image/jpeg",
        fileSize: highestResPhoto.file_size,
      },
    });
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    await handleIncomingTelegramMessage(ctx, {
      rawText: ctx.message.caption,
      media: {
        fileId: doc.file_id,
        mediaType: "document",
        reportedMime: doc.mime_type,
        fileName: doc.file_name,
        fileSize: doc.file_size,
      },
    });
  });

  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;
    await handleIncomingTelegramMessage(ctx, {
      rawText: ctx.message.caption,
      media: {
        fileId: voice.file_id,
        mediaType: "voice",
        reportedMime: voice.mime_type || "audio/ogg",
        fileSize: voice.file_size,
      },
    });
  });

  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;
    await handleIncomingTelegramMessage(ctx, {
      rawText: ctx.message.caption,
      media: {
        fileId: audio.file_id,
        mediaType: "audio",
        reportedMime: audio.mime_type || "audio/mpeg",
        fileName: audio.file_name,
        fileSize: audio.file_size,
      },
    });
  });

  bot.catch((error) => {
    logger.error(
      {
        stage: "telegram_update",
        updateId: error.ctx.update.update_id,
        error: safeErrorMetadata(error.error),
      },
      "Telegram update failed",
    );
  });

  // Wire up the asynchronous worker queue handler
  telegramWorkerQueue.setUpdateHandler(async (update) => {
    if (!bot.isInited()) {
      await bot.init();
    }
    await bot.handleUpdate(update);
  });

  return {
    bot,
    async start() {
      if (!bot.isInited()) {
        try {
          await bot.init();
        } catch (err) {
          logger.warn({ error: safeErrorMetadata(err) }, "Failed to initialize bot during start()");
        }
      }
      reminderScheduler.start(bot);
      if (config.usePolling) {
        await bot.api.deleteWebhook();
        await bot.start({
          onStart: (botInfo) => {
            logger.info(
              { username: botInfo.username, model: config.geminiModel },
              "Telegram polling started",
            );
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
      reminderScheduler.stop();
      await telegramWorkerQueue.drain(3000);
      await bot.stop();
      logger.info("Telegram bot stopped");
    },
    mountWebhook(app) {
      // Metrics endpoint for real-time queue observability
      app.get("/api/telegram/queue-metrics", (_req: Request, res: Response) => {
        res.json({
          status: "ok",
          workerQueue: telegramWorkerQueue.getMetrics(),
        });
      });

      if (config.usePolling) return;

      // Webhook Ingestion + Asynchronous Worker Queue (Fast-Ack pattern)
      app.post("/api/telegram/webhook", (req: Request, res: Response) => {
        // 1. Verify secret token if configured
        if (config.telegramWebhookSecret) {
          const secretHeader = req.header("X-Telegram-Bot-Api-Secret-Token");
          if (secretHeader !== config.telegramWebhookSecret) {
            logger.warn("Telegram webhook received update with invalid secret token");
            res.status(403).json({ error: "Unauthorized" });
            return;
          }
        }

        // 2. Validate payload structure
        const update = req.body;
        if (!update || typeof update !== "object" || typeof update.update_id !== "number") {
          res.status(400).json({ error: "Invalid Telegram update payload" });
          return;
        }

        // 3. Fast-Ack: Immediately return 200 OK to Telegram in <5ms to prevent timeout retries
        res.status(200).json({ ok: true });

        // 4. Enqueue into the adaptive concurrency worker pool
        try {
          telegramWorkerQueue.enqueue(update);
        } catch (err) {
          logger.error({ error: safeErrorMetadata(err), updateId: update.update_id }, "Failed to enqueue update");
        }
      });
    },
  };
}