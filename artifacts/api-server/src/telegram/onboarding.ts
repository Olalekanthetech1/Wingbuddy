import { InlineKeyboard, type Bot, type Context } from "grammy";
import { MODE_KEYS, MODES, type ModeKey } from "../config/mode";
import { PERSONALITY_KEYS, PERSONALITIES, type PersonalityKey } from "../config/personality";
import { memoryService } from "../services/memory.service";
import { onboardingService, type OnboardingState, type ProactivityPreference } from "../services/onboarding.service";
import type { ConversationService } from "../services/conversation.service";
import type { ModeService } from "../services/mode.service";

export interface OnboardingDependencies {
  authorized: (userId: number) => boolean;
  upsertUser: (ctx: Context) => Promise<void>;
  conversations: ConversationService;
  modeService: ModeService;
}

function displayName(ctx: Context): string {
  return ctx.from?.first_name || ctx.from?.username || "there";
}

function safeModeKey(value: string): ModeKey {
  return (MODE_KEYS as readonly string[]).includes(value) ? value as ModeKey : "general";
}

function safePersonalityKey(value: string): PersonalityKey {
  return (PERSONALITY_KEYS as readonly string[]).includes(value) ? value as PersonalityKey : "balanced";
}

function personalityOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  PERSONALITY_KEYS.forEach((key, index) => {
    keyboard.text(PERSONALITIES[key].label, `onboard:personality:${key}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.text("⏭️ Skip", "onboard:skip:personality");
  return keyboard;
}

function modeOnboardingKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  MODE_KEYS.forEach((key, index) => {
    keyboard.text(MODES[key].label, `onboard:mode:${key}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.text("⏭️ Skip", "onboard:skip:mode");
  return keyboard;
}

function proactivityKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔕 Only when I ask", "onboard:proactivity:never")
    .row()
    .text("🙂 Occasionally", "onboard:proactivity:occasional")
    .row()
    .text("⚡ Be proactive", "onboard:proactivity:proactive")
    .row()
    .text("⏭️ Skip", "onboard:skip:proactivity");
}

function memoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Enable Memory", "onboard:memory:enabled")
    .row()
    .text("🔕 Keep Memory Off", "onboard:memory:disabled")
    .row()
    .text("⏭️ Later", "onboard:skip:memory");
}

function aboutKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✍️ Tell Wingbuddy", "onboard:about:write").row().text("⏭️ Skip", "onboard:about:skip");
}

function timezoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🇳🇬 Africa/Lagos", "onboard:timezone:Africa/Lagos")
    .text("🇬🇧 Europe/London", "onboard:timezone:Europe/London")
    .row()
    .text("🇺🇸 America/New_York", "onboard:timezone:America/New_York")
    .text("🇺🇸 America/Los_Angeles", "onboard:timezone:America/Los_Angeles")
    .row()
    .text("⏭️ Keep default", "onboard:skip:timezone");
}

