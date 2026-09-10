import { InlineKeyboard, type Bot, type Context } from "grammy";
import { MODE_KEYS, MODES, type ModeKey } from "../config/mode";
import { PERSONALITY_KEYS, PERSONALITIES, type PersonalityKey } from "../config/personality";
import { memoryService } from "../services/memory.service";
import { CURRENT_ONBOARDING_VERSION, onboardingService, type OnboardingState, type ProactivityPreference } from "../services/onboarding.service";
import type { ConversationService } from "../services/conversation.service";
import type { ModeService } from "../services/mode.service";
import { settingsKeyboard } from "./keyboards";

export interface OnboardingDependencies {
  authorized: (userId: number) => boolean;
  upsertUser: (ctx: Context) => Promise<void>;
  conversations: ConversationService;
  modeService: ModeService;
}

function displayName(ctx: Context): string {
  return ctx.from?.first_name || ctx.from?.username || "there";
}

function isPersonalityKey(value: string): value is PersonalityKey {
  return (PERSONALITY_KEYS as readonly string[]).includes(value);
}

function isModeKey(value: string): value is ModeKey {
  return (MODE_KEYS as readonly string[]).includes(value);
}

function safeProactivityLabel(value: ProactivityPreference): string {
  return value === "never" ? "Only when you ask" : value === "proactive" ? "Be proactive" : "Occasionally";
}

function personalityOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  PERSONALITY_KEYS.forEach((key, index) => {
    keyboard.text(PERSONALITIES[key].label, `onboard:personality:${key}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard.text("⏭️ Skip", "onboard:skip:personality");
}

function modeOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  MODE_KEYS.forEach((key, index) => {
    keyboard.text(MODES[key].label, `onboard:mode:${key}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard.text("⏭️ Skip", "onboard:skip:mode");
}

function proactivityKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔕 Only when I ask", "onboard:proactivity:never").row()
    .text("🙂 Occasionally", "onboard:proactivity:occasional").row()
    .text("⚡ Be proactive", "onboard:proactivity:proactive").row()
    .text("⏭️ Skip", "onboard:skip:proactivity");
}

function memoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Enable Memory", "onboard:memory:enabled").row()
    .text("🔕 Keep Memory Off", "onboard:memory:disabled").row()
    .text("⏭️ Later", "onboard:skip:memory");
}

function aboutKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✍️ Tell Wingbuddy", "onboard:about:write").row()
    .text("⏭️ Skip", "onboard:about:skip");
}

function timezoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇳🇬 Africa/Lagos", "onboard:timezone:Africa/Lagos")
    .text("🇬🇧 Europe/London", "onboard:timezone:Europe/London").row()
    .text("🇺🇸 America/New_York", "onboard:timezone:America/New_York")
    .text("🇺🇸 America/Los_Angeles", "onboard:timezone:America/Los_Angeles").row()
    .text("⏭️ Keep default", "onboard:skip:timezone");
}

function welcomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🚀 Get Started", "onboard:start");
}

function migrationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⚙️ Personalize Wingbuddy", "onboard:migrate:start").row()
    .text("⏭️ Maybe Later", "onboard:migrate:later");
}

function mainOnboardingMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💬 Chat", "menu:chat").row()
    .text("✅ Tasks", "menu:main")
    .text("⏰ Reminders", "menu:reminders").row()
    .text("🧠 Memories", "menu:memory")
    .text("⚙️ Settings", "menu:settings");
}

function setupMigrationText(ctx: Context, personality: string, mode: string): string {
  return `👋 <b>Welcome back, ${displayName(ctx)}!</b>\n\nWingbuddy has a new personalization setup. Your existing conversations, memories, personality, and mode are staying intact. Nothing will be reset.\n\n<b>Current setup</b>\n🎭 Personality: ${personality}\n🧠 Default mode: ${mode}\n\nYou can personalize the newer preferences now, or continue using Wingbuddy exactly as before.`;
}

