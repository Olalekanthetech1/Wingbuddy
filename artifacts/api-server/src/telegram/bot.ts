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
import { UnifiedMediaEngine } from "../services/media/unified-media-engine.service";
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
import { cronTaskService } from "../services/cron-task.service";
import { userTierService } from "../services/user-tier.service";
import { personaService } from "../services/persona.service";
import { contextManagerService } from "../services/context-manager.service";
import { stripMediaArtifactMetadata } from "../services/media-artifact-context.service";
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
  formatUpgradeOfferText,
  upgradeKeyboard,
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
import { timezoneService } from "../services/timezone.service";
import { registerOnboardingHandlers, startOnboarding } from "./onboarding";
import { scheduledTaskFlowService } from "../services/scheduled-task-flow.service";
import { PrismaClient } from "@prisma/client";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;

const prisma = new PrismaClient();

const PRIVATE_MESSAGE = "Sorry, this bot is currently private.";
const GENERIC_ERROR_MESSAGE =
  "I’m sorry, I couldn’t complete that request right now. Please try again in a moment.";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getPlanStepIcon(toolName?: string, title?: string): string {
  const t = (toolName || "").toLowerCase();
  const s = (title || "").toLowerCase();
  if (t.includes("search") || s.includes("search") || s.includes("research") || s.includes("news")) return "🔍";
  if (t.includes("summar") || s.includes("summar") || s.includes("key takeaway") || s.includes("digest")) return "📝";
  if (t.includes("remind") || s.includes("remind") || s.includes("schedule") || s.includes("alarm")) return "⏰";
  if (t.includes("task") || s.includes("task") || s.includes("todo")) return "📋";
  if (t.includes("calc") || s.includes("calc") || s.includes("math")) return "🔢";
  if (t.includes("image") || s.includes("image") || s.includes("photo") || s.includes("art")) return "🎨";
  if (t.includes("video") || s.includes("video") || s.includes("clip") || s.includes("movie")) return "🎬";
  if (t.includes("memory") || s.includes("memory") || s.includes("recall")) return "🧠";
  return "⚡";
}

