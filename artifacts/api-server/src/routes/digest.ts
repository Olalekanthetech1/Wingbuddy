import { Router, Request, Response } from "express";
import { dailyDigestService } from "../services/daily-digest.service";
import { authService } from "../services/auth.service";
import { logger } from "../lib/logger";

const router = Router();

async function resolveTelegramUserId(req: Request): Promise<bigint | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const user = await authService.validateSession(token);
  if (!user || !user.telegramUserId) return null;
  return BigInt(user.telegramUserId);
}

// 1. Preview current daily digest
router.get("/user/digest/preview", async (req: Request, res: Response) => {
  try {
    const tgId = await resolveTelegramUserId(req);
    if (!tgId) {
      res.status(401).json({ error: "Telegram account not linked or unauthorized" });
      return;
    }
    const digest = await dailyDigestService.buildDigest(tgId, { forceIncludeAllSections: true });
    res.json({
      success: true,
      digest: {
        htmlText: digest.htmlText,
        itemCount: digest.itemCount,
        sectionsIncluded: digest.sectionsIncluded,
        metadata: digest.metadata,
      },
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed generating digest preview");
    res.status(500).json({ error: err.message });
  }
});

// 2. Trigger immediate daily digest send
router.post("/user/digest/send-now", async (req: Request, res: Response) => {
  try {
    const tgId = await resolveTelegramUserId(req);
    if (!tgId) {
      res.status(401).json({ error: "Telegram account not linked or unauthorized" });
      return;
    }
    const result = await dailyDigestService.sendDigestNow(tgId, true);
    res.json(result);
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed dispatching manual digest");
    res.status(500).json({ error: err.message });
  }
});

// 3. Get daily digest settings
router.get("/user/digest/settings", async (req: Request, res: Response) => {
  try {
    const tgId = await resolveTelegramUserId(req);
    if (!tgId) {
      res.status(401).json({ error: "Telegram account not linked or unauthorized" });
      return;
    }
    const settings = await dailyDigestService.getPreferences(tgId);
    res.json({ success: true, settings });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed fetching digest settings");
    res.status(500).json({ error: err.message });
  }
});

// 4. Update daily digest settings
router.put("/user/digest/settings", async (req: Request, res: Response) => {
  try {
    const tgId = await resolveTelegramUserId(req);
    if (!tgId) {
      res.status(401).json({ error: "Telegram account not linked or unauthorized" });
      return;
    }
    const { enabled, sendTime, timezone, sections, days, whenEmpty, includeWeeklySummary } = req.body;
    const updated = await dailyDigestService.updatePreferences(tgId, {
      enabled,
      sendTime,
      timezone,
      sections,
      days,
      whenEmpty,
      includeWeeklySummary,
    });
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed updating digest settings");
    res.status(500).json({ error: err.message });
  }
});

export default router;