async function sendStep(ctx: Context, step: OnboardingState["step"]): Promise<void> {
  const name = displayName(ctx);
  switch (step) {
    case "welcome":
      await ctx.reply(
        `👋 <b>Hey ${name}!</b>\n\nI’m Wingbuddy. I can help you study, plan tasks, research, code, remember useful things, and handle everyday work.\n\nLet’s personalize your assistant first — it only takes a moment.`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🚀 Get Started", "onboard:start") },
      );
      return;
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

async function showReady(ctx: Context, state: OnboardingState): Promise<void> {
  const userContext = await ctx.from ? null : null;
  const personality = state ? await Promise.resolve("configured") : "configured";
  void userContext;
  void personality;
  await ctx.reply(
    `✅ <b>Your Wingbuddy setup is ready!</b>\n\n🎭 Personality: configured\n🧠 Default mode: configured\n⚡ Proactivity: ${state.proactivityPreference === "never" ? "Only when you ask" : state.proactivityPreference === "proactive" ? "Be proactive" : "Occasionally"}\n🧠 Memory: ${state.memoryEnabled ? "Enabled" : "Off"}\n🌍 Timezone: ${state.timezone}\n\nYou can change your preferences later with <code>/setup</code>.`,
    { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🚀 Continue to Wingbuddy", "onboard:finish") },
  );
}

export async function startOnboarding(ctx: Context, deps: OnboardingDependencies): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  await deps.upsertUser(ctx);
  const existing = await onboardingService.get(ctx.from.id);
  if (existing?.status === "completed") {
    await ctx.reply(`👋 <b>Welcome back, ${displayName(ctx)}!</b>\n\nYour Wingbuddy setup is already configured. What are we working on today?`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💬 Chat", "menu:chat").text("✅ Tasks", "menu:main").row().text("⏰ Reminders", "menu:reminders").text("⚙️ Setup", "menu:settings") });
    return;
  }
  const state = await onboardingService.start(ctx.from.id, ctx.chat.id);
  await sendStep(ctx, state.step === "welcome" ? "welcome" : state.step);
}

export function registerOnboardingHandlers(bot: Bot, deps: OnboardingDependencies): void {
  const ensure = (ctx: Context): boolean => Boolean(ctx.from && deps.authorized(ctx.from.id));

  bot.callbackQuery("onboard:start", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await ctx.answerCallbackQuery();
    const state = await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "personality", status: "in_progress" });
    await ctx.editMessageText("🎭 <b>How should I interact with you?</b>\n\nChoose the personality that feels right. You can change it later from Settings.", { parse_mode: "HTML", reply_markup: personalityOnboardingKeyboard() });
    void state;
  });

  bot.callbackQuery(/^onboard:personality:(playful|balanced|focused|professional)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const personality = safePersonalityKey(ctx.match[1]);
    await deps.upsertUser(ctx);
    await deps.conversations.setUserPersonality(ctx.from.id, personality);
    const state = await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "mode" });
    await ctx.answerCallbackQuery({ text: `${PERSONALITIES[personality].label} selected` });
    await ctx.editMessageText("🧠 <b>What will you use Wingbuddy for most?</b>\n\nThis becomes your default mode. Wingbuddy can still adapt when your request needs something different.", { parse_mode: "HTML", reply_markup: modeOnboardingKeyboard() });
    void state;
  });

  bot.callbackQuery(/^onboard:mode:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const rawMode = String(ctx.match[1]);
    if (!(MODE_KEYS as readonly string[]).includes(rawMode)) {
      await ctx.answerCallbackQuery({ text: "Unknown mode", show_alert: true });
      return;
    }
    const mode = safeModeKey(rawMode);
    await deps.upsertUser(ctx);
    await deps.modeService.switchMode(ctx.from.id, mode, "callback");
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "proactivity" });
    await ctx.answerCallbackQuery({ text: `${MODES[mode].label} selected` });
    await ctx.editMessageText("⚡ <b>How proactive should I be?</b>\n\nShould I only respond when you ask, or occasionally check in when I can be useful?", { parse_mode: "HTML", reply_markup: proactivityKeyboard() });
  });

  bot.callbackQuery(/^onboard:proactivity:(never|occasional|proactive)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const preference = ctx.match[1] as ProactivityPreference;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "memory", proactivityPreference: preference });
    await ctx.answerCallbackQuery({ text: "Preference saved" });
    await ctx.editMessageText("🧠 <b>Would you like me to remember useful things about you?</b>\n\nFor example, preferences, goals, or information you explicitly want me to remember. You stay in control and can review or remove memories anytime.", { parse_mode: "HTML", reply_markup: memoryKeyboard() });
  });

  bot.callbackQuery(/^onboard:memory:(enabled|disabled)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const enabled = ctx.match[1] === "enabled";
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you", memoryEnabled: enabled });
    await ctx.answerCallbackQuery({ text: enabled ? "Memory enabled" : "Memory kept off" });
    await ctx.editMessageText("💭 <b>One last thing…</b>\n\nIs there anything you’d like me to know about you that could help me assist you better?\n\nYou can tell me about your goals, preferences, what you’re working on, how you like to communicate, or anything else that matters to you.\n\n<i>This is completely optional.</i>", { parse_mode: "HTML", reply_markup: aboutKeyboard() });
  });

  bot.callbackQuery("onboard:about:write", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "about_you" });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("✍️ <b>Tell me about you</b>\n\nSend one message in your own words. I’ll pass it through Wingbuddy’s normal memory processing rather than blindly saving everything.", { parse_mode: "HTML" });
  });

  bot.callbackQuery("onboard:about:skip", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone" });
    await ctx.answerCallbackQuery({ text: "Skipped" });
    await ctx.editMessageText("🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", { parse_mode: "HTML", reply_markup: timezoneKeyboard() });
  });

  bot.callbackQuery(/^onboard:timezone:(.+)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const timezone = String(ctx.match[1]);
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", timezone, status: "completed" });
    const state = await onboardingService.get(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "Setup complete" });
    if (state) await showReady(ctx, state);
  });

  bot.callbackQuery(/^onboard:skip:(personality|mode|proactivity|memory|timezone)$/, async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const skipped = ctx.match[1];
    const next: Record<string, OnboardingState["step"]> = {
      personality: "mode",
      mode: "proactivity",
      proactivity: "memory",
      memory: "about_you",
      timezone: "ready",
    };
    await onboardingService.save(ctx.from.id, ctx.chat.id, {
      step: next[skipped],
      ...(skipped === "timezone" ? { status: "completed" } : {}),
    });
    await ctx.answerCallbackQuery({ text: "Skipped" });
    if (skipped === "timezone") {
      const state = await onboardingService.get(ctx.from.id);
      if (state) await showReady(ctx, state);
      return;
    }
    await ctx.editMessageText(stepText(next[skipped]), { parse_mode: "HTML", reply_markup: stepKeyboard(next[skipped]) });
  });

  bot.callbackQuery("onboard:finish", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    await ctx.answerCallbackQuery();
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "ready", status: "completed" });
    await ctx.editMessageText(`🪽 <b>Welcome to Wingbuddy, ${displayName(ctx)}!</b>\n\nI’m ready when you are. Send me a message or choose an action below.`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💬 Chat", "menu:chat").row().text("✅ Tasks", "menu:main").text("⏰ Reminders", "menu:reminders").row().text("🧠 Memories", "menu:memory").text("⚙️ Setup", "menu:settings") });
  });

  bot.on("message:text", async (ctx) => {
    if (!ensure(ctx) || !ctx.from || !ctx.chat) return;
    const state = await onboardingService.get(ctx.from.id);
    if (!state || state.status === "completed" || state.step !== "about_you") return;
    await onboardingService.save(ctx.from.id, ctx.chat.id, { step: "timezone" });
    if (state.memoryEnabled) void memoryService.processBackgroundExtraction(ctx.from.id, ctx.message.text);
    await ctx.reply("🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.", { parse_mode: "HTML", reply_markup: timezoneKeyboard() });
  });
}

