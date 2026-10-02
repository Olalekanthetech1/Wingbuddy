import { getPool } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Valid Telegram Bot API reaction emojis as specified by Telegram ReactionTypeEmoji.
 * Any emoji outside this set will fail with REACTION_INVALID.
 */
export const ALLOWED_TELEGRAM_REACTIONS = new Set<string>([
  "👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉",
  "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤️‍🔥", "🌚",
  "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕",
  "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍️",
  "🤗", "🫡", "🎅", "🎄", "☃️", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘",
  "💊", "🙊", "😎", "👾", "🤷‍♂️", "🤷", "🤷‍♀️", "😡",
]);

export interface ThemePill {
  label: string;
  emoji: string;
}

export interface ReactionThemeDefinition {
  id: string;
  name: string;
  description: string;
  pills: ThemePill[];
  emojis: {
    intake?: string;
    tasks?: string;
    ideas_or_analysis?: string;
    gratitude_or_salute?: string;
    done?: string;
  };
  enabled: boolean;
}

export const REACTION_THEMES: Record<string, ReactionThemeDefinition> = {
  modern_snappy: {
    id: "modern_snappy",
    name: "⚡ Modern & Snappy",
    description: "Professional, agile, and crisp. Instant ⚡ intake.",
    pills: [
      { label: "Fast", emoji: "⚡" },
      { label: "Tasks", emoji: "✍️" },
      { label: "Ideas", emoji: "🤔" },
      { label: "Done", emoji: "🔥" },
    ],
    emojis: {
      intake: "⚡",
      tasks: "✍️",
      ideas_or_analysis: "🤔",
      gratitude_or_salute: "🫡",
      done: "🔥",
    },
    enabled: true,
  },
  friendly_attentive: {
    id: "friendly_attentive",
    name: "👀 Friendly & Attentive",
    description: "Warm, personable, and attentive team vibe.",
    pills: [
      { label: "Reading", emoji: "👀" },
      { label: "Tasks", emoji: "👌" },
      { label: "Thanks", emoji: "🙏" },
      { label: "Done", emoji: "🎉" },
    ],
    emojis: {
      intake: "👀",
      tasks: "👌",
      ideas_or_analysis: "🤔",
      gratitude_or_salute: "🙏",
      done: "🎉",
    },
    enabled: true,
  },
  ai_futuristic: {
    id: "ai_futuristic",
    name: "👾 AI / Futuristic",
    description: "High-tech AI persona with intelligent cues.",
    pills: [
      { label: "Cyber", emoji: "👾" },
      { label: "Analysis", emoji: "🤓" },
      { label: "Salute", emoji: "🫡" },
      { label: "Done", emoji: "💯" },
    ],
    emojis: {
      intake: "👾",
      tasks: "👨‍💻",
      ideas_or_analysis: "🤓",
      gratitude_or_salute: "🫡",
      done: "💯",
    },
    enabled: true,
  },
  disabled: {
    id: "disabled",
    name: "🚫 Reactions Disabled",
    description: "Shows live typing only without adding emoji reactions.",
    pills: [{ label: "Typing indicator only", emoji: "" }],
    emojis: {},
    enabled: false,
  },
};

export class ReactionThemeService {
  private cache: { themeId: string; timestamp: number } | null = null;
  private readonly cacheTtlMs = 5_000;

  validateThemeEmojis(theme: ReactionThemeDefinition): { valid: boolean; invalidEmojis: string[] } {
    if (!theme.enabled) return { valid: true, invalidEmojis: [] };
    const invalid: string[] = [];
    for (const [key, emoji] of Object.entries(theme.emojis)) {
      if (emoji && !ALLOWED_TELEGRAM_REACTIONS.has(emoji)) {
        invalid.push(`${key}: ${emoji}`);
      }
    }
    return { valid: invalid.length === 0, invalidEmojis: invalid };
  }

  async ensureSchema(): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id SERIAL PRIMARY KEY,
          admin_user TEXT NOT NULL,
          action TEXT NOT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } catch (err) {
      logger.warn({ error: err }, "Could not ensure admin_audit_logs table");
    }
  }

  async getGlobalThemeId(): Promise<string> {
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache.themeId;
    }

    try {
      const pool = getPool();
      const res = await pool.query(
        "SELECT value FROM system_settings WHERE key = 'REACTION_THEME' LIMIT 1"
      );
      const val = res.rows[0]?.value?.trim();
      const themeId = val && REACTION_THEMES[val] ? val : "modern_snappy";
      this.cache = { themeId, timestamp: now };
      return themeId;
    } catch {
      return "modern_snappy";
    }
  }

  async getUserTheme(telegramUserId?: string | number): Promise<ReactionThemeDefinition> {
    if (telegramUserId) {
      try {
        const pool = getPool();
        const res = await pool.query(
          "SELECT value FROM user_memories WHERE telegram_user_id = $1 AND category = 'preferences' AND key = 'reaction_theme' LIMIT 1",
          [String(telegramUserId)]
        );
        const userPref = res.rows[0]?.value?.trim();
        if (userPref && REACTION_THEMES[userPref]) {
          return REACTION_THEMES[userPref];
        }
      } catch {
        // Fallback to global setting on error
      }
    }

    const globalId = await this.getGlobalThemeId();
    return REACTION_THEMES[globalId] || REACTION_THEMES.modern_snappy;
  }

  async setGlobalTheme(themeId: string, adminUser: string): Promise<ReactionThemeDefinition> {
    const theme = REACTION_THEMES[themeId];
    if (!theme) {
      throw new Error(`Unknown reaction theme '${themeId}'. Valid themes: ${Object.keys(REACTION_THEMES).join(", ")}`);
    }

    const validation = this.validateThemeEmojis(theme);
    if (!validation.valid) {
      throw new Error(`Theme contains invalid Telegram reaction emojis: ${validation.invalidEmojis.join(", ")}`);
    }

    await this.ensureSchema();
    const pool = getPool();
    const oldId = await this.getGlobalThemeId();

    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('REACTION_THEME', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [themeId]
    );

    try {
      await pool.query(
        `INSERT INTO admin_audit_logs (admin_user, action, details)
         VALUES ($1, 'SET_REACTION_THEME', $2::jsonb)`,
        [adminUser, JSON.stringify({ previousTheme: oldId, newTheme: themeId })]
      );
    } catch (err) {
      logger.warn({ error: err }, "Failed recording admin audit log for reaction theme change");
    }

    this.cache = { themeId, timestamp: Date.now() };
    return theme;
  }

  async setUserTheme(telegramUserId: string | number, themeId: string): Promise<ReactionThemeDefinition> {
    const theme = REACTION_THEMES[themeId];
    if (!theme) {
      throw new Error(`Unknown reaction theme '${themeId}'.`);
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO user_memories (telegram_user_id, category, key, value, status, updated_at)
       VALUES ($1, 'preferences', 'reaction_theme', $2, 'active', NOW())
       ON CONFLICT (telegram_user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [String(telegramUserId), themeId]
    );

    return theme;
  }

  getAvailableThemes(): ReactionThemeDefinition[] {
    return Object.values(REACTION_THEMES);
  }

  clearCache(): void {
    this.cache = null;
  }
}

export const reactionThemeService = new ReactionThemeService();
