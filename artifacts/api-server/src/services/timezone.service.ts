import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";

export interface UserTimezoneInfo {
  telegramUserId: number;
  timezone: string;
  utcOffsetMinutes: number;
  offsetFormatted: string;
  localTime: string;
  localDate: string;
  localHour: number;
  localMinute: number;
  source: string;
  isUtc: boolean;
}

export interface LocalTimeParts {
  date: string;       // YYYY-MM-DD
  time: string;       // HH:mm:ss
  hour: number;       // 0-23
  minute: number;     // 0-59
  second: number;     // 0-59
  dayOfWeek: string;  // e.g. "Monday"
}

export const SYSTEM_DEFAULT_TIMEZONE = "UTC";
const TABLE = "user_timezones";

/**
 * TimezoneService maintains a user-specific timezone registry in PostgreSQL,
 * ensuring all scheduled jobs (e.g. daily check-ins, reminders, recurring agent tasks)
 * reference user-specific offsets while strictly retaining UTC as the system clock.
 */
export class TimezoneService {
  /**
   * Validates whether a given timezone string is a recognized IANA timezone identifier.
   */
  isValidTimezone(timezone: unknown): boolean {
    if (typeof timezone !== "string" || !timezone.trim()) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone.trim() }).format();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes a timezone string to a valid IANA timezone, falling back to UTC.
   */
  normalizeTimezone(timezone: unknown, fallback: string = SYSTEM_DEFAULT_TIMEZONE): string {
    if (this.isValidTimezone(timezone)) {
      return (timezone as string).trim();
    }
    return this.isValidTimezone(fallback) ? fallback.trim() : SYSTEM_DEFAULT_TIMEZONE;
  }

  /**
   * Calculates the exact signed offset in minutes between UTC and the specified timezone
   * for a given moment in time (correctly accounting for Daylight Saving Time).
   * Positive value = ahead of UTC (e.g. UTC+1 -> +60).
   * Negative value = behind UTC (e.g. UTC-5 -> -300).
   */
  getUtcOffsetMinutes(timezone: string, date: Date = new Date()): number {
    const tz = this.normalizeTimezone(timezone);
    if (tz.toUpperCase() === "UTC") return 0;

    try {
      const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
      const tzStr = date.toLocaleString("en-US", { timeZone: tz });
      const utcDate = new Date(utcStr);
      const tzDate = new Date(tzStr);
      return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    } catch {
      return 0;
    }
  }

  /**
   * Formats an offset in minutes into "+HH:mm" or "-HH:mm" (e.g. "+01:00", "-05:00", "+00:00").
   */
  formatOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, "0");
    const minutes = String(abs % 60).padStart(2, "0");
    return `${sign}${hours}:${minutes}`;
  }

  /**
   * Resolves date and clock components in a user's local timezone.
   */
  getLocalParts(date: Date = new Date(), timezone: string = SYSTEM_DEFAULT_TIMEZONE): LocalTimeParts {
    const tz = this.normalizeTimezone(timezone);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      hourCycle: "h23",
    });

    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const hour = Number(map.hour ?? "0");
    const minute = Number(map.minute ?? "0");
    const second = Number(map.second ?? "0");
    const dateStr = `${map.year}-${map.month}-${map.day}`;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

    return {
      date: dateStr,
      time: timeStr,
      hour,
      minute,
      second,
      dayOfWeek: map.weekday ?? "",
    };
  }

  /**
   * Formats a UTC date with user-local dual representation:
   * e.g. "2026-09-14 06:00:00 UTC (07:00:00 Africa/Lagos [UTC+1])"
   */
  formatDualTimestamp(utcDate: Date, timezone: string = SYSTEM_DEFAULT_TIMEZONE): string {
    const tz = this.normalizeTimezone(timezone);
    const utcParts = this.getLocalParts(utcDate, "UTC");
    const localParts = this.getLocalParts(utcDate, tz);
    const offset = this.formatOffset(this.getUtcOffsetMinutes(tz, utcDate));

    const utcFormatted = `${utcParts.date} ${utcParts.time} UTC`;
    if (tz.toUpperCase() === "UTC") return utcFormatted;

    return `${utcFormatted} (${localParts.time} ${tz} [UTC${offset}])`;
  }

  /**
   * Initializes the user_timezones table in the database and synchronizes
   * any pre-existing onboarding profile timezones into the dedicated registry.
   */
  async initialize(): Promise<void> {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id SERIAL PRIMARY KEY,
        telegram_user_id BIGINT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        utc_offset_minutes INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'user_preference',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_timezones_telegram_user_id_idx ON ${TABLE}(telegram_user_id);
      CREATE INDEX IF NOT EXISTS user_timezones_tz_idx ON ${TABLE}(timezone);
    `);

    // Backfill from onboarding_profiles if any profiles exist without a user_timezones entry
    try {
      const pendingRows = await pool.query(`
        SELECT op.telegram_user_id AS "telegramUserId", op.timezone
        FROM onboarding_profiles op
        LEFT JOIN ${TABLE} ut ON ut.telegram_user_id = op.telegram_user_id
        WHERE ut.telegram_user_id IS NULL AND op.timezone IS NOT NULL
      `);

      for (const row of pendingRows.rows) {
        const userId = Number(row.telegramUserId);
        const tz = this.normalizeTimezone(row.timezone);
        const offset = this.getUtcOffsetMinutes(tz);
        await pool.query(`
          INSERT INTO ${TABLE} (telegram_user_id, timezone, utc_offset_minutes, source, updated_at)
          VALUES ($1, $2, $3, 'onboarding_sync', NOW())
          ON CONFLICT (telegram_user_id) DO NOTHING
        `, [userId, tz, offset]);
      }
      if (pendingRows.rows.length > 0) {
        logger.info({ count: pendingRows.rows.length }, "Synchronized legacy onboarding timezones into user_timezones registry");
      }
    } catch (e) {
      // Table onboarding_profiles may not exist yet if called before onboardingService; safe to continue
    }
  }

  /**
   * Retrieves the configured IANA timezone for a Telegram user.
   * Checks the user_timezones registry first, falls back to onboarding_profiles, then defaults to "UTC".
   */
  async getUserTimezone(telegramUserId: number | bigint): Promise<string> {
    const pool = getPool();
    const id = Number(telegramUserId);

    try {
      const res = await pool.query(`
        SELECT timezone FROM ${TABLE} WHERE telegram_user_id = $1 LIMIT 1
      `, [id]);

      if (res.rows[0]?.timezone && this.isValidTimezone(res.rows[0].timezone)) {
        return res.rows[0].timezone;
      }

      // Check onboarding_profiles as secondary fallback
      const obRes = await pool.query(`
        SELECT timezone FROM onboarding_profiles WHERE telegram_user_id = $1 LIMIT 1
      `, [id]);

      if (obRes.rows[0]?.timezone && this.isValidTimezone(obRes.rows[0].timezone)) {
        const fallbackTz = obRes.rows[0].timezone;
        // Self-heal the registry
        await this.setUserTimezone(id, fallbackTz, "onboarding_sync");
        return fallbackTz;
      }
    } catch {
      // Return default on error
    }

    return SYSTEM_DEFAULT_TIMEZONE;
  }

  /**
   * Retrieves comprehensive timezone information and dynamic local time snapshot for a user.
   */
  async getUserTimezoneInfo(telegramUserId: number | bigint, atDate: Date = new Date()): Promise<UserTimezoneInfo> {
    const id = Number(telegramUserId);
    const pool = getPool();

    let tz = SYSTEM_DEFAULT_TIMEZONE;
    let source = "default";

    try {
      const res = await pool.query(`
        SELECT timezone, source FROM ${TABLE} WHERE telegram_user_id = $1 LIMIT 1
      `, [id]);

      if (res.rows[0]?.timezone && this.isValidTimezone(res.rows[0].timezone)) {
        tz = res.rows[0].timezone;
        source = res.rows[0].source || "registry";
      } else {
        const obRes = await pool.query(`
          SELECT timezone FROM onboarding_profiles WHERE telegram_user_id = $1 LIMIT 1
        `, [id]);
        if (obRes.rows[0]?.timezone && this.isValidTimezone(obRes.rows[0].timezone)) {
          tz = obRes.rows[0].timezone;
          source = "onboarding";
        }
      }
    } catch {
      // Fall through to default
    }

    const utcOffsetMinutes = this.getUtcOffsetMinutes(tz, atDate);
    const offsetFormatted = this.formatOffset(utcOffsetMinutes);
    const local = this.getLocalParts(atDate, tz);

    return {
      telegramUserId: id,
      timezone: tz,
      utcOffsetMinutes,
      offsetFormatted,
      localTime: `${local.date} ${local.time}`,
      localDate: local.date,
      localHour: local.hour,
      localMinute: local.minute,
      source,
      isUtc: tz.toUpperCase() === "UTC",
    };
  }

  /**
   * Sets or updates a user's specific timezone in the registry and keeps onboarding in sync.
   */
  async setUserTimezone(
    telegramUserId: number | bigint,
    timezoneInput: string,
    source: string = "user_preference",
  ): Promise<UserTimezoneInfo> {
    const id = Number(telegramUserId);
    const tz = this.normalizeTimezone(timezoneInput);
    const offset = this.getUtcOffsetMinutes(tz);
    const pool = getPool();

    await pool.query(`
      INSERT INTO ${TABLE} (telegram_user_id, timezone, utc_offset_minutes, source, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        timezone = EXCLUDED.timezone,
        utc_offset_minutes = EXCLUDED.utc_offset_minutes,
        source = EXCLUDED.source,
        updated_at = NOW()
    `, [id, tz, offset, source]);

    // Keep onboarding profile timezone in sync if row exists
    try {
      await pool.query(`
        UPDATE onboarding_profiles
        SET timezone = $1, updated_at = NOW()
        WHERE telegram_user_id = $2
      `, [tz, id]);
    } catch {
      // Ignore if table doesn't exist
    }

    logger.info({ telegramUserId: id, timezone: tz, utcOffsetMinutes: offset, source }, "Updated user timezone registry");
    return this.getUserTimezoneInfo(id);
  }

  /**
   * Lists all registered user timezone profiles.
   */
  async listAll(): Promise<UserTimezoneInfo[]> {
    const pool = getPool();
    const now = new Date();
    try {
      const res = await pool.query(`
        SELECT telegram_user_id AS "telegramUserId", timezone, source
        FROM ${TABLE}
        ORDER BY updated_at DESC
      `);

      return res.rows.map((row) => {
        const id = Number(row.telegramUserId);
        const tz = this.normalizeTimezone(row.timezone);
        const offset = this.getUtcOffsetMinutes(tz, now);
        const local = this.getLocalParts(now, tz);
        return {
          telegramUserId: id,
          timezone: tz,
          utcOffsetMinutes: offset,
          offsetFormatted: this.formatOffset(offset),
          localTime: `${local.date} ${local.time}`,
          localDate: local.date,
          localHour: local.hour,
          localMinute: local.minute,
          source: row.source,
          isUtc: tz.toUpperCase() === "UTC",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Evaluates if a given target time (format "HH:mm") matches right now in the user's local timezone.
   * This allows the scheduler to tick on the UTC system clock every minute while triggering
   * at each individual user's localized target time (e.g. 07:00 or 20:00 in their time).
   */
  async isScheduledTimeForUser(
    telegramUserId: number | bigint,
    targetTimeHHMM: string,
    utcNow: Date = new Date(),
  ): Promise<boolean> {
    const tz = await this.getUserTimezone(telegramUserId);
    return this.isScheduledTimeInTimezone(tz, targetTimeHHMM, utcNow);
  }

  /**
   * Synchronously evaluates if targetTimeHHMM matches utcNow in the specified timezone.
   */
  isScheduledTimeInTimezone(
    timezone: string,
    targetTimeHHMM: string,
    utcNow: Date = new Date(),
  ): boolean {
    const [targetH, targetM] = targetTimeHHMM.split(":").map(Number);
    if (isNaN(targetH) || isNaN(targetM)) return false;

    const local = this.getLocalParts(utcNow, timezone);
    return local.hour === targetH && local.minute === targetM;
  }

  /**
   * Evaluates if the current UTC time falls within the user's local quiet hours.
   */
  async isInQuietHoursForUser(
    telegramUserId: number | bigint,
    quietStartHHMM: string,
    quietEndHHMM: string,
    utcNow: Date = new Date(),
  ): Promise<boolean> {
    const tz = await this.getUserTimezone(telegramUserId);
    const local = this.getLocalParts(utcNow, tz);
    const currentMin = local.hour * 60 + local.minute;

    const [startH, startM] = quietStartHHMM.split(":").map(Number);
    const [endH, endM] = quietEndHHMM.split(":").map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    if (startMin === endMin) return false;
    return startMin < endMin
      ? currentMin >= startMin && currentMin < endMin
      : currentMin >= startMin || currentMin < endMin;
  }

  /**
   * Calculates the next exact UTC Date when the user's local clock will reach timeHHMM.
   * This is used to schedule future runs into PostgreSQL TIMESTAMPTZ queues (such as agent_tasks or reminders)
   * in canonical UTC, while honouring the user's local timezone and DST offsets.
   */
  calculateNextOccurrenceUtc(
    timeHHMM: string,
    timezone: string = SYSTEM_DEFAULT_TIMEZONE,
    fromUtc: Date = new Date(),
  ): Date {
    const tz = this.normalizeTimezone(timezone);
    const [targetHour, targetMin] = timeHHMM.split(":").map(Number);
    const local = this.getLocalParts(fromUtc, tz);

    // Compute candidate date in local time
    const [y, m, d] = local.date.split("-").map(Number);
    let targetDay = d;
    let targetMonth = m;
    let targetYear = y;

    const currentMin = local.hour * 60 + local.minute;
    const targetMinuteOfDay = targetHour * 60 + targetMin;

    if (currentMin >= targetMinuteOfDay) {
      // Advance by one calendar day
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
      targetYear = nextDay.getUTCFullYear();
      targetMonth = nextDay.getUTCMonth() + 1;
      targetDay = nextDay.getUTCDate();
    }

    const isoDateStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
    
    // Estimate initial UTC time by subtracting the offset at fromUtc
    const approxOffset = this.getUtcOffsetMinutes(tz, fromUtc);
    let utcEstimate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMin) - approxOffset * 60000);

    // Verify and refine against actual DST in effect on that date
    const refinedOffset = this.getUtcOffsetMinutes(tz, utcEstimate);
    if (refinedOffset !== approxOffset) {
      utcEstimate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, targetHour, targetMin) - refinedOffset * 60000);
    }

    return utcEstimate;
  }
}

export const timezoneService = new TimezoneService();
