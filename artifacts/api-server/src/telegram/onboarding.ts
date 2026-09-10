import { InlineKeyboard, type Bot, type Context } from "grammy";
import { MODE_KEYS, MODES, type ModeKey } from "../config/mode";
import { PERSONALITY_KEYS, PERSONALITIES, type PersonalityKey } from "../config/personality";
import { memoryService } from "../services/memory.service";
import { taskService } from "../services/task.service";
import { reminderService } from "../services/reminder.service";
import { CURRENT_ONBOARDING_VERSION, onboardingService, type OnboardingState, type ProactivityPreference } from "../services/onboarding.service";
import { adaptiveStartExperienceService } from "./adaptive-start-experience.service";
import type { ConversationService } from "../services/conversation.service";
import type { ModeService } from "../services/mode.service";
import { mainMenuKeyboard, settingsKeyboard } from "./keyboards";

export interface OnboardingDependencies {
  authorized: (userId: number) => boolean;
  upsertUser: (ctx: Context) => Promise<void>;
  conversations: ConversationService;
  modeService: ModeService;
}

function displayName(ctx: Context): string { return ctx.from?.first_name || ctx.from?.username || "there"; }
function isPersonalityKey(value: string): value is PersonalityKey { return (PERSONALITY_KEYS as readonly string[]).includes(value); }
function isModeKey(value: string): value is ModeKey { return (MODE_KEYS as readonly string[]).includes(value); }
function safeProactivityLabel(value: ProactivityPreference): string { return value === "never" ? "Only when you ask" : value === "proactive" ? "Be proactive" : "Occasionally"; }

function personalityOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  PERSONALITY_KEYS.forEach((key, index) => { keyboard.text(PERSONALITIES[key].label, `onboard:personality:${key}`); if (index % 2 === 1) keyboard.row(); });
  return keyboard.text("⏭️ Skip", "onboard:skip:personality");
}

function modeOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  MODE_KEYS.forEach((key, index) => { keyboard.text(MODES[key].label, `onboard:mode:${key}`); if (index % 2 === 1) keyboard.row(); });
  return keyboard.text("⏭️ Skip", "onboard:skip:mode");
}

function proactivityKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔕 Only when I ask", "onboard:proactivity:never").row().text("🙂 Occasionally", "onboard:proactivity:occasional").row().text("⚡ Be proactive", "onboard:proactivity:proactive").row().text("⏭️ Skip", "onboard:skip:proactivity");
}

function memoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Enable Memory", "onboard:memory:enabled").row().text("🔕 Keep Memory Off", "onboard:memory:disabled").row().text("⏭️ Later", "onboard:skip:memory");
}

function aboutChoiceKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✍️ Tell Wingbuddy", "onboard:about:write").row().text("⏭️ Skip", "onboard:about:skip");
}

function timezoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🇳🇬 Africa/Lagos", "onboard:timezone:Africa/Lagos").text("🇬🇧 Europe/London", "onboard:timezone:Europe/London").row().text("🇺🇸 America/New_York", "onboard:timezone:America/New_York").text("🇺🇸 America/Los_Angeles", "onboard:timezone:America/Los_Angeles").row().text("⏭️ Keep default", "onboard:skip:timezone");
}

function welcomeKeyboard(): InlineKeyboard { return new InlineKeyboard().text("🚀 Get Started", "onboard:start"); }
function migrationKeyboard(): InlineKeyboard { return new InlineKeyboard().text("⚙️ Personalize Wingbuddy", "onboard:migrate:start").row().text("⏭️ Maybe Later", "onboard:migrate:later"); }

function setupMigrationText(ctx: Context, personality: string, mode: string): string {
  return `👋 <b>Welcome back, ${displayName(ctx)}!</b>\n\nWingbuddy has a new personalization setup. Your existing conversations, memories, personality, and mode are staying intact. Nothing will be reset.\n\n<b>Current setup</b>\n🎭 Personality: ${personality}\n🧠 Default mode: ${mode}\n\nYou can personalize the newer preferences now, or continue using Wingbuddy exactly as before.`;
}

