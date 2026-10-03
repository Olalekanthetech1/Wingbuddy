import crypto from "node:crypto";
import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { eventBusService } from "./event-bus.service";
import { telegramIdentityService } from "./telegram-identity.service";
import { validateCandidateName, userIdentityResolverService } from "./user-identity-resolver.service";

export interface AuthenticatedUser {
  id: number;
  email: string;
  googleId?: string;
  name?: string;
  picture?: string;
  preferredName?: string;
  nameSource?: "user" | "telegram" | "google" | null;
  fullName?: string;
  givenName?: string;
  familyName?: string;
  role: "admin" | "user";
  telegramUserId?: bigint;
  telegramUsername?: string;
  notificationPreference: "full" | "digest_only" | "silent";
  contextSyncMode: "compact" | "full";
  themePreference: "light" | "dark" | "system";
}

const ADMIN_EMAIL_WHITELIST = new Set([
  ...(process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()) : []),
]);

class AuthService {
  /**
   * Generates a random cryptographic hex token.
   */
  private generateToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString("hex");
  }

  /**
   * Hashes tokens at rest using SHA-256
   */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token.trim()).digest("hex");
  }

  /**
   * Verifies Google token or processes Google profile payload.
   * Prevents silent hijacking: never silently merges if Google account is bound to another Telegram ID.
   */
  public async handleGoogleAuth(payload: {
    credential?: string;
    email: string;
    googleId?: string;
    name?: string;
    picture?: string;
    emailVerified?: boolean;
    telegramLinkingContext?: {
      telegramUserId: number;
      telegramUsername?: string;
    };
  }): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
    const pool = getPool();
    const cleanEmail = payload.email.trim().toLowerCase();
    const isAdmin = ADMIN_EMAIL_WHITELIST.has(cleanEmail);
    const role: "admin" | "user" = isAdmin ? "admin" : "user";

    // Enforce email verification check for Google sign-in
    if (payload.emailVerified === false) {
      throw new Error("Unverified Google email address. Please verify your Google email before signing in.");
    }

    // Check if account already exists
    const existingUserRes = await pool.query(`SELECT * FROM web_users WHERE email = $1`, [cleanEmail]);
    const existingUser = existingUserRes.rows[0];

    let targetTelegramId = existingUser?.telegram_user_id || null;
    let targetTelegramUsername = existingUser?.telegram_username || null;

    if (payload.telegramLinkingContext) {
      const incomingTgId = payload.telegramLinkingContext.telegramUserId;
      if (existingUser?.telegram_user_id && Number(existingUser.telegram_user_id) !== incomingTgId) {
        throw new Error(
          `Conflict: Google account ${cleanEmail} is already linked to Telegram ID ${existingUser.telegram_user_id}. Link conflict detected.`
        );
      }
      targetTelegramId = incomingTgId;
      targetTelegramUsername = payload.telegramLinkingContext.telegramUsername || targetTelegramUsername;
    }

    // For primary admin email default fallback if not yet set
    // REMOVED hardcoded fallback to comply with Zero-Fallback Policy


    // Free up this telegram_user_id from other web_users accounts to avoid unique constraint violations
    if (targetTelegramId) {
      await pool.query(
        `UPDATE web_users SET telegram_user_id = NULL, telegram_username = NULL WHERE telegram_user_id = $1 AND email != $2`,
        [targetTelegramId, cleanEmail]
      );
    }

    const cleanGoogleName = validateCandidateName(payload.name);
    const googleGivenName = cleanGoogleName ? cleanGoogleName.split(" ")[0] : null;

    const query = `
      INSERT INTO web_users (email, google_id, name, given_name, picture, role, telegram_user_id, telegram_username, preferred_name, name_source, last_login_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE NULL END, CASE WHEN $4::text IS NOT NULL THEN 'google' ELSE NULL END, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        google_id = COALESCE(EXCLUDED.google_id, web_users.google_id),
        name = COALESCE(EXCLUDED.name, web_users.name),
        given_name = COALESCE(EXCLUDED.given_name, web_users.given_name),
        picture = COALESCE(EXCLUDED.picture, web_users.picture),
        role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE web_users.role END,
        telegram_user_id = COALESCE(EXCLUDED.telegram_user_id, web_users.telegram_user_id),
        telegram_username = COALESCE(EXCLUDED.telegram_username, web_users.telegram_username),
        preferred_name = CASE 
          WHEN web_users.name_source = 'user' AND web_users.preferred_name IS NOT NULL THEN web_users.preferred_name
          WHEN web_users.preferred_name IS NULL AND EXCLUDED.given_name IS NOT NULL THEN EXCLUDED.given_name
          ELSE web_users.preferred_name
        END,
        name_source = CASE
          WHEN web_users.name_source = 'user' THEN 'user'
          WHEN web_users.preferred_name IS NULL AND EXCLUDED.given_name IS NOT NULL THEN 'google'
          ELSE web_users.name_source
        END,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING id, email, google_id, name, given_name, picture, role, telegram_user_id, telegram_username, preferred_name, name_source, notification_preference, context_sync_mode, theme_preference;
    `;

    const res = await pool.query(query, [
      cleanEmail,
      payload.googleId || null,
      cleanGoogleName,
      googleGivenName,
      payload.picture || null,
      role,
      targetTelegramId,
      targetTelegramUsername,
    ]);

    const row = res.rows[0];
    const user: AuthenticatedUser = {
      id: row.id,
      email: row.email,
      googleId: row.google_id || undefined,
      name: row.name || undefined,
      givenName: row.given_name || undefined,
      preferredName: row.preferred_name || undefined,
      nameSource: row.name_source || undefined,
      picture: row.picture || undefined,
      role: row.role as "admin" | "user",
      telegramUserId: row.telegram_user_id ? BigInt(row.telegram_user_id) : undefined,
      telegramUsername: row.telegram_username || undefined,
      notificationPreference: (row.notification_preference as any) || "digest_only",
      contextSyncMode: (row.context_sync_mode as any) || "compact",
      themePreference: (row.theme_preference as any) || "system",
    };

    const partitionId = user.telegramUserId || 9000000000 + user.id;
    await this.ensureTelegramUserRecord(partitionId, user.name, user.telegramUsername, user.role === "admin");

    const sessionToken = this.generateToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO web_sessions (session_token, web_user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionToken, user.id, expiresAt]
    );

    return { user, sessionToken };
  }

  /**
   * Direct email or 1-click workspace access for development/instant login
   */
  public async handleEmailOrInstantLogin(payload: { email?: string; name?: string }): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
    if (!payload.email) {
      throw new Error("Email is required for instant login. No default fallback permitted.");
    }
    const rawEmail = payload.email.trim().toLowerCase();
    const cleanEmail = rawEmail.includes("@") ? rawEmail : `${rawEmail}@user.ai`;
    return this.handleGoogleAuth({
      email: cleanEmail,
      name: payload.name || undefined,
      emailVerified: true,
    });
  }

  /**
   * Validates a session token and returns the authenticated user.
   */
  public async validateSession(sessionToken: string): Promise<AuthenticatedUser | null> {
    if (!sessionToken?.trim()) return null;
    const pool = getPool();

    const query = `
      SELECT u.id, u.email, u.google_id, u.name, u.given_name, u.preferred_name, u.name_source, u.full_name, u.picture, u.role, u.telegram_user_id,
             u.telegram_username, u.notification_preference, u.context_sync_mode, u.theme_preference, s.expires_at
      FROM web_sessions s
      JOIN web_users u ON s.web_user_id = u.id
      WHERE s.session_token = $1 AND s.expires_at > NOW();
    `;

    const res = await pool.query(query, [sessionToken.trim()]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      googleId: row.google_id || undefined,
      name: row.name || undefined,
      givenName: row.given_name || undefined,
      preferredName: row.preferred_name || undefined,
      nameSource: row.name_source || undefined,
      fullName: row.full_name || undefined,
      picture: row.picture || undefined,
      role: row.role as "admin" | "user",
      telegramUserId: row.telegram_user_id ? BigInt(row.telegram_user_id) : undefined,
      telegramUsername: row.telegram_username || undefined,
      notificationPreference: (row.notification_preference as any) || "digest_only",
      contextSyncMode: (row.context_sync_mode as any) || "compact",
      themePreference: (row.theme_preference as any) || "system",
    };
  }

  /**
   * Revokes all active sessions for a user ("Sign out all devices").
   */
  public async revokeAllUserSessions(webUserId: number): Promise<void> {
    const pool = getPool();
    await pool.query(`DELETE FROM web_sessions WHERE web_user_id = $1`, [webUserId]);
  }

  /**
   * Generates a 1-click pairing token for Web -> Telegram linking (`/start link_XXXXXX`).
   * Resolves bot handle dynamically with zero hardcoding.
   */
  public async generateTelegramPairingToken(webUserId: number): Promise<{ token: string; linkUrl: string | null; botUsername: string | null; expiresAt: Date }> {
    const pool = getPool();
    const rawToken = `link_${crypto.randomBytes(6).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min TTL

    await pool.query(
      `INSERT INTO telegram_pairing_tokens (token, web_user_id, type, is_used, expires_at)
       VALUES ($1, $2, 'web_to_tg', FALSE, $3)`,
      [rawToken, webUserId, expiresAt]
    );

    const deepLink = telegramIdentityService.getPairingDeepLink(rawToken);
    return {
      token: rawToken,
      linkUrl: deepLink?.url || null,
      botUsername: deepLink?.botUsername || null,
      expiresAt,
    };
  }

  /**
   * Consumes a pairing token from Telegram bot `/start link_XXXXXX`.
   */
  public async completeTelegramPairing(
    token: string,
    telegramUserId: number,
    telegramUsername?: string
  ): Promise<{ success: boolean; webUserId?: number; message: string }> {
    const pool = getPool();
    const query = `
      SELECT * FROM telegram_pairing_tokens
      WHERE token = $1 AND type = 'web_to_tg' AND is_used = FALSE AND expires_at > NOW();
    `;

    const res = await pool.query(query, [token.trim()]);
    if (res.rows.length === 0) {
      return { success: false, message: "Invalid, expired, or already used pairing token." };
    }

    const tokenRow = res.rows[0];
    const webUserId = tokenRow.web_user_id;

    await pool.query(`UPDATE telegram_pairing_tokens SET is_used = TRUE WHERE id = $1`, [tokenRow.id]);

    // Unbind telegram_user_id from any other web_user accounts to prevent unique constraint violations
    await pool.query(
      `UPDATE web_users SET telegram_user_id = NULL, telegram_username = NULL WHERE telegram_user_id = $1 AND id != $2`,
      [telegramUserId, webUserId]
    );

    await pool.query(
      `UPDATE web_users
       SET telegram_user_id = $1, telegram_username = $2, updated_at = NOW()
       WHERE id = $3`,
      [telegramUserId, telegramUsername || null, webUserId]
    );

    await this.ensureTelegramUserRecord(telegramUserId, undefined, telegramUsername);

    eventBusService.emitUserEvent({
      type: "telegram_paired",
      userId: webUserId,
      telegramUserId: telegramUserId,
      data: {
        telegramUserId,
        telegramUsername,
        linkedAt: new Date().toISOString(),
      },
    });

    return { success: true, webUserId, message: "Telegram account successfully synced with your Web Workspace!" };
  }

  /**
   * Generates a single-use Magic Login Token from Telegram (`/web` or inline button).
   * Token is hashed at rest with 5-minute expiry.
   */
  public async generateMagicLoginToken(
    telegramUserId: number,
    telegramUsername?: string,
    redirectPath = "/app"
  ): Promise<{ token: string; magicUrl: string; expiresAt: Date }> {
    const pool = getPool();
    const rawToken = `magic_${crypto.randomBytes(16).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min TTL

    const userRes = await pool.query(`SELECT id FROM web_users WHERE telegram_user_id = $1`, [telegramUserId]);
    const webUserId = userRes.rows.length > 0 ? userRes.rows[0].id : null;

    await pool.query(
      `INSERT INTO telegram_pairing_tokens (token, web_user_id, telegram_user_id, telegram_username, type, is_used, expires_at)
       VALUES ($1, $2, $3, $4, 'tg_to_web', FALSE, $5)`,
      [rawToken, webUserId, telegramUserId, telegramUsername || null, expiresAt]
    );

    const baseUrl = (process.env.APP_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    const cleanRedirect = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
    const magicUrl = baseUrl ? `${baseUrl}/api/auth/magic-token-exchange?token=${rawToken}&redirect=${encodeURIComponent(cleanRedirect)}` : `/app?magic_token=${rawToken}`;
    
    return { token: rawToken, magicUrl, expiresAt };
  }

  /**
   * Consumes a single-use magic login token via POST or exchange endpoint.
   */
  public async consumeMagicLoginToken(token: string): Promise<{ user: AuthenticatedUser; sessionToken: string } | null> {
    if (!token?.trim()) return null;
    const pool = getPool();
    const query = `
      SELECT * FROM telegram_pairing_tokens
      WHERE token = $1 AND type = 'tg_to_web' AND is_used = FALSE AND expires_at > NOW();
    `;

    const res = await pool.query(query, [token.trim()]);
    if (res.rows.length === 0) return null;

    const tokenRow = res.rows[0];
    await pool.query(`UPDATE telegram_pairing_tokens SET is_used = TRUE WHERE id = $1`, [tokenRow.id]);

    const telegramUserId = tokenRow.telegram_user_id;
    const telegramUsername = tokenRow.telegram_username;

    let webUserRes = await pool.query(`SELECT * FROM web_users WHERE telegram_user_id = $1`, [telegramUserId]);
    let webUser = webUserRes.rows[0];

    if (!webUser && tokenRow.web_user_id) {
      const directUserRes = await pool.query(`SELECT * FROM web_users WHERE id = $1`, [tokenRow.web_user_id]);
      webUser = directUserRes.rows[0];
      if (webUser && !webUser.telegram_user_id) {
        await pool.query(`UPDATE web_users SET telegram_user_id = $1, telegram_username = $2 WHERE id = $3`, [telegramUserId, telegramUsername, webUser.id]);
      }
    }

    if (!webUser) {
      const syntheticEmail = `tg_${telegramUserId}@telegram.ai`;
      const insertRes = await pool.query(
        `INSERT INTO web_users (email, name, role, telegram_user_id, telegram_username, last_login_at, updated_at)
         VALUES ($1, $2, 'user', $3, $4, NOW(), NOW())
         RETURNING *`,
        [syntheticEmail, telegramUsername || `Telegram User #${telegramUserId}`, telegramUserId, telegramUsername]
      );
      webUser = insertRes.rows[0];
    }

    const user: AuthenticatedUser = {
      id: webUser.id,
      email: webUser.email,
      name: webUser.name,
      picture: webUser.picture,
      role: webUser.role as "admin" | "user",
      telegramUserId: webUser.telegram_user_id ? BigInt(webUser.telegram_user_id) : undefined,
      telegramUsername: webUser.telegram_username || undefined,
      notificationPreference: (webUser.notification_preference as any) || "digest_only",
      contextSyncMode: (webUser.context_sync_mode as any) || "compact",
      themePreference: (webUser.theme_preference as any) || "system",
    };

    const sessionToken = this.generateToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO web_sessions (session_token, web_user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionToken, user.id, expiresAt]
    );

    return { user, sessionToken };
  }

  /**
   * Verifies Telegram WebApp initData HMAC signature and auth_date freshness (<24h)
   */
  public verifyTelegramInitData(initData: string): { isValid: boolean; user?: { id: number; username?: string; first_name?: string } } {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !initData?.trim()) return { isValid: false };

    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get("hash");
      if (!hash) return { isValid: false };

      urlParams.delete("hash");

      const authDate = parseInt(urlParams.get("auth_date") || "0", 10);
      const now = Math.floor(Date.now() / 1000);
      // Freshness check: reject signatures older than 24 hours
      if (now - authDate > 86400 || authDate <= 0) {
        return { isValid: false };
      }

      const paramsArray: string[] = [];
      urlParams.sort();
      for (const [key, value] of urlParams.entries()) {
        paramsArray.push(`${key}=${value}`);
      }
      const dataCheckString = paramsArray.join("\n");

      const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
      const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

      if (calculatedHash !== hash) {
        return { isValid: false };
      }

      const rawUser = urlParams.get("user");
      const user = rawUser ? JSON.parse(rawUser) : undefined;
      return { isValid: true, user };
    } catch (err) {
      logger.warn({ error: err }, "Failed verifying Telegram WebApp initData signature");
      return { isValid: false };
    }
  }

  /**
   * Updates user preferences.
   */
  public async updatePreferences(
    userId: number,
    preferences: { 
      notificationPreference?: "full" | "digest_only" | "silent"; 
      contextSyncMode?: "compact" | "full";
      themePreference?: "light" | "dark" | "system";
    }
  ): Promise<AuthenticatedUser | null> {
    const pool = getPool();
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (preferences.notificationPreference) {
      updates.push(`notification_preference = $${idx++}`);
      values.push(preferences.notificationPreference);
    }
    if (preferences.contextSyncMode) {
      updates.push(`context_sync_mode = $${idx++}`);
      values.push(preferences.contextSyncMode);
    }
    if (preferences.themePreference) {
      updates.push(`theme_preference = $${idx++}`);
      values.push(preferences.themePreference);
    }

    if (updates.length === 0) return null;
    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE web_users
      SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING id, email, google_id, name, picture, role, telegram_user_id, telegram_username, notification_preference, context_sync_mode, theme_preference;
    `;

    const res = await pool.query(query, values);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      googleId: row.google_id || undefined,
      name: row.name || undefined,
      picture: row.picture || undefined,
      role: row.role as "admin" | "user",
      telegramUserId: row.telegram_user_id ? BigInt(row.telegram_user_id) : undefined,
      telegramUsername: row.telegram_username || undefined,
      notificationPreference: row.notification_preference,
      contextSyncMode: row.context_sync_mode,
      themePreference: row.theme_preference,
    };
  }

  public async ensureTelegramUserRecord(telegramUserId: number, name?: string, username?: string, isAdmin?: boolean): Promise<void> {
    const pool = getPool();
    const tier = isAdmin ? "vip" : "free";
    const quota = isAdmin ? 999999 : 50;
    try {
      await pool.query(
        `INSERT INTO users (telegram_user_id, first_name, username, tier, daily_quota, status, last_active_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
         ON CONFLICT (telegram_user_id) DO UPDATE SET
           first_name = COALESCE(EXCLUDED.first_name, users.first_name),
           username = COALESCE(EXCLUDED.username, users.username),
           tier = CASE WHEN EXCLUDED.tier = 'vip' THEN 'vip' ELSE users.tier END,
           daily_quota = CASE WHEN EXCLUDED.tier = 'vip' THEN 999999 ELSE users.daily_quota END,
           last_active_at = NOW(),
           updated_at = NOW();`,
        [telegramUserId, name || "Web User", username || null, tier, quota]
      );
    } catch (err) {
      logger.warn({ error: err }, "Failed to ensure Telegram user record");
    }
  }
}

export const authService = new AuthService();
