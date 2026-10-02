import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { eventBusService } from "./event-bus.service";

export type NameSource = "user" | "telegram" | "google" | null;

export interface UserIdentityRecord {
  preferredName?: string | null;
  preferred_name?: string | null;
  nameSource?: NameSource;
  name_source?: NameSource;
  fullName?: string | null;
  full_name?: string | null;
  telegramFirstName?: string | null;
  first_name?: string | null;
  googleGivenName?: string | null;
  given_name?: string | null;
  googleName?: string | null;
  name?: string | null;
  email?: string | null;
  timezone?: string | null;
}

/**
 * Validates candidate display names according to strict safety rules:
 * - 1 to 40 characters long
 * - Strips control characters, newlines, tabs
 * - Rejects pure emojis/symbols (must contain at least one unicode letter/number)
 */
export function validateCandidateName(name: string | null | undefined): string | null {
  if (!name || typeof name !== "string") return null;

  // Strip control chars, newlines, carriage returns, tabs
  const cleaned = name.replace(/[\r\n\t\x00-\x1F\x7F-\x9F]/g, "").trim();

  if (cleaned.length < 1 || cleaned.length > 40) return null;

  // Ensure it has at least one unicode letter or number
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;

  return cleaned;
}

/**
 * Escapes text for HTML rendering in Web UI and Telegram HTML mode to prevent prompt injection / XSS.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Central Name Resolution Priority Order:
 * 1. The name the user set themselves (preferred_name when set by user).
 * 2. Telegram first_name, validated.
 * 3. Google given_name / name, validated.
 * 4. NULL / Nothing (NO FALLBACK to email prefix like olalekan4587!).
 */
export function getDisplayName(identity: UserIdentityRecord | null | undefined): string | null {
  if (!identity) return null;

  const pref = identity.preferredName || identity.preferred_name;
  const source = identity.nameSource || identity.name_source;

  // 1. User-set or existing preferred_name
  if (pref) {
    const valid = validateCandidateName(pref);
    if (valid) return valid;
  }

  // If source is explicitly 'user', do not automatically fall back if invalid or empty
  if (source === "user") {
    return pref ? validateCandidateName(pref) : null;
  }

  // 2. Telegram first_name
  const tgFirst = identity.telegramFirstName || identity.first_name;
  if (tgFirst) {
    const valid = validateCandidateName(tgFirst);
    if (valid) return valid;
  }

  // 3. Google given_name / name
  const gGiven = identity.googleGivenName || identity.given_name;
  if (gGiven) {
    const valid = validateCandidateName(gGiven);
    if (valid) return valid;
  }

  const gName = identity.googleName || identity.name;
  if (gName) {
    const valid = validateCandidateName(gName);
    if (valid) return valid;
  }

  // 4. Nothing! Never fall back to email prefix.
  return null;
}

/**
 * Generates an honest greeting structure.
 * - If user has display name: "Hey Lekzy 👋"
 * - If user has no display name: "Hey 👋" and asks once "What should I call you?"
 */
export function getGreeting(identity: UserIdentityRecord | null | undefined): {
  greeting: string;
  hasName: boolean;
  resolvedName: string | null;
  promptQuestion?: string;
} {
  const resolved = getDisplayName(identity);
  if (resolved) {
    return {
      greeting: `Hey ${escapeHtml(resolved)} 👋`,
      hasName: true,
      resolvedName: resolved,
    };
  }
  return {
    greeting: "Hey 👋",
    hasName: false,
    resolvedName: null,
    promptQuestion: "What should I call you?",
  };
}

/**
 * Builds a minimal, privacy-focused System Prompt Identity Block.
 * Contains preferred name (or instructions to ask once) and timezone only.
 * Protects email, telegram handle, and private metadata from unnecessary model exposure.
 */
export function buildUserPromptIdentityBlock(identity: UserIdentityRecord | null | undefined): string {
  const resolved = getDisplayName(identity);
  const tz = identity?.timezone || "UTC";

  let block = "[AUTHORITATIVE USER IDENTITY]:\n";
  if (resolved) {
    block += `- Preferred Name: ${escapeHtml(resolved)}\n`;
    block += `- Name Source: ${identity?.nameSource || identity?.name_source || "resolved"}\n`;
  } else {
    block += `- Preferred Name: NONE_CONFIGURED\n`;
    block += `- Addressing Instruction: The user has not configured a preferred name yet. Greet plainly ("Hey 👋") and ask once "What should I call you?". If the user responds with their name in chat (e.g. "call me Femi" or "my name is Lekan"), immediately invoke the update_preferred_name tool to store it directly.\n`;
  }
  block += `- User Timezone: ${tz}`;
  return block;
}

