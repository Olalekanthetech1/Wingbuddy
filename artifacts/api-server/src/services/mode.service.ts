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

  /**
   * Resolves raw mode string into canonical ModeKey.
   */
  resolveMode(input: string): ModeKey | null {
    return canonicalizeModeKey(input);
  }

  /**
   * Alias for resolveMode for backward compatibility.
   */
  resolveCanonicalMode(input: string): ModeKey | null {
    return this.resolveMode(input);
  }

  /**
   * Validates if a string is a valid canonical ModeKey.
   */
  validateMode(key: string): boolean {
    return isModeKey(key);
  }

  /**
   * Returns mode profile config from registry.
   */
  getModeConfig(modeKey: ModeKey): ModeProfile {
    return MODES[modeKey] || MODES.general;
  }

  /**
   * Determines effective mode based on persistent preference and turn override.
   */
  getEffectiveMode(
    persistentMode: ModeKey,
    turnModeOverride?: ModeKey,
  ): ModeKey {
    if (turnModeOverride && this.validateMode(turnModeOverride)) {
      return turnModeOverride;
    }
    return persistentMode;
  }

  /**
   * Resolves turn mode temporarily for a single request if persistent mode is AUTO
   * or if explicit turn-level instructions exist in the text.
   */
  resolveTurnMode(
    text: string,
    persistentMode: ModeKey,
    _history: Array<{ role: string; content: string }> = [],
  ): ModeKey {
    const trimmed = text.trim();

    // Check for explicit temporary role/mode requests in prompt
    // e.g., "For this question, act as a coding expert..."
    if (/\b(act as a|be my|role of)\s+(coding|coder|developer|programmer)\b/i.test(trimmed)) {
      logger.info({ persistentMode, resolvedTurnMode: "coder" }, "TURN_MODE_RESOLVED (Explicit turn role)");
      return "coder";
    }
    if (/\b(act as a|be my|role of)\s+(study|tutor|teacher)\b/i.test(trimmed)) {
      logger.info({ persistentMode, resolvedTurnMode: "study" }, "TURN_MODE_RESOLVED (Explicit turn role)");
      return "study";
    }
    if (/\b(act as a|be my|role of)\s+(researcher|deep research)\b/i.test(trimmed)) {
      logger.info({ persistentMode, resolvedTurnMode: "deep_research" }, "TURN_MODE_RESOLVED (Explicit turn role)");
      return "deep_research";
    }
    if (/\b(act as a|be my|role of)\s+(math|mathematician|logician)\b/i.test(trimmed)) {
      logger.info({ persistentMode, resolvedTurnMode: "math" }, "TURN_MODE_RESOLVED (Explicit turn role)");
      return "math";
    }

    // If persistent mode is AUTO, classify intent to select turn mode dynamically
    if (persistentMode === "auto") {
      if (/```|\b(function|class|typescript|python|bug|error|stack trace|code)\b/i.test(trimmed)) {
        logger.info({ persistentMode, resolvedTurnMode: "coder" }, "TURN_MODE_RESOLVED (Auto classification)");
        return "coder";
      }
      if (/\b(solve|equation|proof|integral|derivative|calculat(e|ion))\b/i.test(trimmed)) {
        logger.info({ persistentMode, resolvedTurnMode: "math" }, "TURN_MODE_RESOLVED (Auto classification)");
        return "math";
      }
      if (/\b(latest|news|weather|recent|current|who won|price|crypto|stock)\b/i.test(trimmed)) {
        logger.info({ persistentMode, resolvedTurnMode: "deep_research" }, "TURN_MODE_RESOLVED (Auto classification)");
        return "deep_research";
      }
      if (/\b(explain|learn|homework|exam|quiz|concept|socratic|tutor)\b/i.test(trimmed)) {
        logger.info({ persistentMode, resolvedTurnMode: "study" }, "TURN_MODE_RESOLVED (Auto classification)");
        return "study";
      }
      if (/\b(brainstorm|write a story|poem|draft|essay|creative|ideas)\b/i.test(trimmed)) {
        logger.info({ persistentMode, resolvedTurnMode: "creative" }, "TURN_MODE_RESOLVED (Auto classification)");
        return "creative";
      }
      logger.info({ persistentMode, resolvedTurnMode: "general" }, "TURN_MODE_RESOLVED (Auto fallback)");
      return "general";
    }

    return persistentMode;
  }

  /**
   * Authoritatively switches persistent mode for a user in PostgreSQL.
   * Handles idempotency, locking, cache invalidation, and verification.
   */
  async switchPersistentMode(
    telegramUserId: number,
    requestedModeRaw: string,
    source: ModeSwitchSource = "natural_language",
  ): Promise<ModeSwitchResult> {
    if (
      !telegramUserId ||
      typeof telegramUserId !== "number" ||
      isNaN(telegramUserId)
    ) {
      logger.error({ telegramUserId, requestedModeRaw, source }, "MODE_SWITCH_FAILED (Invalid User ID)");
      throw new Error(
        `Invalid Telegram user ID for mode switch: ${telegramUserId}`,
      );
    }

    logger.info(
      { telegramUserId, requestedModeRaw, source },
      "MODE_SWITCH_REQUESTED",
    );

    const canonicalMode = this.resolveMode(requestedModeRaw);
    if (!canonicalMode || !this.validateMode(canonicalMode)) {
      logger.warn(
        { telegramUserId, requestedModeRaw, source },
        "MODE_SWITCH_FAILED (Invalid Mode)",
      );
      throw new Error(
        `Unsupported or unrecognized mode requested: "${requestedModeRaw}"`,
      );
    }

    logger.info(
      { telegramUserId, canonicalMode, source },
      "MODE_SWITCH_VALIDATED",
    );

    // Concurrency lock per user
    const existingLock =
      this.userLocks.get(telegramUserId) || Promise.resolve();
    let resolveLock!: () => void;
    const newLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.userLocks.set(telegramUserId, existingLock.then(() => newLock));

    try {
      await existingLock;

      // 1. Fetch current persistent mode
      const currentMode = await this.conversations.getUserMode(telegramUserId);

      // 2. Idempotency Check
      if (currentMode === canonicalMode) {
        logger.info(
          { telegramUserId, mode: canonicalMode, source },
          "MODE_SWITCH_NOOP (Already Active)",
        );
        return {
          previousMode: currentMode,
          activeMode: canonicalMode,
          profile: this.getModeConfig(canonicalMode),
          changed: false,
          persisted: true,
          status: "already_active",
          confirmationMessage: this.formatConfirmationMessage(
            canonicalMode,
            currentMode,
            false,
          ),
        };
      }

      // 3. Persist to PostgreSQL (Source of Truth)
      await this.conversations.setUserMode(telegramUserId, canonicalMode);

      // 4. Invalidate Cache
      chatDatabaseService.invalidateUserCache(telegramUserId);

      // 5. Verify Persistence
      const verifiedMode = await this.conversations.getUserMode(
        telegramUserId,
      );
      if (verifiedMode !== canonicalMode) {
        logger.error(
          {
            telegramUserId,
            expected: canonicalMode,
            received: verifiedMode,
          },
          "MODE_SWITCH_FAILED (Verification Mismatch)",
        );
        throw new Error(
          `Mode persistence verification failed for user ${telegramUserId}. Expected ${canonicalMode}, got ${verifiedMode}`,
        );
      }

      logger.info(
        {
          telegramUserId,
          previousMode: currentMode,
          newMode: canonicalMode,
          source,
        },
        "MODE_SWITCH_PERSISTED",
      );

      logger.info(
        { telegramUserId, activeMode: canonicalMode },
        "MODE_SWITCH_ACTIVATED",
      );

      return {
        previousMode: currentMode,
        activeMode: canonicalMode,
        profile: this.getModeConfig(canonicalMode),
        changed: true,
        persisted: true,
        status: "persisted",
        confirmationMessage: this.formatConfirmationMessage(
          canonicalMode,
          currentMode,
          true,
        ),
      };
    } catch (err) {
      logger.error(
        { telegramUserId, requestedModeRaw, err },
        "MODE_SWITCH_FAILED",
      );
      throw err;
    } finally {
      resolveLock();
    }
  }

  /**
   * Alias for switchPersistentMode.
   */
  async switchMode(
    telegramUserId: number,
    requestedModeRaw: string,
    source: ModeSwitchSource = "natural_language",
  ): Promise<ModeSwitchResult> {
    return this.switchPersistentMode(telegramUserId, requestedModeRaw, source);
  }

  /**
   * Formats Telegram confirmation card dynamically from Mode Registry.
   */
  formatConfirmationMessage(
    newMode: ModeKey,
    previousMode?: ModeKey,
    isNewSwitch = true,
  ): string {
    const profile = this.getModeConfig(newMode);
    const prevText =
      previousMode && previousMode !== newMode
        ? ` (switched from ${MODES[previousMode]?.displayName || previousMode})`
        : "";

    if (!isNewSwitch) {
      return `🎯 <b>Mode Active: ${profile.displayName}</b>\n\n📝 <i>${profile.description}</i>\n\nYou are already using this mode.`;
    }

    const capabilitiesSummary = profile.capabilitiesList
      .map((cap) => `• ${cap.replace(/_/g, " ")}`)
      .join("\n");

    return [
      `🎯 <b>Mode Activated: ${profile.displayName}</b>${prevText}`,
      ``,
      `📝 <i>${profile.description}</i>`,
      ``,
      `✨ <b>Configured Capabilities:</b>`,
      capabilitiesSummary,
      ``,
      `📌 <b>Response Style:</b> ${profile.preferredResponseStyle}`,
      profile.formattingProfile
        ? `📐 <b>Formatting:</b> ${profile.formattingProfile}`
        : null,
      ``,
      `💬 <i>Send your next message to execute in ${profile.displayName}!</i>`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
