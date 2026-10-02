import type { Context } from "grammy";
import {
  reactionThemeService,
  type ReactionThemeDefinition,
} from "../services/reaction-theme.service";
import { logger } from "../lib/logger";

export type InteractionProgressState =
  | "received"
  | "understanding"
  | "retrieving_context"
  | "searching"
  | "executing_tool"
  | "reasoning"
  | "generating"
  | "verifying"
  | "finalizing"
  | "completed"
  | "failed";

export type InteractionChatAction =
  | "typing"
  | "upload_photo"
  | "upload_video"
  | "upload_document"
  | "record_voice"
  | "record_video";

export interface InteractionRuntimeEvent {
  state: InteractionProgressState;
  telegramUserId?: string | number;
  toolName?: string | null;
  operationLabel?: string | null;
  progressText?: string | null;
  chatAction?: InteractionChatAction | null;
  reaction?: string | null;
  expectsLongRunning?: boolean;
  userFacingProgress?: boolean;
  showThinking?: boolean;
  elapsedMs?: number;
}

export interface InteractionPresentationDecision {
  reaction?: string;
  chatAction?: InteractionChatAction;
  visibleProgressText?: string;
}

export interface InteractionPresentationHints extends Partial<InteractionRuntimeEvent> {}

export interface InteractionPresentationOptions {
  thinkingText?: string;
  defaultReaction?: string;
}

export class InteractionPresentationService {
  private readonly refreshMs: number = 4_000;
  private readonly options?: InteractionPresentationOptions;

  constructor(options?: InteractionPresentationOptions) {
    this.options = options;
  }

  private configuredThinkingText(): string {
    if (this.options?.thinkingText) return this.options.thinkingText;
    const configured = process.env.TELEGRAM_THINKING_TEXT?.trim();
    return configured || "💭 Thinking";
  }

  async resolveTheme(telegramUserId?: string | number): Promise<ReactionThemeDefinition> {
    try {
      return await reactionThemeService.getUserTheme(telegramUserId);
    } catch {
      return reactionThemeService.getAvailableThemes()[0];
    }
  }

  decide(
    event: InteractionRuntimeEvent,
    theme?: ReactionThemeDefinition
  ): InteractionPresentationDecision {
    if (event.state === "completed" || event.state === "failed") return {};

    const effectiveTheme = theme ?? {
      id: "default",
      name: "Default",
      description: "Default theme",
      pills: [],
      emojis: {
        intake: this.options?.defaultReaction || "👀",
        ideas_or_analysis: this.options?.defaultReaction || "👀",
        tasks: "✍️",
        done: "🎉",
      },
      enabled: true,
    };

    let selectedReaction: string | undefined;
    if (event.reaction !== null && effectiveTheme && effectiveTheme.enabled) {
      if (event.reaction) {
        selectedReaction = event.reaction;
      } else {
        switch (event.state) {
          case "received":
          case "understanding":
            selectedReaction = effectiveTheme.emojis.intake;
            break;
          case "searching":
          case "reasoning":
            selectedReaction = effectiveTheme.emojis.ideas_or_analysis || effectiveTheme.emojis.intake;
            break;
          case "executing_tool":
            selectedReaction = effectiveTheme.emojis.tasks || effectiveTheme.emojis.ideas_or_analysis;
            break;
          case "generating":
          case "finalizing":
            selectedReaction = effectiveTheme.emojis.intake;
            break;
          default:
            selectedReaction = undefined;
        }
      }
    }

    const decision: InteractionPresentationDecision = {
      reaction: selectedReaction,
      chatAction:
        event.chatAction === null
          ? undefined
          : event.chatAction ?? this.defaultChatAction(event),
    };

    if (event.userFacingProgress) {
      const progress = this.progressText(event);
      if (progress) decision.visibleProgressText = progress;
    }

    return decision;
  }

  /**
   * Immediately acknowledge the incoming message with the intake reaction
   * and initial chat action. Never blocks.
   */
  async acknowledge(ctx: Context, hints: InteractionPresentationHints = {}): Promise<void> {
    const userId = hints.telegramUserId ?? ctx.from?.id;
    const theme = await this.resolveTheme(userId);
    const decision = this.decide({ state: "received", ...hints }, theme);

    if (decision.reaction) {
      this.fireReaction(ctx, decision.reaction);
    }
    this.sendChatAction(ctx, decision.chatAction);
  }

