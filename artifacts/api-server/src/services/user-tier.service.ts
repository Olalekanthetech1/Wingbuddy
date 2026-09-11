import {
  db,
  usersTable,
  systemSettingsTable,
  conversationsTable,
  messagesTable,
  userMemoriesTable,
  agentTasksTable,
  agentTaskStepsTable,
  conversationSummariesTable,
  remindersTable,
  executionGraphsTable,
  graphRevisionsTable,
  executionSessionsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export type UserTier = "free" | "pro" | "vip";
export type UserStatus = "active" | "suspended" | "whitelisted";

export interface TierConfig {
  tier: UserTier;
  label: string;
  description: string;
  dailyQuota: number; // -1 or >= 999999 means unlimited
  preferredRole: string; // 'fast' | 'primary' | 'reasoning'
  priorityBonus: number;
  speed: string;
  targetModelClass: string;
  allowedFeatures: {
    webResearch: boolean;
    imageGen: boolean;
    videoGen: boolean;
    autonomousExecution: boolean;
    deepReasoning: boolean;
  };
  priceLabel?: string;
  upgradeDescription?: string;
  perks?: string[];
  checkoutUrl?: string;
  adminContactHandle?: string;
  upgradeEnabled?: boolean;
  buttonLabel?: string;
  paymentInstructions?: string;
}

export interface UserAccessPolicy {
  defaultTier: UserTier;
  whitelistOnly: boolean;
  tiers: Record<UserTier, TierConfig>;
  updatedAt: string;
  supportContact?: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  tier: UserTier;
  dailyQuota: number;
  requestsToday: number;
  remainingToday: number;
  status: UserStatus;
  customModelOverride: string | null;
  message?: string;
  warning?: string;
}

export interface TrackedUserSummary {
  id: number;
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  personality: string;
  mode: string;
  tier: UserTier;
  dailyQuota: number;
  requestsToday: number;
  remainingToday: number;
  totalRequests: number;
  customModelOverride: string | null;
  status: UserStatus;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
}

const POLICY_KEY = "user_tier_access_policy";

export const DEFAULT_TIER_CONFIGS: Record<UserTier, TierConfig> = {
  free: {
    tier: "free",
    label: "Free Tier",
    description: "Standard access routed to fast, cost-effective models with daily quota limits",
    dailyQuota: 30,
    preferredRole: "fast",
    priorityBonus: 0,
    speed: "Ultra-Fast (Budget optimized)",
    targetModelClass: "Lightweight & high-efficiency models (e.g., Qwen 27B, Ministral 3B, Gemini Flash)",
    allowedFeatures: {
      webResearch: true,
      imageGen: true,
      videoGen: false,
      autonomousExecution: false,
      deepReasoning: false,
    },
    priceLabel: "Free Forever",
    upgradeDescription: "Essential AI assistant tools with daily usage allowances.",
    perks: [
      "30 daily messages (auto-resets at midnight UTC)",
      "High-efficiency models (Ministral 3B, Gemini Flash)",
      "Standard response speed",
      "Basic personas & reminder tasks",
    ],
    upgradeEnabled: false,
    buttonLabel: "🌱 Current Plan",
  },
  pro: {
    tier: "pro",
    label: "Pro Tier",
    description: "Generous daily quotas with balanced high-speed intelligence and image generation",
    dailyQuota: 150,
    preferredRole: "primary",
    priorityBonus: 150,
    speed: "High Speed & Multimodal",
    targetModelClass: "Standard primary multimodal models (e.g., Gemini 3.8 Flash, Ministral 8B)",
    allowedFeatures: {
      webResearch: true,
      imageGen: true,
      videoGen: false,
      autonomousExecution: true,
      deepReasoning: true,
    },
    priceLabel: "$9.99 / month",
    upgradeDescription: "Elevate your productivity with high-capacity limits & expert agents.",
    perks: [
      "150 daily messages (5x Free allowance)",
      "Unlock Software Architect & Creative Storyteller personas",
      "Priority queue processing & zero throttling",
      "Extended context memory retention",
    ],
    checkoutUrl: "",
    adminContactHandle: "@admin",
    upgradeEnabled: true,
    buttonLabel: "⚡ Upgrade to PRO",
    paymentInstructions: "Contact admin or use invoice link for instant activation.",
  },
  vip: {
    tier: "vip",
    label: "VIP Tier",
    description: "Unlimited unthrottled requests routed to heavy-duty reasoning & video generation models",
    dailyQuota: -1, // Unlimited
    preferredRole: "reasoning",
    priorityBonus: 500,
    speed: "Maximum Deep Reasoning",
    targetModelClass: "Heavy-duty reasoning & frontier models (e.g., DeepSeek-R1, GPT-OSS 120B, Ministral 14B)",
    allowedFeatures: {
      webResearch: true,
      imageGen: true,
      videoGen: true,
      autonomousExecution: true,
      deepReasoning: true,
    },
    priceLabel: "$24.99 / month",
    upgradeDescription: "Unlimited power, deep reasoning models, and exclusive market intelligence.",
    perks: [
      "Unlimited daily requests (no quota limits)",
      "Exclusive access to Deep Researcher (DeepSeek R1 / Gemini Thinking)",
      "Crypto & Market Strategist algorithmic framing",
      "FLUX Ultra image & Wan hybrid video generation",
      "Dedicated highest-priority compute worker",
      "Direct VIP priority concierge support",
    ],
    checkoutUrl: "",
    adminContactHandle: "@admin",
    upgradeEnabled: true,
    buttonLabel: "👑 Upgrade to VIP Pass",
    paymentInstructions: "Contact admin or use invoice link for instant VIP VIP activation.",
  },
};

export const DEFAULT_ACCESS_POLICY: UserAccessPolicy = {
  defaultTier: "free",
  whitelistOnly: false,
  tiers: DEFAULT_TIER_CONFIGS,
  updatedAt: new Date().toISOString(),
  supportContact: "@WingbuddyAdmin",
};

function getUtcTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UserTierService {
  private policyCache: UserAccessPolicy | null = null;
  private policyCacheAt = 0;
  private readonly cacheTtlMs = 15_000;

  async getPolicy(): Promise<UserAccessPolicy> {
    if (this.policyCache && Date.now() - this.policyCacheAt < this.cacheTtlMs) {
      return this.policyCache;
    }
    try {
      const rows = await db
        .select({ value: systemSettingsTable.value })
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.key, POLICY_KEY))
        .limit(1);

      if (rows[0]?.value) {
        const parsed = JSON.parse(rows[0].value) as Partial<UserAccessPolicy>;
        const normalized: UserAccessPolicy = {
          defaultTier: parsed.defaultTier === "vip" || parsed.defaultTier === "pro" ? parsed.defaultTier : "free",
          whitelistOnly: Boolean(parsed.whitelistOnly),
          tiers: {
            free: { ...DEFAULT_TIER_CONFIGS.free, ...(parsed.tiers?.free || {}) },
            pro: { ...DEFAULT_TIER_CONFIGS.pro, ...(parsed.tiers?.pro || {}) },
            vip: { ...DEFAULT_TIER_CONFIGS.vip, ...(parsed.tiers?.vip || {}) },
          },
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
        this.policyCache = normalized;
        this.policyCacheAt = Date.now();
        return normalized;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed reading user access policy from database; using defaults");
    }

    this.policyCache = { ...DEFAULT_ACCESS_POLICY };
    this.policyCacheAt = Date.now();
    return this.policyCache;
  }

  async setPolicy(patch: Partial<UserAccessPolicy>): Promise<UserAccessPolicy> {
    const current = await this.getPolicy();
    const next: UserAccessPolicy = {
      defaultTier: patch.defaultTier || current.defaultTier,
      whitelistOnly: patch.whitelistOnly !== undefined ? patch.whitelistOnly : current.whitelistOnly,
      supportContact: patch.supportContact !== undefined ? patch.supportContact : current.supportContact,
      tiers: {
        free: { ...current.tiers.free, ...(patch.tiers?.free || {}) },
        pro: { ...current.tiers.pro, ...(patch.tiers?.pro || {}) },
        vip: { ...current.tiers.vip, ...(patch.tiers?.vip || {}) },
      },
      updatedAt: new Date().toISOString(),
    };

    await db
      .insert(systemSettingsTable)
      .values({ key: POLICY_KEY, value: JSON.stringify(next), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(next), updatedAt: new Date() },
      });

    this.policyCache = next;
    this.policyCacheAt = Date.now();
    return next;
  }

  async checkAndRecordUsage(
    telegramUserId: number,
    profile?: { username?: string; firstName?: string; lastName?: string }
  ): Promise<QuotaCheckResult> {
    const today = getUtcTodayDate();
    const policy = await this.getPolicy();

    // 1. Fetch user from PostgreSQL
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramUserId, telegramUserId))
      .limit(1);

    let user = existing[0];
    const defaultTier = policy.defaultTier || "free";
    const defaultQuota = policy.tiers[defaultTier]?.dailyQuota ?? 30;

    if (!user) {
      // Auto-register user with default tier
      const created = await db
        .insert(usersTable)
        .values({
          telegramUserId,
          username: profile?.username || null,
          firstName: profile?.firstName || null,
          lastName: profile?.lastName || null,
          tier: defaultTier,
          dailyQuota: defaultQuota,
          requestsToday: 1,
          lastRequestDate: today,
          totalRequests: 1,
          status: "active",
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      user = created[0];
      return {
        allowed: true,
        tier: defaultTier,
        dailyQuota: defaultQuota,
        requestsToday: 1,
        remainingToday: defaultQuota > 0 ? Math.max(0, defaultQuota - 1) : 999999,
        status: "active",
        customModelOverride: null,
      };
    }

    const currentTier = (user.tier === "vip" || user.tier === "pro" ? user.tier : "free") as UserTier;
    const tierConfig = policy.tiers[currentTier] || DEFAULT_TIER_CONFIGS[currentTier];
    const userStatus = (user.status || "active") as UserStatus;

    // 2. Check suspension
    if (userStatus === "suspended") {
      return {
        allowed: false,
        tier: currentTier,
        dailyQuota: user.dailyQuota,
        requestsToday: user.requestsToday,
        remainingToday: 0,
        status: "suspended",
        customModelOverride: user.customModelOverride,
        message: "⛔ Your account has been suspended. Please contact the administrator for assistance.",
      };
    }

    // 3. Check whitelist mode
    if (policy.whitelistOnly && currentTier !== "vip" && userStatus !== "whitelisted") {
      return {
        allowed: false,
        tier: currentTier,
        dailyQuota: user.dailyQuota,
        requestsToday: user.requestsToday,
        remainingToday: 0,
        status: userStatus,
        customModelOverride: user.customModelOverride,
        message: "🔒 The bot is currently in whitelist-only mode. Please request access from the administrator.",
      };
    }

    // 4. Daily quota calculations
    const isNewDay = user.lastRequestDate !== today;
    const requestsToday = isNewDay ? 1 : user.requestsToday + 1;
    const totalRequests = (user.totalRequests || 0) + 1;

    const effectiveDailyQuota =
      currentTier === "vip"
        ? -1
        : user.dailyQuota > 0
        ? user.dailyQuota
        : tierConfig.dailyQuota;

    const isUnlimited = currentTier === "vip" || effectiveDailyQuota < 0 || effectiveDailyQuota >= 999999;

    if (!isUnlimited && !isNewDay && user.requestsToday >= effectiveDailyQuota) {
      return {
        allowed: false,
        tier: currentTier,
        dailyQuota: effectiveDailyQuota,
        requestsToday: user.requestsToday,
        remainingToday: 0,
        status: userStatus,
        customModelOverride: user.customModelOverride,
        message: `⏳ You have reached your daily quota of ${effectiveDailyQuota} requests on the ${tierConfig.label}.\n\nYour quota automatically resets at midnight UTC. Reach out to an administrator for a VIP upgrade!`,
      };
    }

    // Update usage in DB
    await db
      .update(usersTable)
      .set({
        requestsToday,
        lastRequestDate: today,
        totalRequests,
        lastActiveAt: new Date(),
        updatedAt: new Date(),
        username: profile?.username ?? user.username,
        firstName: profile?.firstName ?? user.firstName,
        lastName: profile?.lastName ?? user.lastName,
      })
      .where(eq(usersTable.telegramUserId, telegramUserId));

    const remainingToday = isUnlimited ? 999999 : Math.max(0, effectiveDailyQuota - requestsToday);

    let warning: string | undefined;
    if (!isUnlimited && remainingToday <= 5 && remainingToday > 0) {
      warning = `⚠️ Notice: You have ${remainingToday} request${remainingToday === 1 ? "" : "s"} remaining in your daily quota.`;
    }

    return {
      allowed: true,
      tier: currentTier,
      dailyQuota: effectiveDailyQuota,
      requestsToday,
      remainingToday,
      status: userStatus,
      customModelOverride: user.customModelOverride,
      warning,
    };
  }

  async getUser(telegramUserId: number): Promise<{
    id: number;
    telegramUserId: number;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    tier: UserTier;
    status: UserStatus;
    dailyQuota: number;
    activePersonaId: string;
    personality: string;
    mode: string;
    customModelOverride: string | null;
  } | null> {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramUserId, telegramUserId))
      .limit(1);
    if (!rows.length) return null;
    const u = rows[0];
    const tier = (u.tier === "vip" || u.tier === "pro" ? u.tier : "free") as UserTier;
    return {
      id: u.id,
      telegramUserId: Number(u.telegramUserId),
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      tier,
      status: (u.status || "active") as UserStatus,
      dailyQuota: u.dailyQuota,
      activePersonaId: u.activePersonaId || "default_assistant",
      personality: u.personality || "playful",
      mode: u.mode || "general",
      customModelOverride: u.customModelOverride || null,
    };
  }

  async getUserTier(telegramUserId: number): Promise<UserTier> {
    const user = await this.getUser(telegramUserId);
    if (!user) {
      const policy = await this.getPolicy();
      return (policy.defaultTier || "free") as UserTier;
    }
    return user.tier;
  }

  async getUserTierProfile(telegramUserId: number): Promise<{
    tier: UserTier;
    config: TierConfig;
    status: UserStatus;
    customModelOverride: string | null;
  }> {
    const policy = await this.getPolicy();
    const user = await this.getUser(telegramUserId);
    const tier = (user?.tier || policy.defaultTier || "free") as UserTier;
    const config = policy.tiers[tier] || DEFAULT_TIER_CONFIGS[tier];
    return {
      tier,
      config,
      status: (user?.status || "active") as UserStatus,
      customModelOverride: user?.customModelOverride || null,
    };
  }

  async listUsers(): Promise<TrackedUserSummary[]> {
    const today = getUtcTodayDate();
    const policy = await this.getPolicy();
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(desc(usersTable.lastActiveAt));

    return users.map((u) => {
      const tier = (u.tier === "vip" || u.tier === "pro" ? u.tier : "free") as UserTier;
      const tierConfig = policy.tiers[tier] || DEFAULT_TIER_CONFIGS[tier];
      const isToday = u.lastRequestDate === today;
      const requestsToday = isToday ? u.requestsToday : 0;
      const isUnlimited = tier === "vip" || u.dailyQuota < 0 || u.dailyQuota >= 999999;
      const effectiveQuota = isUnlimited ? -1 : u.dailyQuota > 0 ? u.dailyQuota : tierConfig.dailyQuota;
      const remainingToday = isUnlimited ? 999999 : Math.max(0, effectiveQuota - requestsToday);

      const nameParts = [u.firstName, u.lastName].filter(Boolean);
      const displayName = nameParts.length ? nameParts.join(" ") : u.username ? `@${u.username}` : `User ${u.telegramUserId}`;

      return {
        id: u.id,
        telegramUserId: Number(u.telegramUserId),
        username: u.username,
        firstName: u.firstName,
        lastName: u.lastName,
        displayName,
        personality: u.personality || "playful",
        mode: u.mode || "general",
        tier,
        dailyQuota: effectiveQuota,
        requestsToday,
        remainingToday,
        totalRequests: u.totalRequests || 0,
        customModelOverride: u.customModelOverride || null,
        status: (u.status || "active") as UserStatus,
        lastActiveAt: (u.lastActiveAt || u.updatedAt).toISOString(),
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      };
    });
  }

  async updateUserAccess(
    telegramUserId: number,
    patch: {
      tier?: UserTier;
      dailyQuota?: number;
      customModelOverride?: string | null;
      status?: UserStatus;
    }
  ): Promise<TrackedUserSummary | null> {
    const policy = await this.getPolicy();
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (patch.tier !== undefined) {
      updateData.tier = patch.tier;
      // If user hasn't set custom daily quota, assign tier's default
      if (patch.dailyQuota === undefined) {
        updateData.dailyQuota = policy.tiers[patch.tier]?.dailyQuota ?? 30;
      }
    }
    if (patch.dailyQuota !== undefined) {
      updateData.dailyQuota = patch.dailyQuota;
    }
    if (patch.customModelOverride !== undefined) {
      updateData.customModelOverride = patch.customModelOverride ? patch.customModelOverride.trim() : null;
    }
    if (patch.status !== undefined) {
      updateData.status = patch.status;
    }

    await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.telegramUserId, telegramUserId));

    const updated = await this.listUsers();
    return updated.find((u) => u.telegramUserId === telegramUserId) || null;
  }

  async resetUserQuota(telegramUserId: number): Promise<void> {
    await db
      .update(usersTable)
      .set({
        requestsToday: 0,
        lastRequestDate: getUtcTodayDate(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.telegramUserId, telegramUserId));
  }

  async getSummaryStats(): Promise<{
    totalUsers: number;
    vipUsers: number;
    proUsers: number;
    freeUsers: number;
    activeToday: number;
    requestsTodayTotal: number;
    totalRequestsAllTime: number;
  }> {
    const users = await this.listUsers();
    const today = getUtcTodayDate();

    let vipUsers = 0;
    let proUsers = 0;
    let freeUsers = 0;
    let activeToday = 0;
    let requestsTodayTotal = 0;
    let totalRequestsAllTime = 0;

    for (const u of users) {
      if (u.tier === "vip") vipUsers++;
      else if (u.tier === "pro") proUsers++;
      else freeUsers++;

      if (u.lastActiveAt.startsWith(today) || u.requestsToday > 0) {
        activeToday++;
      }
      requestsTodayTotal += u.requestsToday;
      totalRequestsAllTime += u.totalRequests;
    }

    return {
      totalUsers: users.length,
      vipUsers,
      proUsers,
      freeUsers,
      activeToday,
      requestsTodayTotal,
      totalRequestsAllTime,
    };
  }

  async deleteUser(telegramUserId: number): Promise<boolean> {
    try {
      // 1. Delete messages and summaries for conversations
      const convs = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(eq(conversationsTable.telegramUserId, telegramUserId));

      for (const c of convs) {
        await db.delete(messagesTable).where(eq(messagesTable.conversationId, c.id));
        await db.delete(conversationSummariesTable).where(eq(conversationSummariesTable.conversationId, c.id));
      }
      await db.delete(conversationsTable).where(eq(conversationsTable.telegramUserId, telegramUserId));

      // 2. Delete tasks and steps
      const tasks = await db
        .select({ id: agentTasksTable.id })
        .from(agentTasksTable)
        .where(eq(agentTasksTable.telegramUserId, telegramUserId));
      for (const t of tasks) {
        await db.delete(agentTaskStepsTable).where(eq(agentTaskStepsTable.taskId, t.id));
      }
      await db.delete(agentTasksTable).where(eq(agentTasksTable.telegramUserId, telegramUserId));

      // 3. Delete memories
      await db.delete(userMemoriesTable).where(eq(userMemoriesTable.telegramUserId, telegramUserId));

      // 4. Delete reminders
      await db.delete(remindersTable).where(eq(remindersTable.telegramUserId, telegramUserId));

      // 5. Delete execution sessions / graphs
      await db.delete(executionSessionsTable).where(eq(executionSessionsTable.telegramUserId, telegramUserId));
      await db.delete(graphRevisionsTable).where(eq(graphRevisionsTable.telegramUserId, telegramUserId));
      await db.delete(executionGraphsTable).where(eq(executionGraphsTable.telegramUserId, telegramUserId));

      // 6. Delete user record
      await db.delete(usersTable).where(eq(usersTable.telegramUserId, telegramUserId));

      logger.info({ telegramUserId }, "Cleaned up and deleted user and all associated records from database");
      return true;
    } catch (err: any) {
      logger.error({ telegramUserId, error: err.message }, "Failed to delete user from database");
      throw err;
    }
  }

  async cleanupMockUsers(): Promise<{ deletedUserIds: number[]; count: number }> {
    const mockIds = [888111000, 1000001, 1000002];
    const deleted: number[] = [];
    for (const id of mockIds) {
      try {
        await this.deleteUser(id);
        deleted.push(id);
      } catch (err) {
        logger.warn({ id, error: String(err) }, "Failed deleting mock user during cleanup");
      }
    }
    return { deletedUserIds: deleted, count: deleted.length };
  }
}

export const userTierService = new UserTierService();