async function renderStep(ctx: Context, step: OnboardingState["step"]): Promise<void> {
  switch (step) {
    case "welcome":
      await ctx.reply(`👋 <b>Hey ${displayName(ctx)}!</b>\n\nI’m Wingbuddy. I can help you study, plan tasks, research, code, remember useful things, and handle everyday work.\n\nLet’s personalize your assistant first — it only takes a moment.`, { parse_mode: "HTML", reply_markup: welcomeKeyboard() });
      return;
    case "migration": {
      const personality = await onboardingServiceMigrationPersonality(ctx);
      const mode = await onboardingServiceMigrationMode(ctx);
      await ctx.reply(setupMigrationText(ctx, personality, mode), { parse_mode: "HTML", reply_markup: migrationKeyboard() });
      return;
    }
    case "personality":
      await ctx.reply("🎭 <b>How should I interact with you?</b>\n\nChoose the personality that feels right. You can change it later from Settings.", { parse_mode: "HTML", reply_markup: personalityOnboardingKeyboard() });
      return;
    case "mode":
      await ctx.reply("🧠 <b>What will you use Wingbuddy for most?</b>\n\nThis becomes your default mode. Wingbuddy can still adapt when your request needs something different.", { parse_mode: "HTML", reply_markup: modeOnboardingKeyboard() });
      return;
    case "proactivity":
      await ctx.reply("⚡ <b>How proactive should I be?</b>\n\nShould I only respond when you ask, or occasionally check in when I can be useful?", { parse_mode: "HTML", reply_markup: proactivityKeyboard() });
      return;
    case "memory":
      await ctx.reply("🧠 <b>Would you like me to remember useful things about you?</b>\n\nFor example, preferences, goals, or information you explicitly want me to remember. You stay in control and can review or remove memories anytime.", { parse_mode: "HTML", reply_markup: memoryKeyboard() });
      return;
    case "about_you":
      await ctx.reply("💭 <b>One last thing…</b>\n\nIs there anything you’d like me to know about you that could help me assist you better?\n\nYou can tell me about your goals, preferences, what you’re working on, how you like to communicate, or anything else that matters to you.\n\n<i>This is completely optional.</i>", { parse_mode: "HTML", reply_markup: aboutKeyboard() });
      return;
    case "timezone":
      await ctx.reply("🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", { parse_mode: "HTML", reply_markup: timezoneKeyboard() });
      return;
    case "ready":
      return;
  }
}

async function onboardingServiceMigrationPersonality(ctx: Context): Promise<string> {
  const profile = ctx.from ? await (ctx as any).__wingbuddyMigrationConversations?.getUserWithFullContext?.(ctx.from.id) : null;
  const value = profile?.personality;
  return typeof value === "string" && isPersonalityKey(value) ? PERSONALITIES[value].label : "Current setting";
}

async function onboardingServiceMigrationMode(ctx: Context): Promise<string> {
  const profile = ctx.from ? await (ctx as any).__wingbuddyMigrationConversations?.getUserWithFullContext?.(ctx.from.id) : null;
  const value = profile?.mode;
  return typeof value === "string" && isModeKey(value) ? MODES[value].label : "Current setting";
}