function stepContent(ctx: Context, step: OnboardingState["step"]): { text: string; replyMarkup?: InlineKeyboard } | null {
  switch (step) {
    case "welcome": return { text: `👋 <b>Hey ${displayName(ctx)}!</b>\n\nI’m Wingbuddy. I can help you study, plan tasks, research, code, remember useful things, and handle everyday work.\n\nLet’s personalize your assistant first — it only takes a moment.`, replyMarkup: welcomeKeyboard() };
    case "personality": return { text: "🎭 <b>How should I interact with you?</b>\n\nChoose the personality that feels right. You can change it later from Settings.", replyMarkup: personalityOnboardingKeyboard() };
    case "mode": return { text: "🧠 <b>What will you use Wingbuddy for most?</b>\n\nThis becomes your default mode. Wingbuddy can still adapt when your request needs something different.", replyMarkup: modeOnboardingKeyboard() };
    case "proactivity": return { text: "⚡ <b>How proactive should I be?</b>\n\nShould I only respond when you ask, or occasionally check in when I can be useful?", replyMarkup: proactivityKeyboard() };
    case "memory": return { text: "🧠 <b>Would you like me to remember useful things about you?</b>\n\nFor example, preferences, goals, or information you explicitly want me to remember. You stay in control and can review or remove memories anytime.", replyMarkup: memoryKeyboard() };
    case "about_you": return { text: "💭 <b>One last thing…</b>\n\nIs there anything you’d like me to know about you that could help me assist you better?\n\nYou can tell me about your goals, preferences, what you’re working on, how you like to communicate, or anything else that matters to you.\n\n<i>This is completely optional.</i>", replyMarkup: aboutChoiceKeyboard() };
    case "timezone": return { text: "🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", replyMarkup: timezoneKeyboard() };
    default: return null;
  }
}

async function editCurrentMessage(ctx: Context, text: string, replyMarkup?: InlineKeyboard): Promise<boolean> {
  try { await ctx.editMessageText(text, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }); return true; }
  catch (error) { return String(error).toLowerCase().includes("message is not modified"); }
}

async function deleteActiveMessage(ctx: Context, state: OnboardingState): Promise<void> {
  if (!state.activeMessageId || !ctx.from) return;
  await ctx.api.deleteMessage(state.chatId, state.activeMessageId).catch(() => {});
  await onboardingService.setActiveMessage(ctx.from.id, state.chatId, null);
}

async function sendAndTrack(ctx: Context, chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
  const sent = await ctx.api.sendMessage(chatId, text, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  await onboardingService.setActiveMessage(ctx.from!.id, chatId, sent.message_id);
}

async function showStep(ctx: Context, step: OnboardingState["step"], preferEdit = true): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const current = await onboardingService.get(ctx.from.id);
  if (!current || current.status === "completed") return;
  const content = stepContent(ctx, step);
  if (!content) return;
  if (preferEdit && current.activeMessageId) {
    const callbackMessageId = ctx.callbackQuery?.message?.message_id;
    if (!callbackMessageId || callbackMessageId === current.activeMessageId) {
      if (await editCurrentMessage(ctx, content.text, content.replyMarkup)) {
        await onboardingService.save(ctx.from.id, ctx.chat.id, { step, version: CURRENT_ONBOARDING_VERSION });
        return;
      }
    }
    await deleteActiveMessage(ctx, current);
  }
  await onboardingService.save(ctx.from.id, ctx.chat.id, { step, version: CURRENT_ONBOARDING_VERSION, activeMessageId: null });
  const fresh = await onboardingService.get(ctx.from.id);
  if (fresh) await sendAndTrack(ctx, ctx.chat.id, content.text, content.replyMarkup);
}

async function buildAdaptiveMainMenuText(ctx: Context, deps: OnboardingDependencies, isReturningUserOverride?: boolean): Promise<string> {
  if (!ctx.from || !ctx.chat) return "🪽 Wingbuddy is ready.";

  const [state, profile, activeTasks, activeReminders, recentSummary] = await Promise.all([
    onboardingService.get(ctx.from.id),
    deps.conversations.getUserWithFullContext(ctx.from.id),
    taskService.getActiveTasksForUser(ctx.from.id),
    reminderService.getActiveUserReminders(ctx.from.id),
    deps.conversations.getRecentSessionSummary(ctx.from.id, ctx.chat.id),
  ]);

  const rawMode = typeof profile?.mode === "string" && isModeKey(profile.mode) ? profile.mode : "general";
  const reminders = [...activeReminders].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const nextReminder = reminders.find((reminder) => Number.isFinite(new Date(reminder.dueAt).getTime())) ?? null;

  return adaptiveStartExperienceService.build({
    displayName: displayName(ctx),
    isReturningUser: isReturningUserOverride ?? Boolean(state?.status === "completed"),
    mode: rawMode,
    activeTaskCount: activeTasks.length,
    activeReminderCount: activeReminders.length,
    nextReminderDueAt: nextReminder ? new Date(nextReminder.dueAt) : null,
    recentSessionAvailable: Boolean(recentSummary?.trim()),
    timezone: state?.timezone || "Africa/Lagos",
  });
}

