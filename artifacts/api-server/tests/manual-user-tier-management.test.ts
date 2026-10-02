import { describe, it, expect, beforeEach } from "vitest";
import { userTierService } from "../src/services/user-tier.service";

describe("Manual User Tier Upgrade/Downgrade Administrative Tool", () => {
  const testUserId = 987654321;

  beforeEach(async () => {
    // Clean up test user if present
    await userTierService.deleteUser(testUserId).catch(() => {});
  });

  it("manually triggers a tier upgrade to PRO with quota relief", async () => {
    const policy = await userTierService.getPolicy();
    expect(policy).toBeDefined();

    const updatedUser = await userTierService.updateUserAccess(testUserId, {
      tier: "pro",
    });

    expect(updatedUser).not.toBeNull();
    expect(updatedUser?.telegramUserId).toBe(testUserId);
    expect(updatedUser?.tier).toBe("pro");
    expect(updatedUser?.dailyQuota).toBe(policy.tiers.pro?.dailyQuota ?? 150);
  });

  it("manually triggers a tier upgrade to VIP with unlimited quota policy rules", async () => {
    const policy = await userTierService.getPolicy();

    const updatedUser = await userTierService.updateUserAccess(testUserId, {
      tier: "vip",
    });

    expect(updatedUser).not.toBeNull();
    expect(updatedUser?.telegramUserId).toBe(testUserId);
    expect(updatedUser?.tier).toBe("vip");
    expect(updatedUser?.dailyQuota).toBe(-1);
  });

  it("manually triggers a tier downgrade to FREE with standard policy rules", async () => {
    // First upgrade to PRO
    await userTierService.updateUserAccess(testUserId, { tier: "pro" });

    // Downgrade back to FREE
    const policy = await userTierService.getPolicy();
    const downgradedUser = await userTierService.updateUserAccess(testUserId, {
      tier: "free",
    });

    expect(downgradedUser).not.toBeNull();
    expect(downgradedUser?.telegramUserId).toBe(testUserId);
    expect(downgradedUser?.tier).toBe("free");
    expect(downgradedUser?.dailyQuota).toBe(policy.tiers.free?.dailyQuota ?? 30);
  });
});
