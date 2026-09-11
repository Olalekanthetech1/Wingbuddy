import { Router, Request, Response } from "express";
import { userTierService, UserTier, UserStatus } from "../services/user-tier.service";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import { unifiedModelRegistryService } from "../services/unified-model-registry.service";
import { logger } from "../lib/logger";

const router = Router();

// 1. Get access summary stats & user list
router.get("/access/users", async (_req: Request, res: Response) => {
  try {
    const [users, stats, policy] = await Promise.all([
      userTierService.listUsers(),
      userTierService.getSummaryStats(),
      userTierService.getPolicy(),
    ]);
    res.json({
      success: true,
      stats,
      policy,
      users,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to fetch user access list");
    res.status(500).json({ error: err.message || "Failed to fetch users" });
  }
});

// 2. Get global access policy
router.get("/access/policy", async (_req: Request, res: Response) => {
  try {
    const policy = await userTierService.getPolicy();
    res.json({ success: true, policy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update global access policy
router.put("/access/policy", async (req: Request, res: Response) => {
  try {
    const patch = req.body || {};
    const updated = await userTierService.setPolicy(patch);
    res.json({ success: true, policy: updated, message: "User access policy updated" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update specific user tier, quota, model override, or status
router.patch("/access/users/:telegramUserId", async (req: Request, res: Response) => {
  try {
    const telegramUserId = Number(req.params.telegramUserId);
    if (!telegramUserId || isNaN(telegramUserId)) {
      res.status(400).json({ error: "Invalid Telegram user ID" });
      return;
    }

    const { tier, dailyQuota, customModelOverride, status } = req.body || {};

    const updatedUser = await userTierService.updateUserAccess(telegramUserId, {
      tier: tier as UserTier | undefined,
      dailyQuota: typeof dailyQuota === "number" ? dailyQuota : undefined,
      customModelOverride: customModelOverride !== undefined ? customModelOverride : undefined,
      status: status as UserStatus | undefined,
    });

    if (!updatedUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      success: true,
      message: `User ${updatedUser.displayName} updated to ${updatedUser.tier.toUpperCase()} tier`,
      user: updatedUser,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to update user access");
    res.status(500).json({ error: err.message });
  }
});

// 5. Reset user daily quota
router.post("/access/users/:telegramUserId/reset-quota", async (req: Request, res: Response) => {
  try {
    const telegramUserId = Number(req.params.telegramUserId);
    if (!telegramUserId || isNaN(telegramUserId)) {
      res.status(400).json({ error: "Invalid Telegram user ID" });
      return;
    }

    await userTierService.resetUserQuota(telegramUserId);
    const users = await userTierService.listUsers();
    const updated = users.find((u) => u.telegramUserId === telegramUserId);

    res.json({
      success: true,
      message: "Daily quota reset to 0 requests today",
      user: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete single user and all associated records
router.delete("/access/users/:telegramUserId", async (req: Request, res: Response) => {
  try {
    const telegramUserId = Number(req.params.telegramUserId);
    if (!telegramUserId || isNaN(telegramUserId)) {
      res.status(400).json({ error: "Invalid Telegram user ID" });
      return;
    }

    await userTierService.deleteUser(telegramUserId);
    res.json({
      success: true,
      message: `User ${telegramUserId} and associated records deleted successfully`,
    });
  } catch (err: any) {
    logger.error({ error: err.message, telegramUserId: req.params.telegramUserId }, "Failed to delete user");
    res.status(500).json({ error: err.message });
  }
});

// 7. Cleanup mock test users (888111000, 1000001, 1000002)
router.post("/access/cleanup-mock-users", async (_req: Request, res: Response) => {
  try {
    const result = await userTierService.cleanupMockUsers();
    res.json({
      success: true,
      message: `Cleaned up ${result.count} mock user(s) from database`,
      deletedUserIds: result.deletedUserIds,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to clean up mock users");
    res.status(500).json({ error: err.message });
  }
});

// 8. Test Model Routing for a simulated user or tier
router.post("/access/test-route", async (req: Request, res: Response) => {
  try {
    const { userTier, customModelOverride, prompt, mode, isDeepReasoning } = req.body || {};
    const candidates = await adaptiveAIRouterService.candidates({
      userTier: (userTier || "free") as UserTier,
      userCustomModelOverride: customModelOverride || undefined,
      mode: mode || "general",
      isDeepReasoning: Boolean(isDeepReasoning),
    });

    const models = await unifiedModelRegistryService.list();
    const top = candidates[0];

    res.json({
      success: true,
      selectedModel: top?.model?.modelId || "None",
      selectedProvider: top?.model?.provider || "None",
      score: top?.score || 0,
      reasons: top?.reasons || [],
      candidates: candidates.slice(0, 5).map((c) => ({
        id: c.model.id,
        modelId: c.model.modelId,
        provider: c.model.provider,
        score: Math.round(c.score),
        reasons: c.reasons,
        latencyMs: Math.round(c.latencyMs),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