async function sendReadySummary(ctx: Context, deps: OnboardingDependencies, state: OnboardingState): Promise<void> {
  const profile = await deps.conversations.getUserWithFullContext(ctx.from!.id);
  const personalityKey = typeof profile?.personality === "string" && isPersonalityKey(profile.personality) ? profile.personality : null;
  const modeKey = typeof profile?.mode === "string" && isModeKey(profile.mode) ? profile.mode : null;
  const personality = personalityKey ? PERSONALITIES[personalityKey].label : "Default";
  const mode = modeKey ? MODES[modeKey].label : "Default";
  const text = `✅ <b>Your Wingbuddy setup is ready!</b>\n\n🎭 Personality: ${personality}\n🧠 Default mode: ${mode}\n⚡ Proactivity: ${safeProactivityLabel(state.proactivityPreference)}\n🧠 Memory: ${state.memoryEnabled ? "Enabled" : "Off"}\n🌍 Timezone: ${state.timezone}\n\nYou can change your preferences later with <code>/setup</code>.`;
  const keyboard = new InlineKeyboard().text("🚀 Continue to Wingbuddy", "onboard:finish");
  if (state.activeMessageId && await editCurrentMessage(ctx, text, keyboard)) return;
  await deleteActiveMessage(ctx, state);
  await sendAndTrack(ctx, ctx.chat!.id, text, keyboard);
}

export async function startOnboarding(ctx: Context, deps: OnboardingDependencies): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const existedBeforeUpsert = await deps.conversations.userExists(ctx.from.id);
  await deps.upsertUser(ctx);
  let state = await onboardingService.get(ctx.from.id);
  if (state?.status === "completed" && state.version < CURRENT_ONBOARDING_VERSION) state = await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id);
  else if (!state) state = existedBeforeUpsert ? await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id) : await onboardingService.start(ctx.from.id, ctx.chat.id);
  if (state.status === "completed" && state.version >= CURRENT_ONBOARDING_VERSION) {
    const text = await buildAdaptiveMainMenuText(ctx, deps, true);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
    return;
  }
  if (state.step === "migration") {
    const profile = await deps.conversations.getUserWithFullContext(ctx.from.id);
    const personality = typeof profile?.personality === "string" && isPersonalityKey(profile.personality) ? PERSONALITIES[profile.personality].label : "Current setting";
    const mode = typeof profile?.mode === "string" && isModeKey(profile.mode) ? MODES[profile.mode].label : "Current setting";
    const text = setupMigrationText(ctx, personality, mode);
    if (state.activeMessageId && await editCurrentMessage(ctx, text, migrationKeyboard())) return;
    await deleteActiveMessage(ctx, state);
    await sendAndTrack(ctx, ctx.chat.id, text, migrationKeyboard());
    return;
  }
  if (state.activeMessageId) return;
  await showStep(ctx, state.step, false);
}

