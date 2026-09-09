import {
  MODES,
  MODE_KEYS,
  isModeKey,
  canonicalizeModeKey,
  type ModeKey,
  type ModeProfile,
} from "../config/mode";
import { ConversationService } from "./conversation.service";
import { chatDatabaseService } from "@workspace/db";
import { logger } from "../lib/logger";

export interface ModeSwitchResult {
  previousMode: ModeKey;
  activeMode: ModeKey;
  profile: ModeProfile;
  changed: boolean;
  persisted: boolean;
  confirmationMessage: string;
  status: "persisted" | "already_active" | "failed";
}

export type ModeSwitchSource =
  | "natural_language"
  | "command"
  | "callback"
  | "voice";

export class ModeService {
  private userLocks = new Map<number, Promise<unknown>>();

  constructor(private conversations: ConversationService) {}

  resolveMode(input: string): ModeKey | null {
    return canonicalizeModeKey(input);
  }

  resolveCanonicalMode(input: string): ModeKey | null {
    return this.resolveMode(input);
  }

  validateMode(key: string): boolean {
    return isModeKey(key);
  }

  getModeConfig(modeKey: ModeKey): ModeProfile {
    return MODES[modeKey] || MODES.general;
  }

  getEffectiveMode(persistentMode: ModeKey, turnModeOverride?: ModeKey): ModeKey {
    if (turnModeOverride && this.validateMode(turnModeOverride)) return turnModeOverride;
    return persistentMode;
  }

  /**
   * Natural-language mode selection is resolved by SemanticInteractionResolverService upstream.
   * This method intentionally performs no vocabulary/regex classification. Explicit Telegram
   * commands and callback handlers remain deterministic and authoritative.
   */
  resolveTurnMode(
    _text: string,
    persistentMode: ModeKey,
    _history: Array<{ role: string; content: string }> = [],
  ): ModeKey {
    return persistentMode;
  }

  async switchPersistentMode(
    telegramUserId: number,
    requestedModeRaw: string,
    source: ModeSwitchSource = "natural_language",
  ): Promise<ModeSwitchResult> {
    if (!telegramUserId || typeof telegramUserId !== "number" || isNaN(telegramUserId)) {
      logger.error({ telegramUserId, requestedModeRaw, source }, "MODE_SWITCH_FAILED (Invalid User ID)");
      throw new Error(`Invalid Telegram user ID for mode switch: ${telegramUserId}`);
    }

    const canonicalMode = this.resolveMode(requestedModeRaw);
    if (!canonicalMode || !this.validateMode(canonicalMode)) {
      logger.warn({ telegramUserId, requestedModeRaw, source }, "MODE_SWITCH_FAILED (Invalid Mode)");
      throw new Error(`Unsupported or unrecognized mode requested: "${requestedModeRaw}"`);
    }

    const existingLock = this.userLocks.get(telegramUserId) || Promise.resolve();
    let resolveLock!: () => void;
    const newLock = new Promise<void>((resolve) => { resolveLock = resolve; });
    this.userLocks.set(telegramUserId, existingLock.then(() => newLock));

    try {
      await existingLock;
      const currentMode = await this.conversations.getUserMode(telegramUserId);

      if (currentMode === canonicalMode) {
        return {
          previousMode: currentMode,
          activeMode: canonicalMode,
          profile: this.getModeConfig(canonicalMode),
          changed: false,
          persisted: true,
          status: "already_active",
          confirmationMessage: this.formatConfirmationMessage(canonicalMode, currentMode, false),
        };
      }

      await this.conversations.setUserMode(telegramUserId, canonicalMode);
      chatDatabaseService.invalidateUserCache(telegramUserId);
      const verifiedMode = await this.conversations.getUserMode(telegramUserId);
      if (verifiedMode !== canonicalMode) throw new Error(`Mode persistence verification failed. Expected ${canonicalMode}, got ${verifiedMode}`);

      logger.info({ telegramUserId, previousMode: currentMode, newMode: canonicalMode, source }, "MODE_SWITCH_PERSISTED");
      return {
        previousMode: currentMode,
        activeMode: canonicalMode,
        profile: this.getModeConfig(canonicalMode),
        changed: true,
        persisted: true,
        status: "persisted",
        confirmationMessage: this.formatConfirmationMessage(canonicalMode, currentMode, true),
      };
    } catch (err) {
      logger.error({ telegramUserId, requestedModeRaw, err }, "MODE_SWITCH_FAILED");
      throw err;
    } finally {
      resolveLock();
    }
  }

  async switchMode(telegramUserId: number, requestedModeRaw: string, source: ModeSwitchSource = "natural_language"): Promise<ModeSwitchResult> {
    return this.switchPersistentMode(telegramUserId, requestedModeRaw, source);
  }

  formatConfirmationMessage(newMode: ModeKey, previousMode?: ModeKey, isNewSwitch = true): string {
    const profile = this.getModeConfig(newMode);
    const prevText = previousMode && previousMode !== newMode ? ` (switched from ${MODES[previousMode]?.displayName || previousMode})` : "";
    if (!isNewSwitch) return `🎯 <b>Mode Active: ${profile.displayName}</b>\n\n📝 <i>${profile.description}</i>\n\nYou are already using this mode.`;
    const capabilitiesSummary = profile.capabilitiesList.map((cap) => `• ${cap.replace(/_/g, " ")}`).join("\n");
    return [
      `🎯 <b>Mode Activated: ${profile.displayName}</b>${prevText}`,
      "",
      `📝 <i>${profile.description}</i>`,
      "",
      "✨ <b>Configured Capabilities:</b>",
      capabilitiesSummary,
      "",
      `📌 <b>Response Style:</b> ${profile.preferredResponseStyle}`,
      profile.formattingProfile ? `📐 <b>Formatting:</b> ${profile.formattingProfile}` : null,
      "",
      `💬 <i>Send your next message to execute in ${profile.displayName}!</i>`,
    ].filter(Boolean).join("\n");
  }
}
