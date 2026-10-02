import { logger } from "../lib/logger";

export interface TelegramBotIdentity {
  id?: number;
  username?: string;
  firstName?: string;
  isReady: boolean;
  lastCheckedAt?: Date;
  error?: string;
}

export class TelegramIdentityService {
  private identity: TelegramBotIdentity = {
    isReady: false,
  };
  private refreshInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor() {
    // Start non-blocking initial resolution and background refresh loop
    void this.resolveBotIdentity();
    this.refreshInterval = setInterval(() => {
      void this.resolveBotIdentity();
    }, 5 * 60 * 1000);
    if (this.refreshInterval.unref) {
      this.refreshInterval.unref();
    }
  }

  /**
   * Resolves the live Telegram bot identity from Telegram API without blocking server boot.
   */
  public async resolveBotIdentity(tokenOverride?: string): Promise<TelegramBotIdentity> {
    if (this.isChecking) return this.identity;
    this.isChecking = true;

    const token = tokenOverride || process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !token.trim()) {
      this.identity = {
        isReady: false,
        error: "TELEGRAM_BOT_TOKEN is not configured in environment.",
        lastCheckedAt: new Date(),
      };
      this.isChecking = false;
      return this.identity;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "HTTP error");
        logger.warn({ status: res.status, errorText }, "Telegram getMe API returned non-200");
        this.identity = {
          isReady: false,
          error: `Telegram getMe failed (${res.status}): ${errorText}`,
          lastCheckedAt: new Date(),
        };
        this.isChecking = false;
        return this.identity;
      }

      const data = await res.json() as { ok: boolean; result?: { id: number; username?: string; first_name?: string } };
      if (data.ok && data.result?.username) {
        this.identity = {
          id: data.result.id,
          username: data.result.username,
          firstName: data.result.first_name,
          isReady: true,
          lastCheckedAt: new Date(),
        };
        logger.info({ botUsername: this.identity.username, botId: this.identity.id }, "Telegram bot identity verified from live API");
      } else {
        this.identity = {
          isReady: false,
          error: "Telegram getMe returned invalid payload structure.",
          lastCheckedAt: new Date(),
        };
      }
    } catch (err: any) {
      logger.warn({ error: err?.message || String(err) }, "Failed resolving live Telegram bot identity");
      this.identity = {
        isReady: false,
        error: err?.message || "Connection timeout to Telegram API",
        lastCheckedAt: new Date(),
      };
    } finally {
      this.isChecking = false;
    }

    return this.identity;
  }

  public getBotIdentity(): TelegramBotIdentity {
    return this.identity;
  }

  public getBotUsername(): string | null {
    return this.identity.isReady && this.identity.username ? this.identity.username : null;
  }

  public isConfigured(): boolean {
    return Boolean(this.identity.isReady && this.identity.username);
  }

  public getPairingDeepLink(token: string): { url: string; botUsername: string } | null {
    const username = this.getBotUsername();
    if (!username) return null;
    return {
      url: `https://t.me/${username}?start=${token}`,
      botUsername: username,
    };
  }

  public cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

export const telegramIdentityService = new TelegramIdentityService();