async function sendReadySummary(ctx: Context, deps: OnboardingDependencies, state: OnboardingState): Promise<void> {
  const profile = await deps.conversations.getUserWithFullContext(ctx.from!.id);
  const personalityKey = typeof profile?.personality === "string" && isPersonalityKey(profile.personality) ? profile.personality : null;
  const modeKey = typeof profile?.mode === "string" && isModeKey(profile.mode) ? profile.mode : null;
  const personality = personalityKey ? PERSONALITIES[personalityKey].label : "Default";
  const mode = modeKey ? MODES[modeKey].label : "Default";
  await ctx.reply(`✅ <b>Your Wingbuddy setup is ready!</b>\n\n🎭 Personality: ${personality}\n🧠 Default mode: ${mode}\n⚡ Proactivity: ${safeProactivityLabel(state.proactivityPreference)}\n🧠 Memory: ${state.memoryEnabled ? "Enabled" : "Off"}\n🌍 Timezone: ${state.timezone}\n\nYou can change your preferences later with <code>/setup</code>.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🚀 Continue to Wingbuddy", "onboard:finish") });
}

export async function startOnboarding(ctx: Context, deps: OnboardingDependencies): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const existedBeforeUpsert = await deps.conversations.userExists(ctx.from.id);
  await deps.upsertUser(ctx);
  let state = await onboardingService.get(ctx.from.id);

  if (state?.status === "completed" && state.version < CURRENT_ONBOARDING_VERSION) {
    state = await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id);
  } else if (!state) {
    state = existedBeforeUpsert
      ? await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id)
      : await onboardingService.start(ctx.from.id, ctx.chat.id);
  }

  if (state.status === "completed" && state.version >= CURRENT_ONBOARDING_VERSION) {
    await ctx.reply(`👋 <b>Welcome back, ${displayName(ctx)}!</b>\n\nYour Wingbuddy setup is already configured. What are we working on today?`, { parse_mode: "HTML", reply_markup: mainOnboardingMenu() });
    return;
  }
  await renderStep(ctx, state.step);
}

export function registerOnboardingHandlers(bot: Bot, deps: OnboardingDependencies): void {
  const ensure = (ctx: Context): boolean => Boolean(ctx.from && deps.authorized(ctx.from.id));

  bot.command("setup", async (ctx) => {
    if (!ensure(ctx) || !ctx.from) return;
    await deps.upsertUser(ctx);
    const state = await onboardingService.get(ctx.from.id);
    if (state?.status === "completed" && state.version >= CURRENT_ONBOARDING_VERSION) {
      await ctx.reply("⚙️ <b>Wingbuddy Setup</b>\n\nChoose what you’d like to change.", { parse_mode: "HTML", reply_markup: settingsKeyboard() });
      return;
    }
    await startOnboarding(ctx, deps);
  });

  bot.callbackQuery("onboard:start", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "personality", status: "in_progress", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🎭 <b>How should I interact with you?</b>\n\nChoose the personality that feels right. You can change it later from Settings.", { parse_mode: "HTML", reply_markup: personalityOnboardingKeyboard() });
  });

  bot.callbackQuery("onboard:migrate:start", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.startLegacyMigration(ctx.from.id, ctx.chat.id);
    const state = await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "proactivity" });
    await ctx.answerCallbackQuery({ text: "Personalization started" });
    await ctx.editMessageText("⚡ <b>Let’s personalize the new preferences</b>\n\nYour existing personality, default mode, conversations, tasks, reminders, and memories stay untouched.\n\nHow proactive should I be?", { parse_mode: "HTML", reply_markup: proactivityKeyboard() });
  });

  bot.callbackQuery("onboard:migrate:later", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.completeLegacyMigration(ctx.from.id, ctx.chat.id);
    await ctx.answerCallbackQuery({ text: "No changes made" });
    await ctx.editMessageText(`🪽 <b>Welcome back, ${displayName(ctx)}!</b>\n\nNo existing settings or data were changed. You can personalize Wingbuddy later with <code>/setup</code>.`, { parse_mode: "HTML", reply_markup: mainOnboardingMenu() });
  });

  bot.callbackQuery(/^onboard:personality:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const key = String(ctx.match[1]);
    if (!isPersonalityKey(key)) { await ctx.answerCallbackQuery({ text: "Unknown personality", show_alert: true }); return; }
    await deps.upsertUser(ctx);
    await deps.conversations.setUserPersonality(ctx.from.id, key);
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "mode", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery({ text: `${PERSONALITIES[key].label} selected` });
    await ctx.editMessageText("🧠 <b>What will you use Wingbuddy for most?</b>\n\nThis becomes your default mode. Wingbuddy can still adapt when your request needs something different.", { parse_mode: "HTML", reply_markup: modeOnboardingKeyboard() });
  });

  bot.callbackQuery(/^onboard:mode:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const key = String(ctx.match[1]);
    if (!isModeKey(key)) { await ctx.answerCallbackQuery({ text: "Unknown mode", show_alert: true }); return; }
    await deps.upsertUser(ctx);
    await deps.modeService.switchMode(ctx.from.id, key, "callback");
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "proactivity", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery({ text: `${MODES[key].label} selected` });
    await ctx.editMessageText("⚡ <b>How proactive should I be?</b>\n\nShould I only respond when you ask, or occasionally check in when I can be useful?", { parse_mode: "HTML", reply_markup: proactivityKeyboard() });
  });

  bot.callbackQuery(/^onboard:proactivity:(never|occasional|proactive)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "memory", version: CURRENT_ONBOARDING_VERSION, proactivityPreference: ctx.match[1] as ProactivityPreference });
    await ctx.answerCallbackQuery({ text: "Preference saved" });
    await ctx.editMessageText("🧠 <b>Would you like me to remember useful things about you?</b>\n\nFor example, preferences, goals, or information you explicitly want me to remember. You stay in control and can review or remove memories anytime.", { parse_mode: "HTML", reply_markup: memoryKeyboard() });
  });

  bot.callbackQuery(/^onboard:memory:(enabled|disabled)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you", version: CURRENT_ONBOARDING_VERSION, memoryEnabled: ctx.match[1] === "enabled" });
    await ctx.answerCallbackQuery({ text: ctx.match[1] === "enabled" ? "Memory enabled" : "Memory kept off" });
    await ctx.editMessageText("💭 <b>One last thing…</b>\n\nIs there anything you’d like me to know about you that could help me assist you better?\n\nYou can tell me about your goals, preferences, what you’re working on, how you like to communicate, or anything else that matters to you.\n\n<i>This is completely optional.</i>", { parse_mode: "HTML", reply_markup: aboutKeyboard() });
  });

  bot.callbackQuery("onboard:about:write", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("✍️ <b>Tell me about you</b>\n\nSend one message in your own words. I’ll pass it through Wingbuddy’s normal memory processing rather than blindly saving everything.", { parse_mode: "HTML" });
  });

  bot.callbackQuery("onboard:about:skip", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery({ text: "Skipped" });
    await ctx.editMessageText("🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", { parse_mode: "HTML", reply_markup: timezoneKeyboard() });
  });

  bot.callbackQuery(/^onboard:timezone:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const timezone = String(ctx.match[1]);
    let valid = false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); valid = true; } catch {}
    if (!valid) { await ctx.answerCallbackQuery({ text: "Invalid timezone", show_alert: true }); return; }
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", timezone, status: "completed", version: CURRENT_ONBOARDING_VERSION });
    const state = await onboardingService.get(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Setup complete" });
    if (state) await sendReadySummary(ctx, deps, state);
  });

  bot.callbackQuery(/^onboard:skip:(personality|mode|proactivity|memory|timezone)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const skipped = ctx.match[1];
    const next: Record<string, OnboardingState["step"]> = { personality: "mode", mode: "proactivity", proactivity: "memory", memory: "about_you", timezone: "ready" };
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: next[skipped], version: CURRENT_ONBOARDING_VERSION, ...(skipped === "timezone" ? { status: "completed" as const } : {}) });
    await ctx.answerCallbackQuery({ text: "Skipped" });
    if (skipped === "timezone") {
      const state = await onboardingService.get(ctx.from.id);
      if (state) await sendReadySummary(ctx, deps, state);
    } else {
      await renderStep(ctx, next[skipped]);
    }
  });

  bot.callbackQuery("onboard:finish", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", status: "completed", version: CURRENT_ONBOARDING_VERSION });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`🪽 <b>Welcome to Wingbuddy, ${displayName(ctx)}!</b>\n\nI’m ready when you are. Send me a message or choose an action below.`, { parse_mode: "HTML", reply_markup: mainOnboardingMenu() });
  });

  bot.on("message:text", async (ctx, next) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return next();
    const state = await onboardingService.get(ctx.from.id);
    if (!state || state.status === "completed") return next();
    if (state.step === "about_you") {
      await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone", version: CURRENT_ONBOARDING_VERSION });
      if (state.memoryEnabled) void memoryService.processBackgroundExtraction(ctx.from.id, ctx.message.text);
      await ctx.reply("🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", { parse_mode: "HTML", reply_markup: timezoneKeyboard() });
      return;
    }
    await renderStep(ctx, state.step);
    return;
  });
}
