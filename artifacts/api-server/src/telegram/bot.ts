import { Bot, Context, InlineKeyboard, InputFile, webhookCallback } from "grammy";
import type { Express, Request, Response } from "express";
import { chatDatabaseService } from "@workspace/db";
import { logger } from "../lib/logger";
import { getConfig } from "../config/env";
import { MODES, MODE_KEYS, isModeKey, type ModeKey } from "../config/mode";
import { ConversationService } from "../services/conversation.service";
import { ModeService } from "../services/mode.service";
import { ExecutionPlannerService } from "../services/execution-planner.service";
import { GlobalContextService } from "../services/global-context.service";
import { GeminiService, type GeminiMessage } from "../gemini/gemini.service";
import { AdaptiveIntentService } from "../services/adaptive-intent.service";
import { ImageGenerationService } from "../services/image-generation.service";
import { VideoGenerationService } from "../services/video-generation.service";
import { MediaProcessorService, type ProcessedMedia } from "../services/media-processor.service";
import { RateLimitService } from "../services/rate-limit.service";
import { isAuthorizedTelegramUser } from "../services/authorization.service";
import { telegramWorkerQueue } from "../services/worker-queue.service";
import { splitTelegramMessage } from "../utils/split-message";
import { formatTelegramMessage, stripTelegramHtml } from "../utils/telegram-formatter";
import { safeErrorMetadata } from "../utils/safe-error";
import { startTypingIndicator } from "./typing-indicator";
import { interactionPresentationService } from "./interaction-presentation-service";
import {
  PERSONALITIES,
  PERSONALITY_KEYS,
  isPersonalityKey,
  type PersonalityKey,
} from "../config/personality";
import { memoryService } from "../services/memory.service";
import { taskService } from "../services/task.service";
import { userTierService } from "../services/user-tier.service";
import { personaService } from "../services/persona.service";
import { contextManagerService } from "../services/context-manager.service";
import {
  feedbackKeyboard,
  feedbackReasonKeyboard,
  helpKeyboard,
  mainMenuKeyboard,
  memoriesKeyboard,
  modeKeyboard,
  personaKeyboard,
  personalityKeyboard,
  remindersKeyboard,
  settingsKeyboard,
  tasksKeyboard,
  taskDisambiguationKeyboard,
  executionApprovalKeyboard,
} from "./keyboards";
import { executionEngine } from "../execution/execution-engine";
import { getExecutionConfig } from "../execution/config";
import { executionPersistence } from "../execution/persistence/execution-persistence.service";
import { agentPlannerService } from "../planner/agent-planner.service";
import { SemanticInteractionResolverService } from "../services/semantic-interaction-resolver.service";
import { requestRegistryService } from "../services/request-registry.service";
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
  formatPersonasMenuText,
  modeText,
  personalityText,
} from "./navigation";
import {
  ReminderService,
  reminderScheduler,
  reminderService,
} from "../services/reminder.service";
import { StreamingResponder } from "./streaming-responder";
import { onboardingService } from "../services/onboarding.service";
import { registerOnboardingHandlers, startOnboarding } from "./onboarding";

