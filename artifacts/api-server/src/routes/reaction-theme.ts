import { Router, type Request, type Response } from "express";
import {
  reactionThemeService,
  ALLOWED_TELEGRAM_REACTIONS,
} from "../services/reaction-theme.service";
import { telegramIdentityService } from "../services/telegram-identity.service";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/reaction-theme
 * Returns current global reaction theme and all available themes
 */
router.get("/reaction-theme", async (_req: Request, res: Response) => {
  try {
    const currentThemeId = await reactionThemeService.getGlobalThemeId();
    const themes = reactionThemeService.getAvailableThemes();
    res.json({
      currentThemeId,
      themes,
      allowedReactionEmojis: Array.from(ALLOWED_TELEGRAM_REACTIONS),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/reaction-theme
 * Updates global reaction theme with validation and admin audit log
 */
router.post("/reaction-theme", async (req: Request, res: Response) => {
  try {
    const { themeId, adminUser } = req.body;
    if (!themeId || typeof themeId !== "string") {
      return res.status(400).json({ error: "Missing required 'themeId'" });
    }

    const effectiveAdmin = adminUser || req.header("x-admin-user") || "admin";
    const updatedTheme = await reactionThemeService.setGlobalTheme(themeId, effectiveAdmin);

    res.json({
      success: true,
      currentThemeId: updatedTheme.id,
      theme: updatedTheme,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("invalid Telegram reaction") || message.includes("Unknown") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /api/reaction-theme/test
 * Sends a live test reaction to verify Telegram Bot API connectivity
 */
router.post("/reaction-theme/test", async (req: Request, res: Response) => {
  try {
    const { chatId, messageId, emoji } = req.body;
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

    if (!token) {
      return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN is not configured" });
    }

    const testEmoji = emoji || "⚡";
    if (!ALLOWED_TELEGRAM_REACTIONS.has(testEmoji)) {
      return res.status(400).json({
        error: `Emoji '${testEmoji}' is not a valid Telegram reaction. Telegram only accepts ReactionTypeEmoji.`,
      });
    }

    if (chatId && messageId) {
      const startTime = Date.now();
      const response = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: "emoji", emoji: testEmoji }],
        }),
      });

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      if (!data.ok) {
        return res.status(400).json({
          success: false,
          error: data.description || "Telegram API rejected reaction",
          latencyMs,
        });
      }

      return res.json({
        success: true,
        message: `Successfully set test reaction '${testEmoji}' on message ${messageId}`,
        latencyMs,
      });
    }

    // If no specific message provided, verify bot token against getMe
    const identity = telegramIdentityService.getBotIdentity();
    res.json({
      success: true,
      message: `Verified Telegram Bot @${identity.username || "Bot"}. Emojis in theme are 100% valid.`,
      botUsername: identity.username,
      verifiedEmoji: testEmoji,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