  /**
   * Update message reaction dynamically when the orchestrator/intent-router classifies the turn.
   */
  async updateReaction(
    ctx: Context,
    category: "tasks" | "ideas_or_analysis" | "gratitude_or_salute" | "done" | "intake",
    hints: InteractionPresentationHints = {}
  ): Promise<void> {
    const userId = hints.telegramUserId ?? ctx.from?.id;
    const theme = await this.resolveTheme(userId);
    if (!theme.enabled) return;

    const emoji = theme.emojis[category === "intake" ? "intake" : category];
    if (emoji) {
      this.fireReaction(ctx, emoji);
    }
  }

  /**
   * On successful completion, attach the theme's done reaction.
   */
  async complete(ctx: Context, hints: InteractionPresentationHints = {}): Promise<void> {
    const userId = hints.telegramUserId ?? ctx.from?.id;
    const theme = await this.resolveTheme(userId);
    if (!theme.enabled || !theme.emojis.done) return;

    this.fireReaction(ctx, theme.emojis.done);
  }

  /**
   * On honest failure, clear any reactions from the message.
   */
  async clearReaction(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.message?.message_id) return;
    try {
      await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, []);
    } catch {
      // Ignore group restriction or suppression
    }
  }

  /**
   * Start a reliable typing heartbeat that re-sends sendChatAction every ~4 seconds.
   */
  startPresence(ctx: Context, hints: InteractionPresentationHints = {}): () => void {
    const decision = this.decide({ state: "generating", ...hints });
    let stopped = false;

    const send = (): void => {
      if (stopped) return;
      this.sendChatAction(ctx, decision.chatAction);
    };

    send();
    const timer = setInterval(send, this.refreshMs);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async renderProgress(
    ctx: Context,
    event: InteractionRuntimeEvent,
    progressMessageId?: number
  ): Promise<number | undefined> {
    const decision = this.decide(event);
    if (!decision.visibleProgressText) return progressMessageId;

    try {
      if (progressMessageId) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMessageId, decision.visibleProgressText);
        return progressMessageId;
      }
      if (!ctx.chat) return undefined;
      const message = await ctx.reply(decision.visibleProgressText);
      return message.message_id;
    } catch {
      return progressMessageId;
    }
  }

  private fireReaction(ctx: Context, emoji: string): void {
    if (!ctx.chat || !ctx.message?.message_id) return;
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    // Fire and forget, catch errors safely (e.g. rate limit, group restrictions)
    ctx.api
      .setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: emoji as any }])
      .catch((err) => {
        logger.debug({ error: err?.message, emoji }, "Could not set Telegram message reaction");
      });
  }

  private progressText(event: InteractionRuntimeEvent): string | undefined {
    const explicit = event.progressText?.trim();
    if (explicit) return `${explicit}${this.latencySuffix(event)}`;

    if (event.state === "reasoning" && event.showThinking !== false) {
      return `${this.configuredThinkingText()}${this.latencySuffix(event)}`;
    }

    if (event.state === "generating" && event.toolName === "assistant_response") {
      return undefined;
    }

    const subject = event.operationLabel?.trim() || event.toolName?.trim();
    if (!subject) return undefined;

    if (event.state === "executing_tool") {
      return `Running tool: ${subject}…${this.latencySuffix(event)}`;
    }
    if (event.state === "generating") {
      return `Generating: ${subject}${this.latencySuffix(event)}`;
    }

    return `${subject}${this.latencySuffix(event)}`;
  }

  private latencySuffix(event: InteractionRuntimeEvent): string {
    const elapsedMs = event.elapsedMs ?? 0;
    if (!event.expectsLongRunning || elapsedMs < 8_000) return "";
    return ` (${Math.round(elapsedMs / 1_000)}s)`;
  }

  private defaultChatAction(event: InteractionRuntimeEvent): InteractionChatAction {
    switch (event.state) {
      case "executing_tool":
      case "searching":
      case "retrieving_context":
      case "reasoning":
      case "generating":
      case "verifying":
      case "finalizing":
      default:
        return "typing";
    }
  }

  private sendChatAction(ctx: Context, chatAction?: InteractionChatAction): void {
    if (!ctx.chat || !chatAction) return;
    void ctx.api.sendChatAction(ctx.chat.id, chatAction).catch(() => undefined);
  }
}

export const interactionPresentationService = new InteractionPresentationService();