const PRIVATE_MESSAGE = "Sorry, this bot is currently private.";
const GENERIC_ERROR_MESSAGE =
  "I’m sorry, I couldn’t complete that request right now. Please try again in a moment.";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const modeService = new ModeService(conversations);
  const executionPlanner = new ExecutionPlannerService(modeService);
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

  const requireAuthorized = async (ctx: Context): Promise<boolean> => {
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

  const personalityMenu = async (ctx: Context): Promise<void> => {
    if (!ctx.from) return;
    await upsertUser(ctx);
    const current = await conversations.getUserPersonality(ctx.from.id);
    await ctx.reply(personalityText(current), { reply_markup: personalityKeyboard(current) });
  };

  const modeMenu = async (ctx: Context): Promise<void> => {
    if (!ctx.from) return;
    await upsertUser(ctx);
    const current = await conversations.getUserMode(ctx.from.id);
    await ctx.reply(modeText(current), { reply_markup: modeKeyboard(current) });
  };

  const personaMenu = async (ctx: Context): Promise<void> => {
    if (!ctx.from) return;
    await upsertUser(ctx);
    const [personas, currentRes, tierProfile] = await Promise.all([
      personaService.getAllPersonas(),
      personaService.getUserActivePersona(ctx.from.id),
      userTierService.getUserTierProfile(ctx.from.id),
    ]);
    const text = formatPersonasMenuText(personas, currentRes.persona, tierProfile.tier);
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: personaKeyboard(personas, currentRes.persona.id, tierProfile.tier),
    });
  };

  const clearConversation = async (ctx: Context): Promise<void> => {
    if (!ctx.from || !ctx.chat) return;
    await conversations.clearConversation(ctx.from.id, ctx.chat.id);
    rateLimiter.clear(ctx.from.id);
    await ctx.reply("Your conversation history has been cleared.", {
      reply_markup: mainMenuKeyboard(),
    });
  };

  registerOnboardingHandlers(bot, {
    authorized,
    upsertUser,
    conversations,
    modeService,
  });

  bot.command("start", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    await startOnboarding(ctx, { authorized, upsertUser, conversations, modeService });
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
      "🔒 <b>All personal data purged.</b>\n\nYour user profile, conversations, long-term memories, and active reminders have been completely removed from the database in compliance with GDPR cascading deletion.",
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
      if (summary) await conversations.setSessionSummary(conversationId, summary);
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
    await ctx.reply(formatMemoriesMenuText(memories), { reply_markup: memoriesKeyboard(memories) });
  });

  bot.command("remember", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawText = ctx.match?.trim();
    if (!rawText) {
      await ctx.reply("Please provide what you want me to remember.\n\nExamples:\n/remember stack: TypeScript, PostgreSQL\n/remember I prefer concise bullet points");
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
      if (/\b(prefer|like)\b/i.test(rawText)) category = "preference";
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

  bot.command(["tasks", "task"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const activeTasks = await taskService.getActiveTasksForUser(ctx.from.id);
    let messageText = "<b>🎯 Active Tasks & Workflows</b>\n\n";
    if (activeTasks.length === 0) {
      messageText += "No active tasks currently running.\nTo start a task, say e.g.:\n<i>'Start a task to write a market analysis report'</i>";
    } else {
      const taskLines = [];
      for (const t of activeTasks) {
        const steps = await chatDatabaseService.getTaskSteps(t.id);
        const derived = taskService.deriveCurrentStep(steps);
        if (derived.currentStep !== t.currentStep) {
          await chatDatabaseService.updateTask(t.id, { currentStep: derived.currentStep });
          t.currentStep = derived.currentStep;
        }
        taskLines.push(`• <b>#${t.id}</b>: ${escapeHtml(t.title)}\n  Status: <code>${t.status.toUpperCase()}</code> | Step ${t.currentStep}`);
      }
      messageText += taskLines.join("\n\n");
    }
    await ctx.reply(messageText, { reply_markup: tasksKeyboard(activeTasks) });
  });

  bot.callbackQuery(/^task:(view|cancel|continue):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const action = ctx.match[1];
    const taskId = parseInt(ctx.match[2], 10);
    await ctx.answerCallbackQuery();
    if (action === "cancel") {
      await taskService.updateTaskStatus(taskId, "cancelled");
      await ctx.reply(`❌ Task #${taskId} has been cancelled.`);
    } else if (action === "continue" || action === "view") {
      const activeTasks = await taskService.getActiveTasksForUser(ctx.from.id);
      const target = activeTasks.find((t) => t.id === taskId);
      if (target) {
        await ctx.reply(`▶️ <b>Task #${target.id}: ${escapeHtml(target.title)}</b>\nGoal: ${escapeHtml(target.goal)}\nStatus: <code>${target.status.toUpperCase()}</code> | Current Step: ${target.currentStep}`, { parse_mode: "HTML" });
      }
    }
  });

  bot.command(["reminders", "reminder"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const active = await reminderService.getActiveUserReminders(ctx.from.id);
    await ctx.reply(formatRemindersMenuText(active), { parse_mode: "Markdown", reply_markup: remindersKeyboard(active) });
  });

  bot.command("remind", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const rawInput = ctx.match?.trim();
    if (!rawInput) {
      await ctx.reply("Please provide a time and task description.\n\nExamples:\n• /remind in 15 mins to check deploy\n• /remind tomorrow at 9am standup meeting\n• /remind tonight at 8pm call team");
      return;
    }
    const parsed = ReminderService.parseNaturalReminder(`remind me ${rawInput}`);
    if (!parsed) {
      await ctx.reply("Could not parse that reminder time.\nTry formats like:\n• /remind in 20 minutes <task>\n• /remind tomorrow at 10am <task>\n• /remind at 4:30 pm <task>");
      return;
    }
    const created = await reminderService.createReminder({ telegramUserId: ctx.from.id, chatId: ctx.chat.id, prompt: parsed.prompt, dueAt: parsed.dueAt });
    await ctx.reply(`⏰ <b>Reminder scheduled!</b>\n\n📌 <b>Task:</b> ${escapeHtml(parsed.prompt)}\n🕒 <b>Due:</b> ${parsed.humanReadableTime}`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("❌ Cancel", `rem_cancel:${created.id}`),
    });
  });

  bot.command(["tier", "quota", "account", "plan"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    try {
      const policy = await userTierService.getPolicy();
      const stats = await userTierService.checkAndRecordUsage(ctx.from.id, {
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
      const cfg = policy.tiers[stats.tier] || policy.tiers.free;
      const tierIcon = stats.tier === "vip" ? "👑" : stats.tier === "pro" ? "⚡" : "🌱";
      const isUnlimited = stats.tier === "vip" || stats.dailyQuota < 0 || stats.dailyQuota >= 999999;
      const quotaDisplay = isUnlimited
        ? "<b>Daily Quota:</b> Unlimited ✨"
        : `<b>Daily Quota:</b> ${stats.requestsToday} / ${stats.dailyQuota} used (${stats.remainingToday} remaining)`;

      const lines = [
        `<b>${tierIcon} Your Account Tier: ${escapeHtml(cfg.label)}</b>`,
        ``,
        `• ${quotaDisplay}`,
        `• <b>Routing Class:</b> ${escapeHtml(cfg.targetModelClass)}`,
        `• <b>Speed & Priority:</b> ${escapeHtml(cfg.speed)}`,
        `• <b>Status:</b> ${stats.status === "active" ? "Active ✅" : stats.status}`,
        stats.customModelOverride ? `• <b>Assigned Model Override:</b> <code>${escapeHtml(stats.customModelOverride)}</code>` : null,
        ``,
        `<i>Daily quotas automatically reset at midnight UTC. Contact your administrator to adjust tiers or models.</i>`,
      ].filter(Boolean);

      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } catch (err) {
      logger.error({ error: safeErrorMetadata(err) }, "Failed to fetch user tier status in Telegram command");
      await ctx.reply("⚠️ Could not retrieve account tier details right now. Please try again later.");
    }
  });

  bot.command("search", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply("Please provide a search topic or question.\nExample: /search Google I/O latest announcements");
      return;
    }
    const stopTyping = startTypingIndicator(ctx, { state: "searching", operationLabel: "web search", userFacingProgress: false });
    try {
      const globalContextData = await globalContext.getContextForCompletion({ telegramUserId: ctx.from.id, chatId: ctx.chat.id, userProfile: { id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name }, maxHistoryMessages: config.maxHistoryMessages, message: query, geminiService: gemini });
      const reply = await gemini.generateReply(globalContextData.recentHistory, query, {
        personalityInstruction: globalContextData.userProfile.personalityInstruction,
        modeInstruction: MODES.research.instruction,
        memoryInstruction: globalContextData.promptInstruction || undefined,
        personaInstruction: globalContextData.activePersona?.systemPrompt,
        personaName: globalContextData.activePersona?.name,
        personaEmoji: globalContextData.activePersona?.emoji,
      }, {
        enableSearch: true,
        personaPreferredModel: globalContextData.activePersona?.preferredModel,
        temperature: globalContextData.activePersona?.temperature,
      });
      await conversations.addMessage(globalContextData.conversationId, "user", `/search ${query}`);
      await conversations.addMessage(globalContextData.conversationId, "model", reply);
      const chunks = splitTelegramMessage(reply).map((chunk, idx) => formatTelegramMessage(chunk, { telegramUserId: ctx.from?.id, chunkIndex: idx, source: "bot.search_command" }));
      for (const [index, chunk] of chunks.entries()) await ctx.reply(chunk, { parse_mode: "HTML", reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined }).catch(async () => ctx.reply(stripTelegramHtml(chunk), { reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined }));
    } catch (error) {
      logger.error({ stage: "search_command", error: safeErrorMetadata(error) }, "Search failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE);
    } finally { stopTyping(); }
  });

  bot.command("think", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const query = ctx.match?.trim();
    if (!query) {
      await ctx.reply("Please provide a problem to reason through.\nExample: /think Design a distributed idempotency lock in Redis");
      return;
    }
    const stopTyping = startTypingIndicator(ctx, { state: "reasoning", operationLabel: "reasoning", userFacingProgress: false });
    try {
      const globalContextData = await globalContext.getContextForCompletion({ telegramUserId: ctx.from.id, chatId: ctx.chat.id, userProfile: { id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name }, maxHistoryMessages: config.maxHistoryMessages, message: query, geminiService: gemini });
      const reply = await gemini.generateReply(globalContextData.recentHistory, query, {
        personalityInstruction: globalContextData.userProfile.personalityInstruction,
        modeInstruction: MODES.reasoning.instruction,
        memoryInstruction: globalContextData.promptInstruction || undefined,
        personaInstruction: globalContextData.activePersona?.systemPrompt,
        personaName: globalContextData.activePersona?.name,
        personaEmoji: globalContextData.activePersona?.emoji,
      }, {
        thinkingLevel: "LOW",
        personaPreferredModel: globalContextData.activePersona?.preferredModel,
        temperature: globalContextData.activePersona?.temperature,
      });
      await conversations.addMessage(globalContextData.conversationId, "user", `/think ${query}`);
      await conversations.addMessage(globalContextData.conversationId, "model", reply);
      const chunks = splitTelegramMessage(reply).map((chunk, idx) => formatTelegramMessage(chunk, { telegramUserId: ctx.from?.id, chunkIndex: idx, source: "bot.think_command" }));
      for (const [index, chunk] of chunks.entries()) await ctx.reply(chunk, { parse_mode: "HTML", reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined }).catch(async () => ctx.reply(stripTelegramHtml(chunk), { reply_markup: index === chunks.length - 1 ? feedbackKeyboard() : undefined }));
    } catch (error) {
      logger.error({ stage: "think_command", error: safeErrorMetadata(error) }, "Thinking mode failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE);
    } finally { stopTyping(); }
  });

  bot.command(["image", "draw", "img"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const rawPrompt = ctx.match?.trim();
    if (!rawPrompt) {
      await ctx.reply("Please provide a prompt for the image!\nExample: /image a cybernetic tiger walking through rainy neon Tokyo, 8k render");
      return;
    }
    if (!await rateLimiter.consumeAsync(ctx.from.id)) {
      await ctx.reply("You’re sending requests a little too quickly. Please wait a moment and try again.");
      return;
    }
    const stopPresence = startTypingIndicator(ctx, { state: "generating", toolName: "image_generation", operationLabel: "image generation", chatAction: "upload_photo", userFacingProgress: false });
    try {
      const result = await ImageGenerationService.generate(rawPrompt, gemini);
      const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
      await conversations.addMessage(conversationId, "user", `/image ${rawPrompt}`);
      await conversations.addMessage(conversationId, "model", `[Generated Image for: "${rawPrompt}"] Enhanced: "${result.enhancedPrompt}"`);
      const imageBadge = result.provider === "huggingface" ? "<i>Engine: 🤗 Hugging Face (FLUX.1)</i>" : "<i>Engine: 🌐 Free Community (FLUX.1)</i>";
      const enhancerTag = result.enhancerName ? `<i>✨ Enhanced (${escapeHtml(result.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
      const caption = [`<b>🎨 Prompt:</b> ${escapeHtml(result.originalPrompt)}`, result.enhancedPrompt.toLowerCase() !== result.originalPrompt.toLowerCase() ? `${enhancerTag} ${escapeHtml(result.enhancedPrompt)}` : null, imageBadge].filter(Boolean).join("\n\n");
      const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;
      if (!result?.buffer || !Buffer.isBuffer(result.buffer) || result.buffer.length < 500) throw new Error("Image generation did not produce a valid image buffer");
      await ctx.replyWithPhoto(new InputFile(result.buffer, "image.jpg"), { caption: safeCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
    } catch (error) {
      logger.error({ stage: "image_generation", error: safeErrorMetadata(error) }, "Image generation failed");
      await ctx.reply("Sorry, I encountered an issue generating that image. Please try again or rephrase your prompt.");
    } finally { stopPresence(); }
  });

  bot.command(["video", "vid", "clip"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    await upsertUser(ctx);
    const rawPrompt = ctx.match?.trim();
    if (!rawPrompt) {
      await ctx.reply("Please provide a prompt for the video!\nExample: /video a golden retriever running along a sunny beach, slow motion cinematography");
      return;
    }
    if (!await rateLimiter.consumeAsync(ctx.from.id)) {
      await ctx.reply("You’re sending requests a little too quickly. Please wait a moment and try again.");
      return;
    }
    const stopPresence = startTypingIndicator(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: false });
    let progressMsg: number | undefined;
    try {
      progressMsg = await interactionPresentationService.renderProgress(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, elapsedMs: 0 });
      const startedAt = Date.now();
      const result = await VideoGenerationService.generate(rawPrompt, gemini);
      const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
      await conversations.addMessage(conversationId, "user", `/video ${rawPrompt}`);
      await conversations.addMessage(conversationId, "model", `[Generated Visual (${result.provider}) for: "${rawPrompt}"] Enhanced: "${result.enhancedPrompt}"`);
      const providerBadge = result.provider === "huggingface" ? "🤗 Hugging Face" : "🌐 Free Community";
      const enhancerTag = result.enhancerName ? `<i>✨ Enhanced (${escapeHtml(result.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
      const caption = [`<b>🎬 Prompt:</b> ${escapeHtml(result.originalPrompt)}`, result.enhancedPrompt.toLowerCase() !== result.originalPrompt.toLowerCase() ? `${enhancerTag} ${escapeHtml(result.enhancedPrompt)}` : null, `<i>Engine: ${providerBadge}</i>`].filter(Boolean).join("\n\n");
      const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;
      if (progressMsg) await ctx.api.deleteMessage(ctx.chat.id, progressMsg).catch(() => {});
      if (result.isVideo && Buffer.isBuffer(result.buffer) && result.buffer.length > 1000) {
        await ctx.replyWithVideo(new InputFile(result.buffer, "video.mp4"), { caption: safeCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
      } else if (Buffer.isBuffer(result.buffer) && result.buffer.length > 500) {
        await ctx.replyWithPhoto(new InputFile(result.buffer, "storyboard.jpg"), { caption: `${safeCaption}\n\n<i>(Rendered as a cinematic storyboard concept frame)</i>`, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
      } else throw new Error("Video service did not produce a valid visual buffer");
      logger.info({ stage: "video_generation", elapsedMs: Date.now() - startedAt }, "Video generation completed");
    } catch (error) {
      logger.error({ stage: "video_generation", error: safeErrorMetadata(error) }, "Video generation failed");
      if (progressMsg) await ctx.api.deleteMessage(ctx.chat.id, progressMsg).catch(() => {});
      await ctx.reply("Sorry, I encountered an issue generating that visual. Please try again.");
    } finally { stopPresence(); }
  });

  bot.command("personality", async (ctx) => { if (!(await requireAuthorized(ctx))) return; await personalityMenu(ctx); });
  bot.command(["persona", "personas", "agent", "agents"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawArg = ctx.match?.trim();
    if (rawArg) {
      const switchRes = await personaService.switchUserPersona(ctx.from.id, rawArg);
      if (switchRes.success && switchRes.persona) {
        const p = switchRes.persona;
        const msg = [
          `✅ <b>Persona Activated: ${p.emoji} ${p.name}</b>`,
          "",
          `<i>${p.tagline}</i>`,
          "",
          `🎯 <b>Specialty:</b> ${p.description || p.tagline}`,
          p.preferredModel ? `🧠 <b>Preferred Engine:</b> <code>${p.preferredModel}</code>` : "",
          `🌡️ <b>Creativity:</b> <code>${p.temperature}</code>`,
          "",
          "All subsequent replies will now adapt to this persona's tone, instructions, and routing.",
        ].filter(Boolean).join("\n");
        const personas = await personaService.getAllPersonas();
        const tier = await userTierService.getUserTier(ctx.from.id);
        await ctx.reply(msg, { parse_mode: "HTML", reply_markup: personaKeyboard(personas, p.id, tier) });
      } else {
        const errorMsg = switchRes.error || "Persona not found.";
        const personas = await personaService.getAllPersonas();
        const current = (await personaService.getUserActivePersona(ctx.from.id)).persona;
        const tier = await userTierService.getUserTier(ctx.from.id);
        await ctx.reply(`⚠️ ${errorMsg}\n\nSelect an available persona below:`, {
          parse_mode: "HTML",
          reply_markup: personaKeyboard(personas, current.id, tier),
        });
      }
      return;
    }
    await personaMenu(ctx);
  });
  bot.command("mode", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const rawArg = ctx.match?.trim();
    if (rawArg) {
      try {
        const result = await modeService.switchMode(ctx.from.id, rawArg, "command");
        await ctx.reply(result.confirmationMessage, { parse_mode: "HTML", reply_markup: modeKeyboard(result.activeMode) });
      } catch {
        const currentMode = await conversations.getUserMode(ctx.from.id);
        await ctx.reply(`⚠️ Invalid or unrecognized mode: "${escapeHtml(rawArg)}".\n\nAvailable modes:\n• general\n• study\n• coding\n• research\n• reasoning\n• writing\n• brainstorming\n• travel`, { reply_markup: modeKeyboard(currentMode) });
      }
      return;
    }
    await modeMenu(ctx);
  });

  bot.command("status", async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    const [userContext, activePersonaRes] = await Promise.all([
      conversations.getUserWithFullContext(ctx.from.id),
      personaService.getUserActivePersona(ctx.from.id),
    ]);
    const personalityKey = (userContext?.personality as PersonalityKey) || "playful";
    const modeKey = (userContext?.mode as ModeKey) || "general";
    const personality = isPersonalityKey(personalityKey) ? personalityKey : "playful";
    const mode = isModeKey(modeKey) ? modeKey : "general";
    const activeReminders = userContext?.reminders?.length ?? 0;
    const memoryCount = userContext?.memories?.length ?? 0;
    const activeSessions = userContext?.conversations?.length ?? 0;
    const activePersona = activePersonaRes.persona;
    await ctx.reply([
      "🤖 <b>Bot status:</b> online",
      "⚡ <b>Gemini status:</b> configured",
      `🧠 <b>Current model:</b> ${config.geminiModel}`,
      `🎭 <b>Active Persona:</b> ${activePersona.emoji} ${activePersona.name}`,
      `💬 <b>Active sessions:</b> ${activeSessions}`,
      `📚 <b>Long-term memories:</b> ${memoryCount} saved`,
      `⏰ <b>Pending reminders:</b> ${activeReminders}`,
      `🎨 <b>Personality:</b> ${PERSONALITIES[personality].label}`,
      `🎯 <b>Assistant mode:</b> ${MODES[mode].label}`,
    ].join("\n"), { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery(/^menu:(main|chat|personas|memory|modes|voice|reminders|settings|help)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; }
    const destination = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (destination === "main") await ctx.editMessageText(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
    else if (destination === "chat") await ctx.editMessageText(CHAT_TEXT, { reply_markup: mainMenuKeyboard() });
    else if (destination === "personas") {
      await upsertUser(ctx);
      const [personas, currentRes, tierProfile] = await Promise.all([
        personaService.getAllPersonas(),
        personaService.getUserActivePersona(ctx.from.id),
        userTierService.getUserTierProfile(ctx.from.id),
      ]);
      const text = formatPersonasMenuText(personas, currentRes.persona, tierProfile.tier);
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: personaKeyboard(personas, currentRes.persona.id, tierProfile.tier),
      });
    }
    else if (destination === "memory") { await upsertUser(ctx); const memories = await conversations.getUserMemories(ctx.from.id); await ctx.editMessageText(formatMemoriesMenuText(memories), { reply_markup: memoriesKeyboard(memories) }); }
    else if (destination === "modes") { await upsertUser(ctx); const current = await conversations.getUserMode(ctx.from.id); await ctx.editMessageText(modeText(current), { reply_markup: modeKeyboard(current) }); }
    else if (destination === "voice") await ctx.editMessageText(VOICE_TEXT, { reply_markup: new InlineKeyboard().text("◀️ Back", "menu:main") });
    else if (destination === "reminders") { await upsertUser(ctx); const active = await reminderService.getActiveUserReminders(ctx.from.id); await ctx.editMessageText(formatRemindersMenuText(active), { parse_mode: "Markdown", reply_markup: remindersKeyboard(active) }); }
    else if (destination === "settings") await ctx.editMessageText(SETTINGS_TEXT, { reply_markup: settingsKeyboard() });
    else await ctx.editMessageText(HELP_TEXT, { reply_markup: helpKeyboard() });
  });

  bot.callbackQuery(/^persona:select:([a-zA-Z0-9_\-]+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const targetPersonaId = ctx.match[1];
    const switchRes = await personaService.switchUserPersona(ctx.from.id, targetPersonaId);
    if (switchRes.success && switchRes.persona) {
      await ctx.answerCallbackQuery({ text: `Activated: ${switchRes.persona.emoji} ${switchRes.persona.name}` });
      const [personas, tierProfile] = await Promise.all([
        personaService.getAllPersonas(),
        userTierService.getUserTierProfile(ctx.from.id),
      ]);
      const text = formatPersonasMenuText(personas, switchRes.persona, tierProfile.tier);
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: personaKeyboard(personas, switchRes.persona.id, tierProfile.tier),
      });
    } else {
      await ctx.answerCallbackQuery({
        text: switchRes.error?.replace(/<[^>]+>/g, "") || "Could not switch persona",
        show_alert: true,
      });
    }
  });
  bot.callbackQuery(/^rem_done:(\d+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const reminderId = parseInt(ctx.match[1], 10); await reminderService.completeReminder(reminderId, ctx.from.id); await ctx.answerCallbackQuery({ text: "✅ Marked reminder as done!" }); await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ Completed", "feedback:no-op") }); });
  bot.callbackQuery(/^rem_snooze:(\d+):(\d+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const reminderId = parseInt(ctx.match[1], 10); const minutes = parseInt(ctx.match[2], 10) || 10; const updated = await reminderService.snoozeReminder(reminderId, minutes, ctx.from.id); if (updated) { const timeStr = updated.dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); await ctx.answerCallbackQuery({ text: `⏰ Snoozed for ${minutes}m (until ${timeStr})` }); await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`⏰ Snoozed until ${timeStr}`, "feedback:no-op") }); } else await ctx.answerCallbackQuery({ text: "Reminder not found or already completed." }); });
  bot.callbackQuery(/^rem_cancel:(\d+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const reminderId = parseInt(ctx.match[1], 10); await reminderService.cancelReminder(reminderId, ctx.from.id); await ctx.answerCallbackQuery({ text: "❌ Reminder cancelled." }); const active = await reminderService.getActiveUserReminders(ctx.from.id); await ctx.editMessageText(formatRemindersMenuText(active), { parse_mode: "Markdown", reply_markup: remindersKeyboard(active) }).catch(async () => ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("❌ Cancelled", "feedback:no-op") })); });
  bot.callbackQuery(/^memory:delete:(.+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const key = ctx.match[1]; await conversations.deleteUserMemory(ctx.from.id, key); await ctx.answerCallbackQuery({ text: `Deleted memory: ${key}` }); const memories = await conversations.getUserMemories(ctx.from.id); await ctx.editMessageText(formatMemoriesMenuText(memories), { reply_markup: memoriesKeyboard(memories) }); });
  bot.callbackQuery("memory:clear_all", async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } await conversations.clearUserMemories(ctx.from.id); await ctx.answerCallbackQuery({ text: "All long-term memories cleared." }); const memories = await conversations.getUserMemories(ctx.from.id); await ctx.editMessageText(formatMemoriesMenuText(memories), { reply_markup: memoriesKeyboard(memories) }); });
  bot.callbackQuery("settings:personality", async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } await upsertUser(ctx); const current = await conversations.getUserPersonality(ctx.from.id); await ctx.answerCallbackQuery(); await ctx.editMessageText(personalityText(current), { reply_markup: personalityKeyboard(current) }); });
  bot.callbackQuery("settings:mode", async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } await upsertUser(ctx); const current = await conversations.getUserMode(ctx.from.id); await ctx.answerCallbackQuery(); await ctx.editMessageText(modeText(current), { reply_markup: modeKeyboard(current, "menu:settings") }); });
  bot.callbackQuery(/^personality:(playful|balanced|focused|professional)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const personality = ctx.match[1] as PersonalityKey; await upsertUser(ctx); await conversations.setUserPersonality(ctx.from.id, personality); await ctx.answerCallbackQuery({ text: `${PERSONALITIES[personality].label} selected` }); await ctx.editMessageText(personalityText(personality), { reply_markup: personalityKeyboard(personality) }); });
  bot.callbackQuery(/^mode:(.+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const modeRaw = ctx.match[1]; await upsertUser(ctx); try { const result = await modeService.switchMode(ctx.from.id, modeRaw, "callback"); await ctx.answerCallbackQuery({ text: `${result.profile.label} active` }); await ctx.editMessageText(result.confirmationMessage, { parse_mode: "HTML", reply_markup: modeKeyboard(result.activeMode) }).catch(() => {}); } catch { await ctx.answerCallbackQuery({ text: "Error switching mode", show_alert: true }); } });
  bot.callbackQuery("action:clear", async (ctx) => { if (!ctx.from || !ctx.chat || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } await conversations.clearConversation(ctx.from.id, ctx.chat.id); rateLimiter.clear(ctx.from.id); await ctx.answerCallbackQuery({ text: "Conversation cleared" }); await ctx.editMessageText("Your conversation history has been cleared.", { reply_markup: mainMenuKeyboard() }); });
  bot.callbackQuery("feedback:helpful", async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } logger.info({ telegramUserId: ctx.from.id, feedback: "helpful" }, "Assistant feedback received"); await ctx.answerCallbackQuery({ text: "Thanks for the feedback!" }); await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ Helpful — thanks!", "feedback:no-op") }); });
  bot.callbackQuery("feedback:not_quite", async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } await ctx.answerCallbackQuery({ text: "What should I improve?" }); await ctx.editMessageReplyMarkup({ reply_markup: feedbackReasonKeyboard() }); });
  bot.callbackQuery(/^feedback:reason:(too_long|incorrect|unclear|tone|other)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } logger.info({ telegramUserId: ctx.from.id, feedback: ctx.match[1] }, "Assistant feedback reason received"); await ctx.answerCallbackQuery({ text: "Thanks — I’ll keep that in mind." }); await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ Feedback received", "feedback:no-op") }); });
  bot.callbackQuery("feedback:no-op", async (ctx) => { await ctx.answerCallbackQuery(); });
  bot.callbackQuery(/^exec_appr:(.+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const approvalId = ctx.match[1]; await ctx.answerCallbackQuery({ text: "Processing approval..." }); try { const result = await executionEngine.submitApproval(approvalId, ctx.from.id, true); if (result.success) await ctx.editMessageText(`✅ <b>Approval Granted</b>\nExecution resumed for plan <code>${result.graphId}</code> (revision ${result.planRevision}).`, { parse_mode: "HTML" }); else await ctx.reply(`⚠️ Approval submission failed: ${result.error}`); } catch (err: any) { await ctx.reply(`⚠️ Approval failed: ${err.message}`); } });
  bot.callbackQuery(/^exec_rejc:(.+)$/, async (ctx) => { if (!ctx.from || !authorized(ctx.from.id)) { await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true }); return; } const approvalId = ctx.match[1]; await ctx.answerCallbackQuery({ text: "Processing rejection..." }); try { const result = await executionEngine.submitApproval(approvalId, ctx.from.id, false); if (result.success) await ctx.editMessageText(`❌ <b>Execution Rejected</b>\nPlan <code>${result.graphId}</code> has been cancelled.`, { parse_mode: "HTML" }); else await ctx.reply(`⚠️ Rejection submission failed: ${result.error}`); } catch (err: any) { await ctx.reply(`⚠️ Rejection failed: ${err.message}`); } });

  async function handleIncomingTelegramMessage(ctx: Context, payload: { rawText?: string; media?: { fileId: string; mediaType: "image" | "document" | "voice" | "audio"; reportedMime?: string; fileName?: string; fileSize?: number; }; }) {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from || !ctx.chat) return;
    if (!await rateLimiter.consumeAsync(ctx.from.id)) { await ctx.reply("You’re sending messages a little too quickly. Please wait a moment and try again."); return; }
    const { rawText, media } = payload;
    if (!media && (!rawText || !rawText.trim())) { await ctx.reply("Please send a message with some text or attach an image, document, or voice note."); return; }

    const quotaCheck = await userTierService.checkAndRecordUsage(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
    if (!quotaCheck.allowed) {
      await ctx.reply(quotaCheck.message || "⏳ Daily quota exceeded. Please contact the administrator.");
      return;
    }

    const prompt = MediaProcessorService.buildMultimodalPrompt(rawText, media?.mediaType, media?.fileName);

    if (!media && rawText) {
      const naturalReminder = ReminderService.parseNaturalReminder(rawText);
      if (naturalReminder) {
        try {
          const created = await reminderService.createReminder({ telegramUserId: ctx.from.id, chatId: ctx.chat.id, prompt: naturalReminder.prompt, dueAt: naturalReminder.dueAt });
          await ctx.reply(`⏰ <b>Reminder scheduled!</b>\n\n📌 <b>Task:</b> ${escapeHtml(naturalReminder.prompt)}\n🕒 <b>Due:</b> ${naturalReminder.humanReadableTime}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("❌ Cancel", `rem_cancel:${created.id}`) });
          return;
        } catch (err) { logger.warn({ error: safeErrorMetadata(err) }, "Failed saving natural reminder"); }
      }
    }

    const stopTyping = startTypingIndicator(ctx, { state: "understanding", operationLabel: media ? "incoming media" : "request interpretation", userFacingProgress: false });
    try {
      let processedMedia: ProcessedMedia | undefined;
      if (media) {
        try { processedMedia = await MediaProcessorService.downloadTelegramMedia(ctx.api, config.telegramBotToken, media.fileId, { expectedType: media.mediaType, reportedMime: media.reportedMime, fileName: media.fileName }); }
        catch (mediaErr) { logger.error({ error: safeErrorMetadata(mediaErr), mediaType: media.mediaType }, "Failed downloading Telegram media for multimodal processing"); await ctx.reply("⚠️ Sorry, I could not download the attached media from Telegram. Please try sending it again."); return; }
      }

      const globalContextData = await runStage("global_context_retrieval", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => globalContext.getContextForCompletion({ telegramUserId: ctx.from!.id, chatId: ctx.chat!.id, userProfile: { id: ctx.from!.id, username: ctx.from!.username, firstName: ctx.from!.first_name, lastName: ctx.from!.last_name }, maxHistoryMessages: config.maxHistoryMessages, message: prompt, geminiService: gemini }));

      let currentPrompt = prompt;
      const modeSwitchIntent = AdaptiveIntentService.detectModeSwitchIntent(currentPrompt, modeService);
      if (modeSwitchIntent.isModeSwitch && modeSwitchIntent.requestedMode) {
        try {
          const switchResult = await modeService.switchMode(ctx.from.id, modeSwitchIntent.requestedMode, media ? "voice" : "natural_language");
          globalContextData.userProfile.mode = switchResult.activeMode;
          await ctx.reply(switchResult.confirmationMessage, { parse_mode: "HTML", reply_markup: modeKeyboard(switchResult.activeMode) });
          if (!modeSwitchIntent.cleanedPrompt) return;
          currentPrompt = modeSwitchIntent.cleanedPrompt;
        } catch (err) { logger.warn({ error: safeErrorMetadata(err) }, "Failed executing natural language mode switch"); }
      }

      const semanticDecision = await SemanticInteractionResolverService.resolve({
        text: currentPrompt,
        persistentMode: globalContextData.userProfile.mode,
        history: globalContextData.recentHistory,
        gemini,
      });
      const registeredRequest = ctx.message?.message_id && ctx.from?.id && ctx.chat?.id
        ? requestRegistryService.getByTelegramMessage(ctx.from.id, ctx.chat.id, ctx.message.message_id)
        : undefined;
      if (registeredRequest) {
        requestRegistryService.markClassified(registeredRequest.requestId, {
          kind: semanticDecision.executionProfile === "durable" ? "durable" : semanticDecision.executionProfile === "one_shot" ? "one_shot" : semanticDecision.executionProfile === "clarification" ? "clarification" : "conversational",
          intent: semanticDecision.intent,
          promptTypes: semanticDecision.promptTypes,
          primaryPromptType: semanticDecision.primaryPromptType,
          executionProfile: semanticDecision.executionProfile,
          complexity: semanticDecision.complexity,
          confidence: semanticDecision.confidence,
          taskRequired: semanticDecision.executionProfile === "durable" || semanticDecision.taskIntent !== "NO_TASK",
          toolRequired: semanticDecision.requiredCapabilities.length > 0,
          mediaRequired: Boolean(media) || semanticDecision.intent === "image_generation" || semanticDecision.intent === "video_generation",
          activeTaskContinuation: Boolean(semanticDecision.taskIntent && semanticDecision.taskIntent !== "NO_TASK"),
        });
      }

      const taskIntent = taskService.detectTaskIntent(currentPrompt, semanticDecision);
      let activeTaskContext: { task: any; steps: any[] } | null = null;
      if (taskIntent.intent === "NEW_TASK" && taskIntent.taskTitle) {
        const created = await taskService.createTask({ telegramUserId: ctx.from.id, conversationId: globalContextData.conversationId, title: taskIntent.taskTitle, goal: taskIntent.taskGoal || taskIntent.taskTitle, steps: taskIntent.steps?.map((s) => ({ title: s })) });
        activeTaskContext = created;
        if (registeredRequest) requestRegistryService.markExecuting(registeredRequest.requestId, { taskId: created.task.id });
        await ctx.reply(`🎯 <b>New Task Created (#${created.task.id})</b>\n<b>Title:</b> ${escapeHtml(created.task.title)}\n<b>Goal:</b> ${escapeHtml(created.task.goal)}`, { parse_mode: "HTML", reply_markup: tasksKeyboard([created.task]) });
      } else if (taskIntent.intent === "CANCEL_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.task) { await taskService.updateTaskStatus(resolved.task.id, "cancelled"); await ctx.reply(`❌ Task #${resolved.task.id} (${escapeHtml(resolved.task.title)}) cancelled.`); return; }
      } else if (taskIntent.intent === "PAUSE_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.task) { await taskService.updateTaskStatus(resolved.task.id, "paused"); await ctx.reply(`⏸️ Task #${resolved.task.id} (${escapeHtml(resolved.task.title)}) paused.`); return; }
      } else if (taskIntent.intent === "CONTINUE_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.status === "AMBIGUOUS" && resolved.activeTasks) { await ctx.reply("Which task would you like to continue?", { reply_markup: taskDisambiguationKeyboard(resolved.activeTasks) }); return; }
        if (resolved.task) { const steps = await chatDatabaseService.getTaskSteps(resolved.task.id); activeTaskContext = { task: resolved.task, steps }; }
      }

      const executionPlan = executionPlanner.plan(currentPrompt, globalContextData.userProfile.mode, globalContextData.recentHistory);
      const adaptivePlan = { ...executionPlan, effectiveModeInstruction: executionPlan.effectiveSystemPrompt };
      logger.info({
        telegramUserId: ctx.from.id,
        promptTypes: adaptivePlan.promptTypes,
        primaryPromptType: adaptivePlan.primaryPromptType,
        executionProfile: adaptivePlan.executionProfile,
        detectedIntent: adaptivePlan.detectedIntent,
        complexity: adaptivePlan.complexity,
        semanticConfidence: semanticDecision.confidence,
      }, "TELEGRAM_REQUEST_RESOLVED");

      if (!media && adaptivePlan.detectedIntent === "video_generation" && adaptivePlan.videoPrompt) {
        const stopVideoPresence = startTypingIndicator(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: false });
        let progressMessageId: number | undefined;
        try {
          progressMessageId = await interactionPresentationService.renderProgress(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: true, elapsedMs: 0 });
          const startedAt = Date.now();
          const videoResult = await VideoGenerationService.generate(adaptivePlan.videoPrompt, gemini);
          await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", prompt));
          await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", `[Generated Video (${videoResult.provider}) for: "${adaptivePlan.videoPrompt}"] Enhanced: "${videoResult.enhancedPrompt}"`));
          const providerBadge = videoResult.provider === "huggingface" ? "🤗 Hugging Face" : "🌐 Free Community";
          const vidEnhancerTag = videoResult.enhancerName ? `<i>✨ Enhanced (${escapeHtml(videoResult.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
          const caption = [`<b>🎬 Prompt:</b> ${escapeHtml(videoResult.originalPrompt)}`, videoResult.enhancedPrompt.toLowerCase() !== videoResult.originalPrompt.toLowerCase() ? `${vidEnhancerTag} ${escapeHtml(videoResult.enhancedPrompt)}` : null, `<i>Engine: ${providerBadge}</i>`].filter(Boolean).join("\n\n");
          const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;
          if (progressMessageId) await ctx.api.deleteMessage(ctx.chat.id, progressMessageId).catch(() => {});
          if (videoResult.isVideo && Buffer.isBuffer(videoResult.buffer) && videoResult.buffer.length > 1000) await ctx.replyWithVideo(new InputFile(videoResult.buffer, "video.mp4"), { caption: safeCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
          else if (Buffer.isBuffer(videoResult.buffer) && videoResult.buffer.length > 500) await ctx.replyWithPhoto(new InputFile(videoResult.buffer, "concept_frame.jpg"), { caption: `${safeCaption}\n\n<i>(Rendered as a cinematic storyboard concept frame)</i>`, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
          else throw new Error("Natural video generation did not produce a valid buffer");
          logger.info({ stage: "video_generation", elapsedMs: Date.now() - startedAt }, "Natural video generation completed");
          if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId, { provider: videoResult.provider, mediaType: "video" });
          return;
        } catch (vidError) {
          logger.error({ vidError: safeErrorMetadata(vidError) }, "Natural video generation failed; terminating media request");
          if (progressMessageId) await ctx.api.deleteMessage(ctx.chat.id, progressMessageId).catch(() => {});
          throw vidError;
        } finally { stopVideoPresence(); }
      }

      if (!media && adaptivePlan.detectedIntent === "image_generation" && adaptivePlan.imagePrompt) {
        const stopImagePresence = startTypingIndicator(ctx, { state: "generating", toolName: "image_generation", operationLabel: "image generation", chatAction: "upload_photo", userFacingProgress: false });
        try {
          const imageResult = await ImageGenerationService.generate(adaptivePlan.imagePrompt, gemini);
          await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", prompt));
          await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", `[Generated Image for: "${adaptivePlan.imagePrompt}"] Enhanced: "${imageResult.enhancedPrompt}"`));
          const imageBadge = imageResult.provider === "huggingface" ? "<i>Engine: 🤗 Hugging Face (FLUX.1)</i>" : "<i>Engine: 🌐 Free Community (FLUX.1)</i>";
          const imgEnhancerTag = imageResult.enhancerName ? `<i>✨ Enhanced (${escapeHtml(imageResult.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
          const caption = [`<b>🎨 Prompt:</b> ${escapeHtml(imageResult.originalPrompt)}`, imageResult.enhancedPrompt.toLowerCase() !== imageResult.originalPrompt.toLowerCase() ? `${imgEnhancerTag} ${escapeHtml(imageResult.enhancedPrompt)}` : null, imageBadge].filter(Boolean).join("\n\n");
          const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + "..." : caption;
          if (!Buffer.isBuffer(imageResult.buffer) || imageResult.buffer.length < 500) throw new Error("Natural image generation did not produce a valid image buffer");
          await ctx.replyWithPhoto(new InputFile(imageResult.buffer, "image.jpg"), { caption: safeCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
          if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId, { provider: imageResult.provider, mediaType: "image" });
          return;
        } catch (imgError) { logger.warn({ imgError: safeErrorMetadata(imgError) }, "Natural image generation failed; falling back to conversational Gemini reply"); }
        finally { stopImagePresence(); }
      }

      const assembledContext = await contextManagerService.assembleContext({ telegramUserId: ctx.from.id, conversationId: globalContextData.conversationId, userMessage: currentPrompt, effectiveModeInstruction: adaptivePlan.effectiveModeInstruction, activeTask: activeTaskContext, history: globalContextData.recentHistory });
      const execConfig = getExecutionConfig();
      const shouldUseDurableExecution = !media && execConfig.enabled && (adaptivePlan.executionProfile === "durable" || Boolean(activeTaskContext));
      if (shouldUseDurableExecution) {
        try {
          const taskId = activeTaskContext?.task?.id;
          if (registeredRequest) requestRegistryService.markExecuting(registeredRequest.requestId, { taskId });
          const planResult = await agentPlannerService.planAndCompile({ telegramUserId: ctx.from.id, goal: currentPrompt, taskId, context: { capabilities: adaptivePlan.requiredCapabilities, conversationHistory: globalContextData.recentHistory, activeTask: activeTaskContext?.task ? { id: activeTaskContext.task.id, goal: activeTaskContext.task.goal } : undefined } });
          if (planResult.success && planResult.graph && !planResult.isDirectResponse) {
            logger.info({ graphId: planResult.graph.graphId, nodesCount: planResult.graph.nodes.length, telegramUserId: ctx.from.id, hasExplicitOrActiveTask: Boolean(taskId), executionProfile: adaptivePlan.executionProfile }, "TELEGRAM_AUTONOMOUS_EXECUTION_DISPATCHED");
            const session = await executionEngine.startExecution({ graphId: planResult.graph.graphId, planRevision: 1, requestId: registeredRequest?.requestId || `req_${Date.now()}_${ctx.from.id}`, taskId, executionContext: { telegramUserId: ctx.from.id, chatId: ctx.chat.id, conversationId: globalContextData.conversationId } });
            if (session.status === "waiting_approval" || (session.status as string) === "WAITING_APPROVAL") {
              const pendingApproval = await executionPersistence.getPendingApprovalForGraph(planResult.graph.graphId, 1);
              if (pendingApproval) { if (registeredRequest) requestRegistryService.markClassified(registeredRequest.requestId, { kind: "clarification" }); await ctx.reply(`⚠️ <b>Approval Required</b>\n\n<b>Node:</b> <code>${escapeHtml(pendingApproval.nodeId)}</code>\n<b>Reason:</b> ${escapeHtml(pendingApproval.reason || "Action requires explicit user confirmation")}`, { parse_mode: "HTML", reply_markup: executionApprovalKeyboard(pendingApproval.approvalId) }); return; }
            }
            if (session.status === "completed" || (session.status as string) === "COMPLETED") {
              const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(planResult.graph.graphId, 1);
              const nodeResults: Record<string, any> = {};
              for (const att of completedAttempts) if (att.result) nodeResults[att.nodeId] = att.result;
              let finalAnswer = "";
              const reverseNodeIds = [...Object.keys(planResult.graph.nodes)].reverse();
              for (const nodeId of reverseNodeIds) {
                const res = nodeResults[nodeId]; if (!res?.output) continue; const out = res.output;
                if (typeof out === "string") { finalAnswer = out; break; }
                if (out.response && typeof out.response === "string") { finalAnswer = out.response; break; }
                if (out.summary && typeof out.summary === "string") { finalAnswer = out.summary; break; }
                if (out.formatted && typeof out.formatted === "string") { finalAnswer = out.formatted; break; }
                if (out.conclusion && typeof out.conclusion === "string") { finalAnswer = out.conclusion; break; }
              }
              if (!finalAnswer) for (const nodeId of reverseNodeIds) { const res = nodeResults[nodeId]; if (res?.output) { finalAnswer = typeof res.output === "string" ? res.output : JSON.stringify(res.output, null, 2); break; } }
              if (!finalAnswer) finalAnswer = `Execution plan ${planResult.graph.graphId} completed successfully.`;
              await runStage("telegram_reply", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => ctx.reply(finalAnswer, { reply_markup: feedbackKeyboard() }));
              await conversations.addMessage(globalContextData.conversationId, "user", currentPrompt);
              await conversations.addMessage(globalContextData.conversationId, "model", finalAnswer);
              if (activeTaskContext) { const stepCount = activeTaskContext.steps.length; const stepUpdates = activeTaskContext.steps.map((s) => ({ stepOrder: s.stepOrder, status: "completed", resultSummary: `Completed in autonomous plan ${planResult.graph.graphId}` })); await taskService.updateTaskAndStepsAtomic({ taskId: activeTaskContext.task.id, stepUpdates, taskStatus: "completed", currentStep: stepCount }); }
              if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId, { graphId: planResult.graph.graphId, taskId });
              return;
            }
          }
        } catch (planExecErr) { logger.warn({ error: safeErrorMetadata(planExecErr) }, "Autonomous execution path failed; falling through to conversational streaming"); }
      }

      const streamingResponder = new StreamingResponder(ctx, {
        presentationEvent: {
          state: media ? "generating" : "generating",
          toolName: media ? `${media.mediaType}_input` : "assistant_response",
          operationLabel: media ? `${media.mediaType} response` : "assistant response",
          userFacingProgress: true,
          expectsLongRunning: Boolean(media),
        },
      });
      await streamingResponder.init();
      const normalizedHistory: GeminiMessage[] = assembledContext.history.filter((m) => m.role === "user" || m.role === "model" || m.role === "assistant").map((m) => ({ role: (m.role === "assistant" ? "model" : m.role) as "user" | "model", content: m.content }));
      const reply = await runStage("gemini_request", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => gemini.generateReplyStream(
        normalizedHistory,
        currentPrompt,
        {
          personalityInstruction: globalContextData.userProfile.personalityInstruction,
          modeInstruction: assembledContext.effectiveSystemPrompt,
          memoryInstruction: globalContextData.promptInstruction || undefined,
          personaInstruction: globalContextData.activePersona?.systemPrompt,
          personaName: globalContextData.activePersona?.name,
          personaEmoji: globalContextData.activePersona?.emoji,
        },
        {
          enableSearch: adaptivePlan.enableSearch,
          thinkingLevel: adaptivePlan.thinkingLevel,
          attachments: processedMedia ? [{ mimeType: processedMedia.mimeType, data: processedMedia.data, fileName: processedMedia.fileName }] : undefined,
          hasAudio: media?.mediaType === "voice" || media?.mediaType === "audio",
          hasVisionOrDocument: media?.mediaType === "image" || media?.mediaType === "document",
          mediaSizeBytes: processedMedia?.sizeBytes,
          userTier: quotaCheck.tier,
          userCustomModelOverride: quotaCheck.customModelOverride,
          personaPreferredModel: globalContextData.activePersona?.preferredModel,
          temperature: globalContextData.activePersona?.temperature,
        },
        async (accumulated) => streamingResponder.onChunk(accumulated)
      ));
      await runStage("telegram_streaming_finalize", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => streamingResponder.finalize(reply));
      const persistentUserMessage = media ? `[Attached ${media.mediaType}: ${media.fileName || media.reportedMime || "file"}]\n${prompt}` : prompt;
      await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", persistentUserMessage));
      await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", reply));
      if (activeTaskContext) await taskService.syncTaskProgressFromResponse(activeTaskContext.task.id, reply);
      if (await onboardingService.memoryEnabled(ctx.from.id)) void memoryService.processBackgroundExtraction(ctx.from.id, currentPrompt, globalContextData.conversationId);
      if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId);
    } catch (error) {
      if (ctx.message?.message_id && ctx.from?.id && ctx.chat?.id) {
        const request = requestRegistryService.getByTelegramMessage(ctx.from.id, ctx.chat.id, ctx.message.message_id);
        if (request) requestRegistryService.markFailed(request.requestId, { error: safeErrorMetadata(error) });
      }
      logger.error({ stage: "telegram_message_handling", telegramUserId: ctx.from.id, chatId: ctx.chat.id, error: safeErrorMetadata(error) }, "Telegram message handling failed");
      await ctx.reply(GENERIC_ERROR_MESSAGE).catch(() => {});
    } finally { stopTyping(); }
  }

  bot.on("message:text", async (ctx) => { await handleIncomingTelegramMessage(ctx, { rawText: ctx.message.text }); });
  bot.on("message:photo", async (ctx) => { const photos = ctx.message.photo; const highestResPhoto = photos[photos.length - 1]; await handleIncomingTelegramMessage(ctx, { rawText: ctx.message.caption, media: { fileId: highestResPhoto.file_id, mediaType: "image", reportedMime: "image/jpeg", fileSize: highestResPhoto.file_size } }); });
  bot.on("message:document", async (ctx) => { const doc = ctx.message.document; await handleIncomingTelegramMessage(ctx, { rawText: ctx.message.caption, media: { fileId: doc.file_id, mediaType: "document", reportedMime: doc.mime_type, fileName: doc.file_name, fileSize: doc.file_size } }); });
  bot.on("message:voice", async (ctx) => { const voice = ctx.message.voice; await handleIncomingTelegramMessage(ctx, { rawText: ctx.message.caption, media: { fileId: voice.file_id, mediaType: "voice", reportedMime: voice.mime_type || "audio/ogg", fileSize: voice.file_size } }); });
  bot.on("message:audio", async (ctx) => { const audio = ctx.message.audio; await handleIncomingTelegramMessage(ctx, { rawText: ctx.message.caption, media: { fileId: audio.file_id, mediaType: "audio", reportedMime: audio.mime_type || "audio/mpeg", fileName: audio.file_name, fileSize: audio.file_size } }); });

  bot.catch((error) => { logger.error({ stage: "telegram_update", updateId: error.ctx.update.update_id, error: safeErrorMetadata(error.error) }, "Telegram update failed"); });
  telegramWorkerQueue.setUpdateHandler(async (update) => { if (!bot.isInited()) await bot.init(); await bot.handleUpdate(update); });

  return {
    bot,
    async start() {
      await rateLimiter.initializeDb();
      if (!bot.isInited()) { try { await bot.init(); } catch (err) { logger.warn({ error: safeErrorMetadata(err) }, "Failed to initialize bot during start()"); } }
      reminderScheduler.start(bot);
      if (config.usePolling) {
        await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
        const startPollingWithRetry = async (retries = 2) => {
          try {
            await bot.start({
              onStart: (botInfo) => logger.info({ username: botInfo.username, model: config.geminiModel }, "Telegram polling started")
            });
          } catch (e: any) {
            const errStr = String(e);
            if (errStr.includes("409") && retries > 0) {
              logger.warn("Telegram polling encountered 409 Conflict (connection closing). Retrying in 4s...");
              setTimeout(() => { void startPollingWithRetry(retries - 1); }, 4000);
            } else if (errStr.includes("409")) {
              logger.warn("Telegram polling paused: another bot instance is currently active (409 Conflict).");
            } else {
              logger.error({ error: errStr }, "Telegram bot polling error");
            }
          }
        };
        void startPollingWithRetry();
        return;
      }
      await bot.api.setWebhook(config.telegramWebhookUrl!, { secret_token: config.telegramWebhookSecret });
      logger.info({ webhookUrlConfigured: true }, "Telegram webhook configured");
    },
    async stop() { reminderScheduler.stop(); await telegramWorkerQueue.drain(3000); await bot.stop(); logger.info("Telegram bot stopped"); },
    mountWebhook(app) {
      app.get("/api/telegram/queue-metrics", (_req: Request, res: Response) => { res.json({ status: "ok", workerQueue: telegramWorkerQueue.getMetrics() }); });
      if (config.usePolling) return;
      app.post("/api/telegram/webhook", (req: Request, res: Response) => {
        if (config.telegramWebhookSecret) { const secretHeader = req.header("X-Telegram-Bot-Api-Secret-Token"); if (secretHeader !== config.telegramWebhookSecret) { logger.warn("Telegram webhook received update with invalid secret token"); res.status(403).json({ error: "Unauthorized" }); return; } }
        const update = req.body;
        if (!update || typeof update !== "object" || typeof update.update_id !== "number") { res.status(400).json({ error: "Invalid Telegram webhook payload" }); return; }
        res.status(200).json({ ok: true });
        try { telegramWorkerQueue.enqueue(update); } catch (err) { logger.error({ error: safeErrorMetadata(err), updateId: update.update_id }, "Failed to enqueue update"); }
      });
    },
  };
}