export function registerOnboardingHandlers(bot: Bot, deps: OnboardingDependencies): void {
  const ensure = (ctx: Context): boolean => Boolean(ctx.from && deps.authorized(ctx.from.id));

  // Registered before the broader menu callback in bot.ts so the main menu is always contextual.
  bot.callbackQuery("menu:main", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await ctx.answerCallbackQuery();
    const text = await buildAdaptiveMainMenuText(ctx, deps, true);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
    });
  });

  bot.command("setup", async (ctx) => {
    if (!ensure(ctx) || !ctx.from) return;
    await deps.upsertUser(ctx);
    const state = await onboardingService.get(ctx.from.id);
    if (state?.status === "completed" && state.version >= CURRENT_ONBOARDING_VERSION) { await ctx.reply("⚙️ <b>Wingbuddy Setup</b>\n\nChoose what you’d like to change.", { parse_mode: "HTML", reply_markup: settingsKeyboard() }); return; }
    await startOnboarding(ctx, deps);
  });

  bot.callbackQuery("onboard:start", async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "personality", status: "in_progress", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery(); await showStep(ctx, "personality", true); });

  bot.callbackQuery("onboard:migrate:start", async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id); await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "proactivity", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery({ text: "Personalization started" }); await showStep(ctx, "proactivity", true); });

  bot.callbackQuery("onboard:migrate:later", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const current = await onboardingService.get(ctx.from.id);
    await onboardingService.completeLegacyMigration(ctx.from.id, ctx.chat.id);
    const text = await buildAdaptiveMainMenuText(ctx, deps, true);
    await ctx.answerCallbackQuery({ text: "No changes made" });
    if (current?.activeMessageId && await editCurrentMessage(ctx, text, mainMenuKeyboard())) { await onboardingService.setActiveMessage(ctx.from.id, ctx.chat.id, null); return; }
    if (current) await deleteActiveMessage(ctx, current);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery(/^onboard:personality:(.+)$/, async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; const key = String(ctx.match[1]); if (!isPersonalityKey(key)) { await ctx.answerCallbackQuery({ text: "Unknown personality", show_alert: true }); return; } await deps.conversations.setUserPersonality(ctx.from.id, key); await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "mode", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery({ text: `${PERSONALITIES[key].label} selected` }); await showStep(ctx, "mode", true); });

  bot.callbackQuery(/^onboard:mode:(.+)$/, async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; const key = String(ctx.match[1]); if (!isModeKey(key)) { await ctx.answerCallbackQuery({ text: "Unknown mode", show_alert: true }); return; } await deps.modeService.switchMode(ctx.from.id, key, "callback"); await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "proactivity", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery({ text: `${MODES[key].label} selected` }); await showStep(ctx, "proactivity", true); });

  bot.callbackQuery(/^onboard:proactivity:(never|occasional|proactive)$/, async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "memory", version: CURRENT_ONBOARDING_VERSION, proactivityPreference: ctx.match[1] as ProactivityPreference }); await ctx.answerCallbackQuery({ text: "Preference saved" }); await showStep(ctx, "memory", true); });

  bot.callbackQuery(/^onboard:memory:(enabled|disabled)$/, async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you", version: CURRENT_ONBOARDING_VERSION, memoryEnabled: ctx.match[1] === "enabled" }); await ctx.answerCallbackQuery({ text: ctx.match[1] === "enabled" ? "Memory enabled" : "Memory kept off" }); await showStep(ctx, "about_you", true); });

  bot.callbackQuery("onboard:about:write", async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery(); await editCurrentMessage(ctx, "✍️ <b>Tell me about you</b>\n\nSend one message in your own words. I’ll pass it through Wingbuddy’s normal memory processing rather than blindly saving everything."); });

  bot.callbackQuery("onboard:about:skip", async (ctx) => { if (!ensure(ctx) || !ctx.from || !ctx.chat) return; await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery({ text: "Skipped" }); await showStep(ctx, "timezone", true); });

  bot.callbackQuery(/^onboard:timezone:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const timezone = String(ctx.match[1]);
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { await ctx.answerCallbackQuery({ text: "Invalid timezone", show_alert: true }); return; }
    const state = await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", timezone, status: "completed", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery({ text: "Setup complete" });
    await sendReadySummary(ctx, deps, state);
  });

  bot.callbackQuery(/^onboard:skip:(personality|mode|proactivity|memory|timezone)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const skipped = ctx.match[1];
    const next: Record<string, OnboardingState["step"]> = { personality: "mode", mode: "proactivity", proactivity: "memory", memory: "about_you", timezone: "ready" };
    const nextStep = next[skipped];
    if (skipped === "timezone") { const state = await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", status: "completed", version: CURRENT_ONBOARDING_VERSION }); await ctx.answerCallbackQuery({ text: "Setup complete" }); await sendReadySummary(ctx, deps, state); return; }
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: nextStep, version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery({ text: "Skipped" });
    await showStep(ctx, nextStep, true);
  });

  bot.callbackQuery("onboard:finish", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const current = await onboardingService.get(ctx.from.id);
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", status: "completed", version: CURRENT_ONBOARDING_VERSION, activeMessageId: null });
    const text = await buildAdaptiveMainMenuText(ctx, deps, false);
    await ctx.answerCallbackQuery();
    if (current?.activeMessageId && await editCurrentMessage(ctx, text, mainMenuKeyboard())) return;
    if (current) await deleteActiveMessage(ctx, current);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
  });

  bot.on("message:text", async (ctx, next) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return next();
    const state = await onboardingService.get(ctx.from.id);
    if (!state || state.status === "completed") return next();
    if (state.step === "about_you") {
      await deleteActiveMessage(ctx, state);
      await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone", version: CURRENT_ONBOARDING_VERSION });
      if (state.memoryEnabled) void memoryService.processBackgroundExtraction(ctx.from.id, ctx.message.text);
      await showStep(ctx, "timezone", false);
      return;
    }
    await showStep(ctx, state.step, true);
  });
}