function formatTaskPresentationPlan(nodes: Array<{ title?: string; actionSpec?: { toolName?: string } }>): string {
  const lines: string[] = [
    `📋 <b>Task Presentation Flow</b>\n`,
    `<i>I’ve recognized this as a multi-step goal. Here’s the plan I’ll follow:</i>\n`,
  ];
  nodes.forEach((node, idx) => {
    const icon = getPlanStepIcon(node.actionSpec?.toolName, node.title);
    const title = node.title || (node.actionSpec?.toolName ? node.actionSpec.toolName.replace(/_/g, " ") : `Step ${idx + 1}`);
    const desc = node.actionSpec?.toolName
      ? `→ Execute ${node.actionSpec.toolName.replace(/_/g, " ")}`
      : "→ Autonomous step execution";
    lines.push(`<b>${idx + 1}. ${icon} ${escapeHtml(title)}</b>\n   <i>${escapeHtml(desc)}</i>`);
  });
  return lines.join("\n");
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
    await ctx.reply(messageText, { parse_mode: "HTML", reply_markup: tasksKeyboard(activeTasks) });
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

  bot.command(["scheduled", "schedules", "routine", "routines"], async (ctx) => {
    if (!(await requireAuthorized(ctx))) return;
    if (!ctx.from) return;
    await upsertUser(ctx);
    const list = await scheduledTaskFlowService.formatTaskList(ctx.from.id);
    await ctx.reply(list.text, { parse_mode: "HTML", reply_markup: list.keyboard });
  });

  bot.callbackQuery(/^sched:confirm:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Activating scheduled task..." });
    const result = await scheduledTaskFlowService.activateTask(taskId);
    if (!result.success || !result.task) {
      await ctx.reply(`⚠️ Could not activate task #${taskId}: ${result.error || "Unknown error"}`);
      return;
    }
    const task = result.task;
    let meta: any = {};
    try { if (task.metadataJson) meta = JSON.parse(task.metadataJson); } catch {}
    const nextRunStr = task.nextRunAt ? task.nextRunAt.toUTCString().slice(0, 22) + " UTC" : "Pending";
    const text = [
      `✅ <b>Scheduled Task Activated (#${task.id})!</b>`,
      ``,
      `• <b>Title:</b> ${escapeHtml(task.title)}`,
      `• <b>Schedule:</b> ${escapeHtml(meta.scheduleDescription || "Recurring")}`,
      `• <b>Next Run:</b> <code>${nextRunStr}</code>`,
      ``,
      `I will execute this instruction automatically on schedule and deliver the results here.`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("🚀 Run Now", `sched:run:${task.id}`)
      .text("⏸ Pause", `sched:pause:${task.id}`);

    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    });
  });

  bot.callbackQuery(/^sched:refine:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✏️ <b>Refining Criteria for Task #${taskId}</b>\n\nWhat would you like to adjust?\n• <i>Change schedule:</i> e.g. "Change to every Friday at 10 AM"\n• <i>Adjust criteria:</i> e.g. "Exclude roles requiring relocation"\n• <i>Change format:</i> e.g. "Rank top 3 with salary details"`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^sched:cancel:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await taskService.updateTaskStatus(taskId, "cancelled");
    await ctx.editMessageText(`❌ <i>Task proposal #${taskId} has been cancelled.</i>`, { parse_mode: "HTML" }).catch(() => {});
  });

  bot.callbackQuery(/^sched:run:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Executing task now..." });
    await ctx.reply(`⚡ <i>Executing task #${taskId} now...</i>`, { parse_mode: "HTML" });
    await cronTaskService.executeTaskNow(taskId);
  });

  bot.callbackQuery(/^sched:pause:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Task paused" });
    await taskService.updateTaskStatus(taskId, "paused");
    await ctx.reply(`⏸️ <b>Task #${taskId} paused.</b>\nIt will not run automatically until resumed.`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("▶️ Resume", `sched:resume:${taskId}`),
    });
  });

  bot.callbackQuery(/^sched:resume:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Task resumed" });
    await scheduledTaskFlowService.activateTask(taskId);
    await ctx.reply(`▶️ <b>Task #${taskId} resumed.</b>`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("⏸ Pause", `sched:pause:${taskId}`).text("🚀 Run Now", `sched:run:${taskId}`),
    });
  });

  bot.callbackQuery(/^sched:delete:(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: "Task deleted" });
    await taskService.updateTaskStatus(taskId, "cancelled");
    await ctx.reply(`🗑️ <b>Task #${taskId} has been deleted.</b>`, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^sched(?:_edit|:edit):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✏️ To change the schedule for <b>#${taskId}</b>, send a message like:\n<i>"Change task #${taskId} to every Friday at 10 AM"</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^sched(?:_snooze|:snooze):(\d+):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    const minutes = parseInt(ctx.match[2], 10) || 15;
    const res = await scheduledTaskFlowService.snoozeTask(taskId, minutes);
    if (res.success && res.nextRunAt) {
      const timeStr = ReminderService.formatUtcTimestamp(res.nextRunAt);
      await ctx.answerCallbackQuery({ text: `⏰ Snoozed for ${minutes}m (until ${timeStr})` });
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(`⏰ Snoozed until ${timeStr}`, "feedback:no-op"),
      }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: res.error || "Could not snooze task" });
    }
  });

  bot.callbackQuery(/^sched(?:_done|:done):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const taskId = parseInt(ctx.match[1], 10);
    const res = await scheduledTaskFlowService.completeTask(taskId);
    if (res.success) {
      await ctx.answerCallbackQuery({ text: "✅ Marked as done!" });
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text("✅ Completed", "feedback:no-op"),
      }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: res.error || "Could not update task" });
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
      await ctx.reply(
        "Please provide a time and task description.\n\nExamples:\n• /remind in 15 mins to check deploy\n• /remind check Admin Dashboard every day at 9 AM\n• /remind tomorrow at 9am standup meeting\n• /remind tonight at 8pm call team"
      );
      return;
    }
    const userTz = await timezoneService.getUserTimezone(ctx.from.id);
    const parsed = ReminderService.parseNaturalReminder(`remind me ${rawInput}`, new Date(), userTz);
    if (!parsed) {
      await ctx.reply(
        "Could not parse that reminder time.\nTry formats like:\n• /remind in 20 minutes <task>\n• /remind every day at 9 AM <task>\n• /remind tomorrow at 10am <task>\n• /remind at 4:30 pm <task>"
      );
      return;
    }

    try {
      if (parsed.isRecurring) {
        const { task } = await scheduledTaskFlowService.createProposal({
          telegramUserId: ctx.from.id,
          prompt: rawInput,
          title: parsed.prompt,
          goal: parsed.prompt,
          explicitCron: parsed.cronExpression,
          explicitCadence: parsed.cadenceDescription,
          type: "reminder",
        });
        await scheduledTaskFlowService.activateTask(task.id);

        const card = ReminderService.formatReminderConfirmationCard({
          greeting: parsed.contextualGreeting,
          title: parsed.prompt,
          when: parsed.cadenceDescription || parsed.humanReadableTime,
          nextTrigger: task.nextRunAt || parsed.dueAt,
          category: parsed.category || "Work Routine",
          icon: parsed.icon || "📊",
          isRecurring: true,
        });

        await ctx.reply(card, {
          parse_mode: "HTML",
          reply_markup: ReminderService.reminderActionsKeyboard(task.id, "sched"),
        });
      } else {
        const created = await reminderService.createReminder({
          telegramUserId: ctx.from.id,
          chatId: ctx.chat.id,
          prompt: parsed.prompt,
          dueAt: parsed.dueAt,
        });

        const card = ReminderService.formatReminderConfirmationCard({
          greeting: parsed.contextualGreeting,
          title: parsed.prompt,
          when: parsed.humanReadableTime,
          nextTrigger: parsed.dueAt,
          category: parsed.category || "Simple Alert",
          icon: parsed.icon || "🔔",
          isRecurring: false,
        });

        await ctx.reply(card, {
          parse_mode: "HTML",
          reply_markup: ReminderService.reminderActionsKeyboard(created.id, "rem"),
        });
      }
    } catch (err) {
      logger.warn({ error: safeErrorMetadata(err) }, "Failed creating reminder via /remind");
      await ctx.reply("⚠️ Sorry, could not schedule that reminder. Please try again.");
    }
  });

  bot.command(["tier", "quota", "account", "plan", "upgrade", "premium"], async (ctx) => {
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
        ? "Unlimited ✨"
        : `${stats.requestsToday} / ${stats.dailyQuota} used (${stats.remainingToday} remaining)`;

      const imageQuota = await userTierService.checkToolQuota(ctx.from.id, "image");
      const videoQuota = await userTierService.checkToolQuota(ctx.from.id, "video");

      const lines = [
        `<b>${tierIcon} Your Account Tier: ${escapeHtml(cfg.label)}</b>`,
        ``,
        `• <b>Daily Messages:</b> ${quotaDisplay}`,
        `• <b>Image Generation:</b> ${cfg.allowedFeatures.imageGen ? `${imageQuota.remaining} remaining today (${cfg.dailyImageQuota ?? 60}/day limit)` : "Locked (requires PRO/VIP)"}`,
        `• <b>Video Generation:</b> ${cfg.allowedFeatures.videoGen ? `${videoQuota.remaining} remaining today (${cfg.dailyVideoQuota ?? 10}/day limit)` : "Locked (requires PRO/VIP)"}`,
        `• <b>Routing Class:</b> ${escapeHtml(cfg.targetModelClass)}`,
        `• <b>Speed & Priority:</b> ${escapeHtml(cfg.speed)}`,
        `• <b>Status:</b> ${stats.status === "active" ? "Active ✅" : stats.status}`,
        stats.customModelOverride ? `• <b>Assigned Model Override:</b> <code>${escapeHtml(stats.customModelOverride)}</code>` : null,
        ``,
        stats.tier === "vip"
          ? "✨ <i>You are on the highest VIP tier with unthrottled access, 10 authentic video generations/day, and expert personas.</i>"
          : "<i>Upgrade to PRO or VIP to unlock deep reasoning personas, video synthesis, and higher daily quotas.</i>",
      ].filter(Boolean);

      const kb = new InlineKeyboard();
      if (stats.tier === "free") kb.text("⚡ Upgrade to PRO", "upgrade:view:pro").text("👑 Upgrade to VIP", "upgrade:view:vip").row();
      else if (stats.tier === "pro") kb.text("👑 Upgrade to VIP Pass", "upgrade:view:vip").row();
      kb.text("🎭 Browse Personas", "menu:personas").text("◀️ Main Menu", "menu:main");

      await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
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

  bot.command(["image", "draw", "img", "imagine", "generate_image"], async (ctx) => {
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
    const userTier = await userTierService.getUserTier(ctx.from.id);
    const quotaCheck = await userTierService.checkToolQuota(ctx.from.id, "image");
    if (!quotaCheck.allowed) {
      await ctx.reply(quotaCheck.message || "Image quota exceeded.");
      return;
    }
    const stopPresence = startTypingIndicator(ctx, { state: "generating", toolName: "image_generation", operationLabel: "image generation", chatAction: "upload_photo", userFacingProgress: false });
    try {
      const mediaResult = await UnifiedMediaEngine.execute({
        modality: "image",
        prompt: rawPrompt,
        executionMode: "live",
        userId: ctx.from.id,
        userTier,
        sourceInterface: "telegram",
      });

      if (!mediaResult.success || !mediaResult.artifact?.buffer) {
        throw new Error(mediaResult.job.errorMessage || "Image generation did not produce a valid image buffer");
      }

      const safeRaw = rawPrompt.length > 180 ? rawPrompt.slice(0, 175) + "..." : rawPrompt;
      const safeEnhanced = (mediaResult.job.enhancedPrompt || "").length > 200 ? mediaResult.job.enhancedPrompt.slice(0, 195) + "..." : (mediaResult.job.enhancedPrompt || "");
      const isEnhancedDiff = safeEnhanced.toLowerCase() !== safeRaw.toLowerCase() && safeEnhanced.length > 5;

      const imageBadge = `<i>Engine: ${escapeHtml(mediaResult.job.actualProvider)} (${escapeHtml(mediaResult.job.actualModel)})</i>`;
      const enhancerTag = `<i>✨ AI Enhanced:</i>`;
      const htmlCaption = [
        `<b>🎨 Prompt:</b> ${escapeHtml(safeRaw)}`,
        isEnhancedDiff ? `${enhancerTag} ${escapeHtml(safeEnhanced)}` : null,
        imageBadge,
      ].filter(Boolean).join("\n\n");
      const plainCaption = [
        `🎨 Prompt: ${safeRaw}`,
        isEnhancedDiff ? `✨ AI Enhanced: ${safeEnhanced}` : null,
        `Engine: ${mediaResult.job.actualProvider} (${mediaResult.job.actualModel})`,
      ].filter(Boolean).join("\n\n");

      let photoDelivered = false;
      try {
        await ctx.replyWithPhoto(new InputFile(mediaResult.artifact.buffer, "image.png"), {
          caption: htmlCaption,
          parse_mode: "HTML",
          reply_markup: feedbackKeyboard(),
        });
        photoDelivered = true;
      } catch (htmlErr) {
        logger.warn({ stage: "image_caption_parse_error", error: safeErrorMetadata(htmlErr) }, "HTML photo caption failed; retrying with plain text");
        try {
          await ctx.replyWithPhoto(new InputFile(mediaResult.artifact.buffer, "image.png"), {
            caption: plainCaption,
            reply_markup: feedbackKeyboard(),
          });
          photoDelivered = true;
        } catch (plainErr) {
          logger.warn({ stage: "image_plain_caption_failed", error: safeErrorMetadata(plainErr) }, "Plain text photo caption failed; retrying without caption");
          try {
            await ctx.replyWithPhoto(new InputFile(mediaResult.artifact.buffer, "image.png"), {
              reply_markup: feedbackKeyboard(),
            });
            photoDelivered = true;
          } catch (noCapErr) {
            logger.warn({ stage: "image_buffer_upload_failed", error: safeErrorMetadata(noCapErr) }, "Direct image buffer upload failed");
          }
        }
      }

      // Cloudinary / Public URL fallback
      const directUrl = mediaResult.artifact.publicUrl;
      if (!photoDelivered && directUrl && (directUrl.startsWith("http://") || directUrl.startsWith("https://"))) {
        try {
          await ctx.replyWithPhoto(directUrl, {
            caption: plainCaption,
            reply_markup: feedbackKeyboard(),
          });
          photoDelivered = true;
        } catch (urlErr) {
          logger.warn({ stage: "image_url_photo_failed", error: safeErrorMetadata(urlErr) }, "Photo delivery via Cloudinary URL failed; sending direct link");
          try {
            await ctx.reply(`🎨 <b>Here is your generated image:</b>\n<a href="${escapeHtml(directUrl)}">${escapeHtml(safeRaw)}</a>`, {
              parse_mode: "HTML",
              reply_markup: feedbackKeyboard(),
            });
            photoDelivered = true;
          } catch (linkErr) {
            logger.error({ stage: "image_link_failed", error: safeErrorMetadata(linkErr) }, "Direct link delivery failed");
          }
        }
      }

      if (photoDelivered) {
        const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
        await conversations.addMessage(conversationId, "user", `/image ${safeRaw}`);
        await conversations.addMessage(conversationId, "model", `[Generated Image for: "${safeRaw}"]`);
        await userTierService.consumeToolQuota(ctx.from.id, "image");
      } else {
        throw new Error("Failed to deliver image through any transport tier");
      }
    } catch (error) {
      logger.error({ stage: "image_generation", error: safeErrorMetadata(error) }, "Image generation failed");
      await ctx.reply("Sorry, I encountered an issue delivering that image. Your generation quota was not consumed. Please try again or rephrase your prompt.");
    } finally { stopPresence(); }
  });

  bot.command(["video", "vid", "clip", "generate_video"], async (ctx) => {
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
    const userTier = await userTierService.getUserTier(ctx.from.id);
    const quotaCheck = await userTierService.checkToolQuota(ctx.from.id, "video");
    if (!quotaCheck.allowed) {
      await ctx.reply(quotaCheck.message || "Video quota exceeded.");
      return;
    }
    const stopPresence = startTypingIndicator(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: false });
    let progressMsg: number | undefined;
    let statusMsgId: number | undefined;
    try {
      const statusMsg = await ctx.reply(
        "🎬 <b>Video Request Queued</b>\n\nVideo rendering is queued due to high demand. Generative diffusion typically takes 30–60 seconds.\n\n<i>I will notify you here once it is ready!</i>",
        { parse_mode: "HTML" }
      ).catch(() => null);
      if (statusMsg) statusMsgId = statusMsg.message_id;

      progressMsg = await interactionPresentationService.renderProgress(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, elapsedMs: 0 });
      const startedAt = Date.now();
      const mediaResult = await UnifiedMediaEngine.execute({
        modality: "video",
        prompt: rawPrompt,
        executionMode: "live",
        userId: ctx.from.id,
        userTier,
        sourceInterface: "telegram",
      });

      if (!mediaResult.success || !mediaResult.artifact?.buffer) {
        throw new Error(mediaResult.job.errorMessage || "Video generation did not produce a valid video buffer");
      }

      const safeRaw = rawPrompt.length > 180 ? rawPrompt.slice(0, 175) + "..." : rawPrompt;
      const safeEnhanced = (mediaResult.job.enhancedPrompt || "").length > 200 ? mediaResult.job.enhancedPrompt.slice(0, 195) + "..." : (mediaResult.job.enhancedPrompt || "");
      const isEnhancedDiff = safeEnhanced.toLowerCase() !== safeRaw.toLowerCase() && safeEnhanced.length > 5;

      const providerBadge = `${escapeHtml(mediaResult.job.actualProvider)} (${escapeHtml(mediaResult.job.videoTechnique || "video_diffusion")})`;
      const enhancerTag = `<i>✨ AI Director:</i>`;
      const htmlCaption = [
        `<b>🎬 Prompt:</b> ${escapeHtml(safeRaw)}`,
        isEnhancedDiff ? `${enhancerTag} ${escapeHtml(safeEnhanced)}` : null,
        `<i>Engine: ${providerBadge}</i>`
      ].filter(Boolean).join("\n\n");
      const plainCaption = [
        `🎬 Prompt: ${safeRaw}`,
        isEnhancedDiff ? `✨ AI Director: ${safeEnhanced}` : null,
        `Engine: ${mediaResult.job.actualProvider} (${mediaResult.job.videoTechnique || "video_diffusion"})`
      ].filter(Boolean).join("\n\n");
      
      if (progressMsg) await ctx.api.deleteMessage(ctx.chat.id, progressMsg).catch(() => {});

      let videoDelivered = false;
      if (mediaResult.artifact.mimeType?.includes("video") && Buffer.isBuffer(mediaResult.artifact.buffer) && mediaResult.artifact.buffer.length > 1000) {
        try {
          await ctx.replyWithVideo(new InputFile(mediaResult.artifact.buffer, "video.mp4"), {
            caption: htmlCaption,
            parse_mode: "HTML",
            reply_markup: feedbackKeyboard(),
          });
          videoDelivered = true;
        } catch (captionErr) {
          logger.warn({ stage: "video_html_caption_failed", err: String(captionErr) }, "HTML video caption failed; retrying with plain text");
          try {
            await ctx.replyWithVideo(new InputFile(mediaResult.artifact.buffer, "video.mp4"), {
              caption: plainCaption,
              reply_markup: feedbackKeyboard(),
            });
            videoDelivered = true;
          } catch (plainErr) {
            logger.warn({ stage: "video_plain_caption_failed", err: String(plainErr) }, "Plain text video caption failed; retrying with no caption");
            try {
              await ctx.replyWithVideo(new InputFile(mediaResult.artifact.buffer, "video.mp4"), {
                reply_markup: feedbackKeyboard(),
              });
              videoDelivered = true;
            } catch (noCapErr) {
              logger.warn({ stage: "video_buffer_send_failed", err: String(noCapErr) }, "Direct video buffer upload failed");
            }
          }
        }
      }

      // Cloudinary / Public URL fallback
      const directUrl = mediaResult.artifact.publicUrl;
      if (!videoDelivered && directUrl && (directUrl.startsWith("http://") || directUrl.startsWith("https://"))) {
        try {
          await ctx.replyWithVideo(directUrl, {
            caption: plainCaption,
            reply_markup: feedbackKeyboard(),
          });
          videoDelivered = true;
        } catch (urlErr) {
          logger.warn({ stage: "video_url_delivery_failed", err: String(urlErr) }, "Video delivery via URL failed; sending direct link");
          try {
            await ctx.reply(`🎬 <b>Here is your generated video:</b>\n<a href="${escapeHtml(directUrl)}">${escapeHtml(safeRaw)}</a>`, {
              parse_mode: "HTML",
              reply_markup: feedbackKeyboard(),
            });
            videoDelivered = true;
          } catch (linkErr) {
            logger.error({ stage: "video_link_delivery_failed", err: String(linkErr) }, "Direct link delivery failed");
          }
        }
      }

      if (statusMsgId) await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});

      if (videoDelivered) {
        const conversationId = await conversations.getOrCreateConversation(ctx.from.id, ctx.chat.id);
        await conversations.addMessage(conversationId, "user", `/video ${safeRaw}`);
        await conversations.addMessage(conversationId, "model", `[Generated Visual (${mediaResult.job.actualProvider}) for: "${safeRaw}"]`);
        await userTierService.consumeToolQuota(ctx.from.id, "video");
        logger.info({ stage: "video_generation", elapsedMs: Date.now() - startedAt }, "Video generation completed via UnifiedMediaEngine");
      } else {
        throw new Error("Failed to deliver video across all transport tiers");
      }
    } catch (error) {
      logger.error({ stage: "video_generation", error: safeErrorMetadata(error) }, "Video generation failed");
      if (progressMsg) await ctx.api.deleteMessage(ctx.chat.id, progressMsg).catch(() => {});
      if (statusMsgId) await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});
      const userFriendlyMsg = [
        "🎬 <b>Video Engine Under Heavy Load</b>",
        "",
        "Our generative video diffusion engines are currently experiencing high demand or transient provider limits.",
        "",
        "🛡️ <i>Your generation quota was <b>not consumed</b>.</i>",
        "",
        "Please try your video request again in a few moments, or feel free to request an image generation instead!"
      ].join("\n");
      await ctx.reply(userFriendlyMsg, { parse_mode: "HTML" });
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
        const [personas, currentRes, tierProfile, policy] = await Promise.all([
          personaService.getAllPersonas(),
          personaService.getUserActivePersona(ctx.from.id),
          userTierService.getUserTierProfile(ctx.from.id),
          userTierService.getPolicy(),
        ]);

        const requiredTier = switchRes.requiresTier as "pro" | "vip" | undefined;
        const kb = new InlineKeyboard();
        if (requiredTier && (requiredTier === "pro" || requiredTier === "vip")) {
          const badge = requiredTier === "vip" ? "👑 VIP Pass" : "⚡ PRO Pass";
          kb.text(`💎 Upgrade to ${badge}`, `upgrade:view:${requiredTier}`).row();
        }
        personas.filter((p) => p.enabled).forEach((p) => {
          const isLocked = (p.requiredTier === "vip" && tierProfile.tier !== "vip") ||
            (p.requiredTier === "pro" && tierProfile.tier === "free");
          const label = `${p.emoji} ${p.name}${isLocked ? " 🔒" : ""}`;
          kb.text(label, `persona:select:${p.id}`).row();
        });
        kb.text("◀️ Back", "menu:personas");
        await ctx.reply(`⚠️ ${switchRes.error || "Persona not accessible."}`, {
          parse_mode: "HTML",
          reply_markup: kb,
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
      await ctx.answerCallbackQuery();
      const requiredTier = (switchRes.requiresTier as "pro" | "vip") || "pro";
      const [policy, tierProfile, personaTarget] = await Promise.all([
        userTierService.getPolicy(),
        userTierService.getUserTierProfile(ctx.from.id),
        personaService.getPersonaById(targetPersonaId),
      ]);
      const offerText = formatUpgradeOfferText(
        requiredTier,
        tierProfile.tier,
        personaTarget ? { name: personaTarget.name, emoji: personaTarget.emoji } : undefined,
        policy,
      );
      await ctx.editMessageText(offerText, {
        parse_mode: "HTML",
        reply_markup: upgradeKeyboard(requiredTier, policy, targetPersonaId, ctx.from.id),
      });
    }
  });

  bot.callbackQuery(/^upgrade:view:(pro|vip)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const targetTier = ctx.match[1] as "pro" | "vip";
    const [policy, tierProfile] = await Promise.all([
      userTierService.getPolicy(),
      userTierService.getUserTierProfile(ctx.from.id),
    ]);
    const text = formatUpgradeOfferText(targetTier, tierProfile.tier, undefined, policy);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: upgradeKeyboard(targetTier, policy, undefined, ctx.from.id),
    }).catch(async () => {
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: upgradeKeyboard(targetTier, policy, undefined, ctx.from.id),
      });
    });
  });
  bot.callbackQuery(/^rem(?:_done|:done):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    await reminderService.completeReminder(reminderId, ctx.from.id);
    await ctx.answerCallbackQuery({ text: "✅ Marked reminder as done!" });
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text("✅ Completed", "feedback:no-op"),
    }).catch(() => {});
  });

  bot.callbackQuery(/^rem(?:_snooze|:snooze):(\d+):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    const minutes = parseInt(ctx.match[2], 10) || 15;
    const updated = await reminderService.snoozeReminder(reminderId, minutes, ctx.from.id);
    if (updated) {
      const timeStr = ReminderService.formatUtcTimestamp(updated.dueAt);
      await ctx.answerCallbackQuery({ text: `⏰ Snoozed for ${minutes}m (until ${timeStr})` });
      await ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(`⏰ Snoozed until ${timeStr}`, "feedback:no-op"),
      }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: "Reminder not found or already completed." });
    }
  });

  bot.callbackQuery(/^rem(?:_edit|:edit):(\d+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const reminderId = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✏️ To change the time for reminder <b>#${reminderId}</b>, send a message like:\n<i>"Change reminder #${reminderId} to tomorrow at 9 AM"</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^rem(?:_cancel|:cancel):(\d+)$/, async (ctx) => {
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
    }).catch(async () =>
      ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text("❌ Cancelled", "feedback:no-op"),
      })
    );
  });
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
  bot.callbackQuery(/^exec_appr:(.+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const approvalId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Processing approval..." });
    try {
      const match = approvalId.match(/^app_(.+)_r(\d+)_(.+)$/);
      if (match) {
        const [, graphId, revStr, nodeId] = match;
        await executionEngine.submitApproval({
          graphId,
          planRevision: parseInt(revStr, 10),
          nodeId,
          approved: true,
          telegramUserId: ctx.from.id,
        });
        await ctx.editMessageText(
          `✅ <b>Approval Granted</b>\nExecution resumed for plan <code>${escapeHtml(graphId)}</code> (step: <code>${escapeHtml(nodeId)}</code>).`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply("⚠️ Invalid approval identifier.");
      }
    } catch (err: any) {
      await ctx.reply(`⚠️ Approval failed: ${err.message}`);
    }
  });

  bot.callbackQuery(/^exec_rejc:(.+)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    const approvalId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Processing rejection..." });
    try {
      const match = approvalId.match(/^app_(.+)_r(\d+)_(.+)$/);
      if (match) {
        const [, graphId, revStr, nodeId] = match;
        await executionEngine.submitApproval({
          graphId,
          planRevision: parseInt(revStr, 10),
          nodeId,
          approved: false,
          telegramUserId: ctx.from.id,
        });
        await ctx.editMessageText(
          `❌ <b>Execution Rejected</b>\nPlan <code>${escapeHtml(graphId)}</code> has been cancelled.`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply("⚠️ Invalid rejection identifier.");
      }
    } catch (err: any) {
      await ctx.reply(`⚠️ Rejection failed: ${err.message}`);
    }
  });

  bot.callbackQuery(/^upgrade:stars:(pro|vip)$/, async (ctx) => {
    if (!ctx.from || !authorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: PRIVATE_MESSAGE, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const targetTier = ctx.match[1] as "pro" | "vip";
    const policy = await userTierService.getPolicy();
    const tierConfig = policy.tiers?.[targetTier];
    const starsAmount = tierConfig?.starsAmount || (targetTier === "vip" ? 1250 : 500);

    const title = targetTier === "vip" ? "👑 Wingbuddy VIP Pass" : "⚡ Wingbuddy PRO Pass";
    const description = targetTier === "vip"
      ? "Unlock Unlimited Messages, DeepSeek-R1 reasoning, Crypto Strategist & FLUX Ultra generation."
      : "Unlock 150 daily messages, Software Architect persona, priority processing & 30-message context retention.";

    const payload = JSON.stringify({
      type: "tier_upgrade",
      tier: targetTier,
      telegramUserId: ctx.from.id,
      timestamp: Date.now(),
    });

    try {
      await ctx.replyWithInvoice(
        title,
        description,
        payload,
        "XTR", // Official currency code for Telegram Stars
        [
          {
            label: `${targetTier.toUpperCase()} Pass (Monthly)`,
            amount: starsAmount,
          },
        ],
        {
          photo_url: targetTier === "vip"
            ? "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80"
            : "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=600&auto=format&fit=crop&q=80",
          photo_width: 600,
          photo_height: 400,
          protect_content: false,
        },
      );
    } catch (err) {
      logger.error({ error: safeErrorMetadata(err), userId: ctx.from.id, targetTier }, "Failed sending Telegram Stars invoice");
      await ctx.reply("⚠️ Could not generate the Stars invoice. Please try again or contact support.");
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    try {
      const payload = JSON.parse(query.invoice_payload);
      if (payload.type === "tier_upgrade" && (payload.tier === "pro" || payload.tier === "vip")) {
        await ctx.answerPreCheckoutQuery(true);
        logger.info({ userId: ctx.from.id, tier: payload.tier }, "Approved Telegram Stars pre-checkout query");
        return;
      }
      await ctx.answerPreCheckoutQuery(false, { error_message: "Invalid upgrade payload." });
    } catch (err) {
      logger.error({ error: safeErrorMetadata(err), queryId: query.id }, "Error handling pre_checkout_query");
      await ctx.answerPreCheckoutQuery(false, { error_message: "Checkout verification failed. Please try again." });
    }
  });

  bot.on(":successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    logger.info({ payment, userId: ctx.from?.id }, "Received successful Telegram Stars payment");
    try {
      const payload = JSON.parse(payment.invoice_payload);
      if (payload.type === "tier_upgrade" && (payload.tier === "pro" || payload.tier === "vip")) {
        const targetTier = payload.tier as "pro" | "vip";
        await userTierService.updateUserAccess(ctx.from.id, {
          tier: targetTier,
          status: "active",
        });

        const tierName = targetTier === "vip" ? "👑 VIP Pass" : "⚡ PRO Pass";
        const msg = [
          `🎉 <b>Payment Successful!</b>`,
          ``,
          `Thank you for supporting Wingbuddy! Your account has been upgraded to <b>${tierName}</b> with immediate effect.`,
          `⭐ Paid: <code>${payment.total_amount} Stars (XTR)</code>`,
          `🆔 Telegram Payment ID: <code>${payment.telegram_payment_charge_id}</code>`,
          ``,
          `Use /persona to select unlocked specialist agents or /tier to view your renewed quotas!`,
        ].join("\n");
        await ctx.reply(msg, { parse_mode: "HTML" });
      }
    } catch (err) {
      logger.error({ error: safeErrorMetadata(err), userId: ctx.from?.id }, "Error processing successful payment event");
    }
  });

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

    const stopTyping = startTypingIndicator(ctx, { state: "understanding", operationLabel: media ? "incoming media" : "request interpretation", userFacingProgress: false });
    try {
      let processedMedia: ProcessedMedia | undefined;
      if (media) {
        try { processedMedia = await MediaProcessorService.downloadTelegramMedia(ctx.api, config.telegramBotToken, media.fileId, { expectedType: media.mediaType, reportedMime: media.reportedMime, fileName: media.fileName }); }
        catch (mediaErr) { logger.error({ error: safeErrorMetadata(mediaErr), mediaType: media.mediaType }, "Failed downloading Telegram media for multimodal processing"); await ctx.reply("⚠️ Sorry, I could not download the attached media from Telegram. Please try sending it again."); return; }
      }

      const userTier = quotaCheck.tier;
      const userTierPolicy = await userTierService.getPolicy();
      const userTierConfig = userTierPolicy.tiers?.[userTier];
      const tierMaxHistory = userTierConfig?.contextHistoryLimit || (userTier === "vip" ? 60 : userTier === "pro" ? 30 : 10);

      const globalContextData = await runStage("global_context_retrieval", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => globalContext.getContextForCompletion({ telegramUserId: ctx.from!.id, chatId: ctx.chat!.id, userProfile: { id: ctx.from!.id, username: ctx.from!.username, firstName: ctx.from!.first_name, lastName: ctx.from!.last_name }, maxHistoryMessages: tierMaxHistory, userTier, message: prompt, geminiService: gemini }));

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
        await ctx.reply(`🎯 <b>Workflow Registered (#${created.task.id})</b>\n<b>Title:</b> ${escapeHtml(created.task.title)}\n<b>Goal:</b> ${escapeHtml(created.task.goal)}`, { parse_mode: "HTML" });
      } else if (taskIntent.intent === "SCHEDULE_TASK" && (taskIntent.taskTitle || currentPrompt)) {
        try {
          const userTz = await timezoneService.getUserTimezone(ctx.from.id);
          const naturalReminder = ReminderService.parseNaturalReminder(currentPrompt, new Date(), userTz);
          if (naturalReminder) {
            if (naturalReminder.isRecurring) {
              const { task } = await scheduledTaskFlowService.createProposal({
                telegramUserId: ctx.from.id,
                prompt: currentPrompt,
                title: naturalReminder.prompt,
                goal: naturalReminder.prompt,
                explicitCron: naturalReminder.cronExpression,
                explicitCadence: naturalReminder.cadenceDescription,
                type: "reminder",
              });
              await scheduledTaskFlowService.activateTask(task.id);

              const card = ReminderService.formatReminderConfirmationCard({
                greeting: naturalReminder.contextualGreeting,
                title: naturalReminder.prompt,
                when: naturalReminder.cadenceDescription || naturalReminder.humanReadableTime,
                nextTrigger: task.nextRunAt || naturalReminder.dueAt,
                category: naturalReminder.category || "Work Routine",
                icon: naturalReminder.icon || "📊",
                isRecurring: true,
              });

              await ctx.reply(card, {
                parse_mode: "HTML",
                reply_markup: ReminderService.reminderActionsKeyboard(task.id, "sched"),
              });
              return;
            } else {
              const created = await reminderService.createReminder({
                telegramUserId: ctx.from.id,
                chatId: ctx.chat.id,
                prompt: naturalReminder.prompt,
                dueAt: naturalReminder.dueAt,
              });

              const card = ReminderService.formatReminderConfirmationCard({
                greeting: naturalReminder.contextualGreeting,
                title: naturalReminder.prompt,
                when: naturalReminder.humanReadableTime,
                nextTrigger: naturalReminder.dueAt,
                category: naturalReminder.category || "Simple Alert",
                icon: naturalReminder.icon || "🔔",
                isRecurring: false,
              });

              await ctx.reply(card, {
                parse_mode: "HTML",
                reply_markup: ReminderService.reminderActionsKeyboard(created.id, "rem"),
              });
              return;
            }
          }

          const { task, metadata } = await scheduledTaskFlowService.createProposal({
            telegramUserId: ctx.from.id,
            conversationId: globalContextData.conversationId,
            prompt: currentPrompt,
            title: taskIntent.taskTitle,
            goal: taskIntent.taskGoal || currentPrompt,
            explicitCron: taskIntent.cronExpression,
          });
          const card = scheduledTaskFlowService.formatProposalCard(task, metadata);
          const keyboard = scheduledTaskFlowService.proposalKeyboard(task.id);
          await ctx.reply(card, { parse_mode: "HTML", reply_markup: keyboard });
          return;
        } catch (e: any) {
          await ctx.reply(`❌ Failed to prepare schedule proposal: ${e.message}`);
          return;
        }
      } else if (taskIntent.intent === "SNOOZE_TASK") {
        const minutes = taskIntent.snoozeMinutes || 15;
        const recentReminder = await prisma.reminder.findFirst({
          where: { telegramUserId: ctx.from.id, status: { in: ["pending", "completed"] } },
          orderBy: { updatedAt: "desc" },
        });
        if (recentReminder) {
          const updated = await reminderService.snoozeReminder(recentReminder.id, minutes, ctx.from.id);
          if (updated) {
            const timeStr = ReminderService.formatUtcTimestamp(updated.dueAt);
            await ctx.reply(
              `⏰ Snoozed reminder "<b>${escapeHtml(updated.prompt)}</b>" for ${minutes}m (until <code>${timeStr}</code>).`,
              {
                parse_mode: "HTML",
                reply_markup: ReminderService.reminderActionsKeyboard(updated.id, "rem"),
              }
            );
            return;
          }
        }
        await ctx.reply("I couldn't find an active reminder to snooze. Let me know what you'd like to schedule!");
        return;
      } else if (taskIntent.intent === "COMPLETE_TASK") {
        const recentReminder = await prisma.reminder.findFirst({
          where: { telegramUserId: ctx.from.id, status: "pending" },
          orderBy: { dueAt: "desc" },
        });
        if (recentReminder) {
          await reminderService.completeReminder(recentReminder.id, ctx.from.id);
          await ctx.reply(`✅ Marked reminder "<b>${escapeHtml(recentReminder.prompt)}</b>" as done!`, {
            parse_mode: "HTML",
          });
          return;
        }
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.task) {
          await taskService.updateTaskStatus(resolved.task.id, "completed");
          await ctx.reply(`✅ Task #${resolved.task.id} ("<b>${escapeHtml(resolved.task.title)}</b>") marked as completed!`, {
            parse_mode: "HTML",
          });
          return;
        }
        await ctx.reply("✅ All caught up! You don't have any pending reminders or active tasks right now.");
        return;
      } else if (taskIntent.intent === "VIEW_TASKS") {
        const list = await scheduledTaskFlowService.formatTaskList(ctx.from.id);
        await ctx.reply(list.text, { parse_mode: "HTML", reply_markup: list.keyboard });
        return;
      } else if (taskIntent.intent === "RUN_TASK_NOW") {
        const query = (taskIntent.taskIdHint || taskIntent.taskTitle || "").trim().toLowerCase();
        const userTasks = await prisma.agentTask.findMany({
          where: {
            telegramUserId: ctx.from.id,
            status: { in: ["pending", "active", "paused"] },
          },
        });
        const matched = query
          ? userTasks.find(
              (t) => String(t.id) === query || t.title.toLowerCase().includes(query) || t.goal.toLowerCase().includes(query),
            )
          : userTasks[0];
        if (matched) {
          await ctx.reply(`⚡ <i>Running "${escapeHtml(matched.title)}" now...</i>`, { parse_mode: "HTML" });
          await cronTaskService.executeTaskNow(matched.id);
          return;
        }
        await ctx.reply("Which task would you like to run? You can ask 'show my tasks' to see all scheduled tasks.");
        return;
      } else if (taskIntent.intent === "CANCEL_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.task) {
          await taskService.updateTaskStatus(resolved.task.id, "cancelled");
          await ctx.reply(`❌ Task #${resolved.task.id} (${escapeHtml(resolved.task.title)}) cancelled.`);
          return;
        }
        const recentReminder = await prisma.reminder.findFirst({
          where: { telegramUserId: ctx.from.id, status: "pending" },
          orderBy: { dueAt: "desc" },
        });
        if (recentReminder) {
          await reminderService.completeReminder(recentReminder.id, ctx.from.id);
          await ctx.reply(`❌ Reminder "<b>${escapeHtml(recentReminder.prompt)}</b>" cancelled.`, { parse_mode: "HTML" });
          return;
        }
        await ctx.reply("No active task or reminder found to cancel.");
        return;
      } else if (taskIntent.intent === "PAUSE_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.task) {
          await taskService.updateTaskStatus(resolved.task.id, "paused");
          await ctx.reply(
            `⏸️ <b>Task Paused: ${escapeHtml(resolved.task.title)}</b>\n\nIt will not run automatically while paused. You can resume it anytime:`,
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().text("▶️ Resume Task", `sched:resume:${resolved.task.id}`),
            }
          );
          return;
        }
        await ctx.reply("No active task found to pause.");
        return;
      } else if (taskIntent.intent === "CONTINUE_TASK") {
        const resolved = await taskService.resolveTargetTask(ctx.from.id, taskIntent.taskIdHint);
        if (resolved.status === "AMBIGUOUS" && resolved.activeTasks) {
          await ctx.reply("Which task would you like to continue?", { reply_markup: taskDisambiguationKeyboard(resolved.activeTasks) });
          return;
        }
        if (resolved.task) {
          const steps = await chatDatabaseService.getTaskSteps(resolved.task.id);
          activeTaskContext = { task: resolved.task, steps };
        }
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
        const quotaCheck = await userTierService.checkToolQuota(ctx.from.id, "video");
        if (!quotaCheck.allowed) {
          await ctx.reply(quotaCheck.message || "Video quota exceeded.");
          return;
        }
        const stopVideoPresence = startTypingIndicator(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: false });
        let progressMessageId: number | undefined;
        let statusMessageId: number | undefined;
        try {
          // Queue Transparency
          const statusMsg = await ctx.reply(
            "🎬 <b>Video Request Queued</b>\n\nVideo rendering is queued due to high demand. Generative diffusion typically takes 30–60 seconds.\n\n<i>I will notify you here once it is ready!</i>",
            { parse_mode: "HTML" }
          ).catch(() => null);
          if (statusMsg) statusMessageId = statusMsg.message_id;

          progressMessageId = await interactionPresentationService.renderProgress(ctx, { state: "executing_tool", toolName: "video_generation", operationLabel: "video generation", chatAction: "upload_video", expectsLongRunning: true, userFacingProgress: true, elapsedMs: 0 });
          const startedAt = Date.now();
          const videoResult = await VideoGenerationService.generate(adaptivePlan.videoPrompt, gemini);

          const vidProviderLabel = videoResult.provider === "huggingface" ? "🤗 Hugging Face" : videoResult.provider === "gemini" ? "✨ Google Imagen/Veo" : (videoResult.provider || "Adaptive Media Router");
          const vidModelLabel = videoResult.model ? ` (${videoResult.model})` : "";
          const vidEnhancerTag = videoResult.enhancerName ? `<i>✨ Enhanced (${escapeHtml(videoResult.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
          
          const safeRaw = (adaptivePlan.videoPrompt || "").length > 180 ? adaptivePlan.videoPrompt.slice(0, 175) + "..." : adaptivePlan.videoPrompt;
          const safeEnhanced = (videoResult.enhancedPrompt || "").length > 200 ? videoResult.enhancedPrompt.slice(0, 195) + "..." : (videoResult.enhancedPrompt || "");
          const isEnhancedDiff = safeEnhanced.toLowerCase() !== safeRaw.toLowerCase() && safeEnhanced.length > 5;

          const htmlCaption = [
            `<b>🎬 Prompt:</b> ${escapeHtml(safeRaw)}`,
            isEnhancedDiff ? `${vidEnhancerTag} ${escapeHtml(safeEnhanced)}` : null,
            `<i>Engine: ${escapeHtml(vidProviderLabel)}${escapeHtml(vidModelLabel)}</i>`
          ].filter(Boolean).join("\n\n");
          const plainCaption = [
            `🎬 Prompt: ${safeRaw}`,
            isEnhancedDiff ? `✨ AI Enhanced: ${safeEnhanced}` : null,
            `Engine: ${vidProviderLabel}${vidModelLabel}`
          ].filter(Boolean).join("\n\n");

          if (progressMessageId) await ctx.api.deleteMessage(ctx.chat.id, progressMessageId).catch(() => {});

          let videoDelivered = false;
          if (videoResult.isVideo && Buffer.isBuffer(videoResult.buffer) && videoResult.buffer.length > 1000) {
            try {
              await ctx.replyWithVideo(new InputFile(videoResult.buffer, "video.mp4"), { caption: htmlCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
              videoDelivered = true;
            } catch (htmlCapErr) {
              logger.warn({ stage: "video_caption_parse_error", error: safeErrorMetadata(htmlCapErr) }, "HTML video caption failed; retrying with plain text");
              try {
                await ctx.replyWithVideo(new InputFile(videoResult.buffer, "video.mp4"), { caption: plainCaption, reply_markup: feedbackKeyboard() });
                videoDelivered = true;
              } catch (plainCapErr) {
                logger.warn({ stage: "video_plain_caption_failed", error: safeErrorMetadata(plainCapErr) }, "Plain text video caption failed; retrying with no caption");
                try {
                  await ctx.replyWithVideo(new InputFile(videoResult.buffer, "video.mp4"), { reply_markup: feedbackKeyboard() });
                  videoDelivered = true;
                } catch (noCapErr) {
                  logger.warn({ stage: "video_buffer_upload_failed", error: safeErrorMetadata(noCapErr) }, "Direct video buffer upload failed");
                }
              }
            }
          }

          // Cloudinary / Public URL fallback
          if (!videoDelivered && videoResult.url && (videoResult.url.startsWith("http://") || videoResult.url.startsWith("https://"))) {
            try {
              await ctx.replyWithVideo(videoResult.url, { caption: plainCaption, reply_markup: feedbackKeyboard() });
              videoDelivered = true;
            } catch (urlErr) {
              logger.warn({ stage: "video_url_delivery_failed", error: safeErrorMetadata(urlErr) }, "Video delivery via URL failed; sending direct link");
              try {
                await ctx.reply(`🎬 <b>Here is your generated video:</b>\n<a href="${escapeHtml(videoResult.url)}">${escapeHtml(safeRaw)}</a>`, {
                  parse_mode: "HTML",
                  reply_markup: feedbackKeyboard(),
                });
                videoDelivered = true;
              } catch (linkErr) {
                logger.error({ stage: "video_link_delivery_failed", error: safeErrorMetadata(linkErr) }, "Direct link video delivery failed");
              }
            }
          }

          if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => {});

          if (videoDelivered) {
            await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", prompt));
            await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", `[Generated Video (${videoResult.provider}) for: "${safeRaw}"]`));
            await userTierService.consumeToolQuota(ctx.from.id, "video");
            logger.info({ stage: "video_generation", elapsedMs: Date.now() - startedAt }, "Natural video generation completed and delivered");
            if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId, { provider: videoResult.provider, mediaType: "video" });
            return;
          } else {
            throw new Error("Failed to deliver video across all transport tiers");
          }
        } catch (vidError) {
          logger.error({ vidError: safeErrorMetadata(vidError) }, "Natural video generation failed; notifying user with quota protection");
          if (progressMessageId) await ctx.api.deleteMessage(ctx.chat.id, progressMessageId).catch(() => {});
          if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => {});
          const friendlyNotice = [
            "🎬 <b>Video Engine Under Heavy Load</b>",
            "",
            "Our generative video diffusion engines are currently experiencing high demand or transient provider limits. Your video generation quota was <b>not consumed</b>.",
            "",
            "Please try your video request again in a few moments, or feel free to request an image generation instead!"
          ].join("\n");
          await ctx.reply(friendlyNotice, { parse_mode: "HTML" });
          return;
        } finally { stopVideoPresence(); }
      }

      if (!media && adaptivePlan.detectedIntent === "image_generation" && adaptivePlan.imagePrompt) {
        const quotaCheck = await userTierService.checkToolQuota(ctx.from.id, "image");
        if (!quotaCheck.allowed) {
          await ctx.reply(quotaCheck.message || "Image quota exceeded.");
          return;
        }
        const stopImagePresence = startTypingIndicator(ctx, { state: "generating", toolName: "image_generation", operationLabel: "image generation", chatAction: "upload_photo", userFacingProgress: false });
        try {
          const imageResult = await ImageGenerationService.generate(adaptivePlan.imagePrompt, gemini);
          const imgProviderLabel = imageResult.provider === "huggingface" ? "🤗 Hugging Face" : imageResult.provider === "gemini" ? "✨ Google Imagen" : (imageResult.provider || "Adaptive Media Router");
          const imgModelLabel = imageResult.model ? ` (${imageResult.model})` : "";
          const imageBadge = `<i>Engine: ${escapeHtml(imgProviderLabel)}${escapeHtml(imgModelLabel)}</i>`;
          const imgEnhancerTag = imageResult.enhancerName ? `<i>✨ Enhanced (${escapeHtml(imageResult.enhancerName)}):</i>` : `<i>✨ AI Enhanced:</i>`;
          
          const safeRaw = (adaptivePlan.imagePrompt || "").length > 180 ? adaptivePlan.imagePrompt.slice(0, 175) + "..." : adaptivePlan.imagePrompt;
          const safeEnhanced = (imageResult.enhancedPrompt || "").length > 200 ? imageResult.enhancedPrompt.slice(0, 195) + "..." : (imageResult.enhancedPrompt || "");
          const isEnhancedDiff = safeEnhanced.toLowerCase() !== safeRaw.toLowerCase() && safeEnhanced.length > 5;

          const htmlCaption = [
            `<b>🎨 Prompt:</b> ${escapeHtml(safeRaw)}`,
            isEnhancedDiff ? `${imgEnhancerTag} ${escapeHtml(safeEnhanced)}` : null,
            imageBadge
          ].filter(Boolean).join("\n\n");
          const plainCaption = [
            `🎨 Prompt: ${safeRaw}`,
            isEnhancedDiff ? `✨ AI Enhanced: ${safeEnhanced}` : null,
            `Engine: ${imgProviderLabel}${imgModelLabel}`
          ].filter(Boolean).join("\n\n");

          let photoDelivered = false;
          if (Buffer.isBuffer(imageResult.buffer) && imageResult.buffer.length >= 500) {
            try {
              await ctx.replyWithPhoto(new InputFile(imageResult.buffer, "image.jpg"), { caption: htmlCaption, parse_mode: "HTML", reply_markup: feedbackKeyboard() });
              photoDelivered = true;
            } catch (htmlErr) {
              logger.warn({ stage: "image_caption_parse_error", error: safeErrorMetadata(htmlErr) }, "HTML photo caption failed; retrying with plain text");
              try {
                await ctx.replyWithPhoto(new InputFile(imageResult.buffer, "image.jpg"), { caption: plainCaption, reply_markup: feedbackKeyboard() });
                photoDelivered = true;
              } catch (plainErr) {
                logger.warn({ stage: "image_plain_caption_failed", error: safeErrorMetadata(plainErr) }, "Plain text photo caption failed; retrying without caption");
                try {
                  await ctx.replyWithPhoto(new InputFile(imageResult.buffer, "image.jpg"), { reply_markup: feedbackKeyboard() });
                  photoDelivered = true;
                } catch (noCapErr) {
                  logger.warn({ stage: "image_buffer_upload_failed", error: safeErrorMetadata(noCapErr) }, "Direct image buffer upload failed");
                }
              }
            }
          }

          // Cloudinary / Public URL fallback
          if (!photoDelivered && imageResult.url && (imageResult.url.startsWith("http://") || imageResult.url.startsWith("https://"))) {
            try {
              await ctx.replyWithPhoto(imageResult.url, { caption: plainCaption, reply_markup: feedbackKeyboard() });
              photoDelivered = true;
            } catch (urlErr) {
              logger.warn({ stage: "image_url_photo_failed", error: safeErrorMetadata(urlErr) }, "Photo delivery via Cloudinary URL failed; sending direct link");
              try {
                await ctx.reply(`🎨 <b>Here is your generated image:</b>\n<a href="${escapeHtml(imageResult.url)}">${escapeHtml(safeRaw)}</a>`, {
                  parse_mode: "HTML",
                  reply_markup: feedbackKeyboard(),
                });
                photoDelivered = true;
              } catch (linkErr) {
                logger.error({ stage: "image_link_failed", error: safeErrorMetadata(linkErr) }, "Direct link delivery failed");
              }
            }
          }

          if (photoDelivered) {
            await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", prompt));
            await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", `[Generated Image for: "${safeRaw}"]`));
            await userTierService.consumeToolQuota(ctx.from.id, "image");
            if (registeredRequest) requestRegistryService.markCompleted(registeredRequest.requestId, { provider: imageResult.provider, mediaType: "image" });
            return;
          } else {
            throw new Error("Failed to deliver generated image through any transport tier");
          }
        } catch (imgError) {
          logger.error({ stage: "image_generation", error: safeErrorMetadata(imgError) }, "Natural image generation delivery failed; notifying user");
          await ctx.reply("Sorry, I encountered an issue delivering your generated image to Telegram. Your generation quota was not consumed. Please try again or rephrase your prompt.");
          return;
        } finally { stopImagePresence(); }
      }

      const assembledContext = await contextManagerService.assembleContext({ telegramUserId: ctx.from.id, conversationId: globalContextData.conversationId, userMessage: currentPrompt, effectiveModeInstruction: adaptivePlan.effectiveModeInstruction, activeTask: activeTaskContext, history: globalContextData.recentHistory });
      const execConfig = getExecutionConfig();
      const shouldUseDurableExecution = !media && execConfig.enabled && (adaptivePlan.executionProfile === "durable" || Boolean(activeTaskContext));
      if (shouldUseDurableExecution) {
        try {
          const taskId = activeTaskContext?.task?.id;
          if (registeredRequest) requestRegistryService.markExecuting(registeredRequest.requestId, { taskId });
          const planResult = await agentPlannerService.planAndCompile({
            telegramUserId: ctx.from.id,
            goal: currentPrompt,
            taskId,
            context: {
              capabilities: adaptivePlan.requiredCapabilities,
              conversationHistory: globalContextData.recentHistory,
              activeTask: activeTaskContext?.task ? { id: activeTaskContext.task.id, title: activeTaskContext.task.title || activeTaskContext.task.goal, goal: activeTaskContext.task.goal } : undefined,
            },
          });
          if (planResult.success && planResult.graph && !planResult.isDirectResponse) {
            const nodesList = Object.values(planResult.graph.nodes);
            logger.info({ graphId: planResult.graph.graphId, nodesCount: nodesList.length, telegramUserId: ctx.from.id, hasExplicitOrActiveTask: Boolean(taskId), executionProfile: adaptivePlan.executionProfile }, "TELEGRAM_AUTONOMOUS_EXECUTION_DISPATCHED");

            // 1 & 2. Stage 1: Intent Detection & Stage 2: Planned Steps
            let planMessageId: number | null = null;
            try {
              const planMsg = await ctx.reply(formatTaskPresentationPlan(nodesList), { parse_mode: "HTML" });
              planMessageId = planMsg.message_id;
            } catch (pErr) {
              logger.debug({ error: safeErrorMetadata(pErr) }, "Failed to send initial plan message");
            }

            const session = await executionEngine.startExecution({
              graphId: planResult.graph.graphId,
              planRevision: 1,
              requestId: registeredRequest?.requestId || `req_${Date.now()}_${ctx.from.id}`,
              taskId,
              executionContext: {
                telegramUserId: ctx.from.id,
                chatId: ctx.chat.id,
                conversationId: globalContextData.conversationId,
              },
            });

            // Stage 4: Human-in-the-Loop Safeguards
            if (session.status === "waiting_approval" || (session.status as string) === "WAITING_APPROVAL") {
              const waitingNodeId = session.waitingApprovalNodes?.[0] || "";
              const pendingApproval = await executionPersistence.getApproval(planResult.graph.graphId, 1, waitingNodeId);
              const approvalId = pendingApproval?.approvalId || `app_${planResult.graph.graphId}_r1_${waitingNodeId}`;

              if (registeredRequest) requestRegistryService.markClassified(registeredRequest.requestId, { kind: "clarification" });
              await ctx.reply(
                `⚠️ <b>Human-in-the-Loop Safeguard</b>\n\n` +
                `<i>This step requires your explicit approval before execution continues.</i>\n\n` +
                `<b>Step:</b> <code>${escapeHtml(waitingNodeId)}</code>\n` +
                `<b>Reason:</b> ${escapeHtml(pendingApproval?.reason || "Action requires explicit user confirmation")}`,
                { parse_mode: "HTML", reply_markup: executionApprovalKeyboard(approvalId) }
              );
              return;
            }

            // Stage 5: Completion Presentation & Summary
            if (session.status === "completed" || (session.status as string) === "COMPLETED") {
              // Update plan message with completed checkmarks
              if (planMessageId && ctx.chat?.id) {
                try {
                  const checkmarks = nodesList.map((n, i) => {
                    const title = n.title || (n.actionSpec?.toolName ? n.actionSpec.toolName.replace(/_/g, " ") : `Step ${i + 1}`);
                    return `• ✅ <b>Step ${i + 1} complete:</b> ${escapeHtml(title)}`;
                  }).join("\n");
                  await ctx.api.editMessageText(
                    ctx.chat.id,
                    planMessageId,
                    `📋 <b>Task Presentation Flow</b>\n\n${checkmarks}\n\n<i>All steps executed successfully!</i>`,
                    { parse_mode: "HTML" }
                  );
                } catch {
                  // Non-fatal if edit fails
                }
              }

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

              const summaryText = `🎯 <b>All steps finished! Here’s your summary:</b>\n\n${finalAnswer}`;
              await runStage("telegram_reply", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () =>
                ctx.reply(summaryText, { parse_mode: "HTML", reply_markup: feedbackKeyboard() }).catch(() => ctx.reply(finalAnswer, { reply_markup: feedbackKeyboard() }))
              );
              await conversations.addMessage(globalContextData.conversationId, "user", currentPrompt);
              await conversations.addMessage(globalContextData.conversationId, "model", finalAnswer);
              if (activeTaskContext) {
                const stepCount = activeTaskContext.steps.length;
                const stepUpdates = activeTaskContext.steps.map((s) => ({ stepOrder: s.stepOrder, status: "completed", resultSummary: `Completed in autonomous plan ${planResult.graph.graphId}` }));
                await taskService.updateTaskAndStepsAtomic({ taskId: activeTaskContext.task.id, stepUpdates, taskStatus: "completed", currentStep: stepCount });
              }
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
      const normalizedHistory: GeminiMessage[] = assembledContext.history
        .filter((m) => m.role === "user" || m.role === "model" || m.role === "assistant")
        .map((m) => ({
          role: (m.role === "assistant" ? "model" : m.role) as "user" | "model",
          content: stripMediaArtifactMetadata(m.content),
        }));
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
      const cleanReply = stripMediaArtifactMetadata(reply);
      await runStage("user_message_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "user", persistentUserMessage));
      await runStage("model_response_save", { telegramUserId: ctx.from.id, chatId: ctx.chat.id }, () => conversations.addMessage(globalContextData.conversationId, "model", cleanReply));
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