export class UserIdentityResolverService {
  /**
   * Updates preferred_name in PostgreSQL for a web user or partition user.
   * Respects user override priority (will not overwrite name_source === 'user' via auto-import).
   * Sends Telegram notification if linked & emits event bus update.
   */
  public async updatePreferredName(
    userId: number,
    rawName: string,
    source: NameSource = "user",
    isWebUserId = false
  ): Promise<{ success: boolean; preferredName: string | null; error?: string }> {
    const validated = validateCandidateName(rawName);
    if (!validated) {
      return {
        success: false,
        preferredName: null,
        error: "Invalid name format. Preferred name must be 1 to 40 characters and contain valid letters.",
      };
    }

    const pool = getPool();

    if (isWebUserId) {
      const userRes = await pool.query(`SELECT * FROM web_users WHERE id = $1`, [userId]);
      const webUser = userRes.rows[0];
      if (!webUser) return { success: false, preferredName: null, error: "Web user not found." };

      if (webUser.name_source === "user" && source !== "user") {
        logger.info({ userId }, "Skipped overwrite of user-set preferred_name by provider import");
        return { success: false, preferredName: webUser.preferred_name, error: "Cannot overwrite user-set name with provider import." };
      }

      await pool.query(
        `UPDATE web_users SET preferred_name = $1, name_source = $2, updated_at = NOW() WHERE id = $3`,
        [validated, source, userId]
      );

      if (webUser.telegram_user_id) {
        await pool.query(
          `UPDATE users SET preferred_name = $1, name_source = $2, updated_at = NOW() WHERE telegram_user_id = $3`,
          [validated, source, webUser.telegram_user_id]
        );

        // Send Telegram notification line
        try {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (botToken) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: webUser.telegram_user_id,
                text: `✅ <b>Name updated to ${escapeHtml(validated)}</b>`,
                parse_mode: "HTML",
              }),
            });
          }
        } catch (tgErr) {
          logger.warn({ error: tgErr }, "Failed to send Telegram notification for name update");
        }
      }

      logger.info({ userId, preferredName: validated, source }, "Updated preferred_name for web user");
      eventBusService.publish({
        type: "USER_NAME_UPDATED",
        payload: { webUserId: userId, telegramUserId: webUser.telegram_user_id, preferredName: validated, source },
      });

      return { success: true, preferredName: validated };
    } else {
      // telegram_user_id
      const userRes = await pool.query(`SELECT * FROM users WHERE telegram_user_id = $1`, [userId]);
      const tgUser = userRes.rows[0];

      if (tgUser?.name_source === "user" && source !== "user") {
        logger.info({ userId }, "Skipped overwrite of user-set preferred_name on users table");
        return { success: false, preferredName: tgUser.preferred_name, error: "Cannot overwrite user-set name with provider import." };
      }

      await pool.query(
        `INSERT INTO users (telegram_user_id, preferred_name, name_source, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           preferred_name = EXCLUDED.preferred_name,
           name_source = EXCLUDED.name_source,
           updated_at = NOW();`,
        [userId, validated, source]
      );

      await pool.query(
        `UPDATE web_users SET preferred_name = $1, name_source = $2, updated_at = NOW() WHERE telegram_user_id = $3`,
        [validated, source, userId]
      );

      logger.info({ userId, preferredName: validated, source }, "Updated preferred_name for partition/telegram user");
      eventBusService.publish({
        type: "USER_NAME_UPDATED",
        payload: { telegramUserId: userId, preferredName: validated, source },
      });

      return { success: true, preferredName: validated };
    }
  }

  /**
   * Detects in-chat phrases like "call me Femi" or "my name is Lekan" and updates preferred_name.
   */
  public async checkAndHandleInChatNameUpdate(
    userId: number,
    content: string,
    isWebUser = false
  ): Promise<{ handled: boolean; replyText?: string; preferredName?: string }> {
    const match = content.match(/\b(?:call\s+me|my\s+name\s+is|change\s+my\s+name\s+to|address\s+me\s+as)\s+([A-Za-z0-9\p{L}]{1,40})\b/i);
    if (!match) return { handled: false };

    const candidate = match[1].trim();
    const validated = validateCandidateName(candidate);
    if (!validated) return { handled: false };

    const res = await this.updatePreferredName(userId, validated, "user", isWebUser);
    if (res.success && res.preferredName) {
      return {
        handled: true,
        preferredName: res.preferredName,
        replyText: `Name updated to **${escapeHtml(res.preferredName)}**. I will address you as ${escapeHtml(res.preferredName)} from now on! 👍`,
      };
    }
    return { handled: false };
  }

  /**
   * Handles Telegram identity unlink rules:
   * Keep a user-set name, but drop an imported Telegram name when identity is removed.
   */
  public async handleTelegramUnlink(telegramUserId: number): Promise<void> {
    const pool = getPool();
    const res = await pool.query(`SELECT preferred_name, name_source FROM users WHERE telegram_user_id = $1`, [telegramUserId]);
    const row = res.rows[0];

    if (row && row.name_source === "telegram") {
      await pool.query(
        `UPDATE users SET preferred_name = NULL, name_source = NULL, updated_at = NOW() WHERE telegram_user_id = $1`,
        [telegramUserId]
      );
      await pool.query(
        `UPDATE web_users SET preferred_name = NULL, name_source = NULL, updated_at = NOW() WHERE telegram_user_id = $1`,
        [telegramUserId]
      );
      logger.info({ telegramUserId }, "Dropped imported Telegram name upon identity unlink");
    } else {
      logger.info({ telegramUserId }, "Retained user-set preferred_name upon Telegram identity unlink");
    }
  }
}

export const userIdentityResolverService = new UserIdentityResolverService();