function stepText(step: OnboardingState["step"]): string {
  switch (step) {
    case "mode": return "🧠 <b>What will you use Wingbuddy for most?</b>\n\nThis becomes your default mode. Wingbuddy can still adapt when your request needs something different.";
    case "proactivity": return "⚡ <b>How proactive should I be?</b>\n\nShould I only respond when you ask, or occasionally check in when I can be useful?";
    case "memory": return "🧠 <b>Would you like me to remember useful things about you?</b>\n\nFor example, preferences, goals, or information you explicitly want me to remember. You stay in control and can review or remove memories anytime.";
    case "about_you": return "💭 <b>One last thing…</b>\n\nIs there anything you’d like me to know about you that could help me assist you better?\n\nYou can tell me about your goals, preferences, what you’re working on, how you like to communicate, or anything else that matters to you.\n\n<i>This is completely optional.</i>";
    case "timezone": return "🌍 <b>What timezone should I use for your scheduled assistant features?</b>\n\nYou can change this later. Choose the closest option or keep the default.";
    default: return "";
  }
}

function stepKeyboard(step: OnboardingState["step"]): InlineKeyboard {
  switch (step) {
    case "mode": return modeOnboardingKeyboard();
    case "proactivity": return proactivityKeyboard();
    case "memory": return memoryKeyboard();
    case "about_you": return aboutKeyboard();
    case "timezone": return timezoneKeyboard();
    default: return new InlineKeyboard();
  }
}
