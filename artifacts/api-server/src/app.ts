import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { healthHandler } from "./routes/health";
import { logger } from "./lib/logger";
import { createTelegramBot } from "./telegram/bot";
import { telegramWorkerQueue } from "./services/worker-queue.service";
import { safeErrorMetadata } from "./utils/safe-error";
import { renderDashboardHtml } from "./dashboard-ui";
import { renderDashboardModelControls } from "./dashboard-model-controls";
import { renderDashboardControlPlane } from "./dashboard-control-plane";
import { renderDashboardBotSimulator } from "./dashboard-bot-simulator";
import { renderDashboardResponsiveLayer } from "./dashboard-responsive";
import { renderDashboardThemeLayer } from "./dashboard-theme";
import { renderDashboardAIRoutingControls } from "./dashboard-ai-routing-controls";
import { renderDashboardProviderKeyControls } from "./dashboard-provider-key-controls";
import { renderDashboardProactiveAssistant } from "./dashboard-proactive-assistant";
import { renderDashboardMediaStorage } from "./dashboard-media-storage";
import { renderDashboardKnowledgeBase } from "./dashboard-knowledge-base";
import { renderDashboardUserAccess } from "./dashboard-user-access";
import { renderDashboardPersonas } from "./dashboard-personas";
import { renderDashboardWebResearchControlPlane } from "./dashboard-web-research-control-plane";
import { renderDashboardExecutionVisualizer } from "./dashboard-execution-visualizer";
import { renderDashboardDiagnostics } from "./dashboard-diagnostics";
import { renderDashboardReactionTheme } from "./dashboard-reaction-theme";
import { renderLandingPageHtml } from "./views/landing-page";
import { renderUserDashboardHtml } from "./views/user-dashboard";
import { apiKeyPoolService } from "./services/api-key-pool.service";
import { aiProviderRegistryService } from "./services/ai-provider-registry.service";
import { aiProviderKeyPoolService } from "./services/ai-provider-key-pool.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { adaptiveAIRouterService } from "./services/adaptive-ai-router.service";
import { aiObservabilityService } from "./services/ai-observability.service";
import { proactiveAssistantService } from "./services/proactive-assistant.service";
import { cronTaskService } from "./services/cron-task.service";
import { tavilyService } from "./services/tavily.service";
import { userTierService, type UserTier } from "./services/user-tier.service";
import { isExecutionEngineEnabled } from "./execution/config";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const app: Express = express();
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      err(err) {
        return safeErrorMetadata(err);
      },
    },
    customLogLevel(_req, res, err) {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customErrorMessage(req, res, err) {
      return `HTTP ${req.method} ${req.url?.split("?")[0]} errored (${res.statusCode}): ${err?.message || "error"}`;
    },
  })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let realTelegramRuntime: ReturnType<typeof createTelegramBot> | null = null;
let runtimeHydrationReady = false;

export function setRuntimeHydrationReady(ready: boolean): void { runtimeHydrationReady = ready; }
export function isRuntimeHydrationReady(): boolean { return runtimeHydrationReady; }

export async function initOrReloadTelegramBotAsync() {
  if (!runtimeHydrationReady) return realTelegramRuntime;
  try {
    if (process.env.TELEGRAM_BOT_TOKEN?.trim() && (process.env.GEMINI_API_KEY?.trim() || apiKeyPoolService.getSummary().totalKeys > 0)) {
      if (realTelegramRuntime) {
        proactiveAssistantService.detachBot(realTelegramRuntime.bot);
        cronTaskService.detachBot();
        cronTaskService.stopPolling();
        await realTelegramRuntime.stop().catch(() => {});
      }
      realTelegramRuntime = createTelegramBot();
      proactiveAssistantService.attachBot(realTelegramRuntime.bot);
      cronTaskService.attachBot(realTelegramRuntime.bot);
      cronTaskService.startPolling();
      await realTelegramRuntime.start();
      logger.info("Telegram bot runtime initialized/reloaded successfully");
      return realTelegramRuntime;
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Telegram bot deferred initialization failed");
  }
  return realTelegramRuntime;
}

export function initOrReloadTelegramBot(): ReturnType<typeof createTelegramBot> | null {
  if (!runtimeHydrationReady) return realTelegramRuntime;
  try {
    if (process.env.TELEGRAM_BOT_TOKEN?.trim() && (process.env.GEMINI_API_KEY?.trim() || apiKeyPoolService.getSummary().totalKeys > 0)) {
      if (realTelegramRuntime) {
        proactiveAssistantService.detachBot(realTelegramRuntime.bot);
        cronTaskService.detachBot();
        cronTaskService.stopPolling();
        // synchronous stop attempt; handled properly by async init
        realTelegramRuntime.stop().catch(() => {});
      }
      realTelegramRuntime = createTelegramBot();
      proactiveAssistantService.attachBot(realTelegramRuntime.bot);
      cronTaskService.attachBot(realTelegramRuntime.bot);
      cronTaskService.startPolling();
      logger.info("Telegram bot runtime initialized/reloaded successfully");
      return realTelegramRuntime;
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Telegram bot deferred initialization failed");
  }
  return realTelegramRuntime;
}

export const telegramRuntime = {
  get bot() { return realTelegramRuntime?.bot; },
  async start() {
    if (!runtimeHydrationReady) return;
    if (!realTelegramRuntime) initOrReloadTelegramBot();
    if (realTelegramRuntime) await realTelegramRuntime.start();
  },
  async stop() {
    if (realTelegramRuntime) {
      proactiveAssistantService.detachBot(realTelegramRuntime.bot);
      cronTaskService.detachBot();
      cronTaskService.stopPolling();
      await realTelegramRuntime.stop();
    }
  },
  initOrReload: initOrReloadTelegramBot,
};

const handleTelegramWebhook = (req: Request, res: Response): void => {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (webhookSecret && req.header("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
    logger.warn("Telegram webhook received update with invalid secret token");
    res.status(403).json({ error: "Unauthorized" });
    return;
  }
  const update = req.body;
  if (!update || typeof update !== "object" || typeof update.update_id !== "number") {
    res.status(400).json({ error: "Invalid Telegram update payload" });
    return;
  }
  res.status(200).json({ ok: true });
  try {
    telegramWorkerQueue.enqueue(update);
  } catch (err) {
    logger.error({ error: safeErrorMetadata(err), updateId: update.update_id }, "Failed to enqueue Telegram update");
  }
};
app.post("/api/telegram/webhook", handleTelegramWebhook);
app.post("/telegram/webhook", handleTelegramWebhook);
app.get("/api/telegram/queue-metrics", (_req: Request, res: Response) => res.json({ status: "ok", workerQueue: telegramWorkerQueue.getMetrics() }));

app.post("/api/payments/webhook", async (req: Request, res: Response) => {
  const payload = req.body;
  logger.info({ payload }, "Received external payment webhook");
  
  try {
    let userIdStr: string | undefined;
    let amount = 0;
    let explicitTier: "vip" | "pro" | undefined;
    let sessionMeta: Record<string, any> = {};

    // Stripe & Coinbase Commerce
    if (payload.type === "checkout.session.completed" || payload.event?.type === "charge:confirmed") {
      const session = payload.data?.object || payload.event?.data;
      userIdStr = session?.client_reference_id || session?.metadata?.client_reference_id || session?.metadata?.telegramUserId || session?.metadata?.userId || session?.metadata?.user_id;
      amount = session?.amount_total || session?.pricing?.local?.amount || 0;
      sessionMeta = session?.metadata || {};
    }
    // Paystack & Flutterwave
    else if (payload.event === "charge.success" || payload.event === "charge.completed") {
      const reference = payload.data?.reference || payload.data?.tx_ref;
      if (reference) {
        if (reference.startsWith("tg_")) {
          userIdStr = reference.split("_")[1];
        } else if (/^\d+$/.test(reference)) {
          userIdStr = reference;
        }
      }
      if (!userIdStr && payload.data?.metadata) {
        userIdStr = payload.data.metadata.telegramUserId || payload.data.metadata.userId || payload.data.metadata.client_reference_id;
      }
      amount = payload.data?.amount || 0;
      sessionMeta = payload.data?.metadata || {};
    }
    // NOWPayments
    else if (payload.payment_status === "finished" || payload.payment_status === "waiting") {
      const orderId = payload.order_id || payload.order_description;
      if (orderId) {
        if (orderId.startsWith("tg_")) {
          userIdStr = orderId.split("_")[1];
        } else if (/^\d+$/.test(orderId)) {
          userIdStr = orderId;
        }
      }
      amount = payload.price_amount || 0;
      sessionMeta = { description: payload.order_description, orderId: payload.order_id };
    }

    // Direct payload fallbacks
    if (!userIdStr) {
      userIdStr = payload.telegramUserId || payload.userId || payload.user_id || payload.client_reference_id;
    }

    if (userIdStr) {
      // Strip any "tg_" prefix if still present
      const cleanUserIdStr = String(userIdStr).replace(/^tg_/, "").split("_")[0];
      const userId = parseInt(cleanUserIdStr, 10);

      if (isNaN(userId) || userId <= 0) {
        logger.warn({ userIdStr, cleanUserIdStr }, "Invalid Telegram userId extracted from payment webhook");
        res.json({ received: true, error: "invalid_user_id" });
        return;
      }

      // Fetch authoritative user access policy and existing subscription state directly from PostgreSQL
      const [policy, existingUser] = await Promise.all([
        userTierService.getPolicy(),
        userTierService.getUser(userId),
      ]);

      let targetTier: UserTier | undefined;

      // 1. Check metadata explicitly provided by the payment gateway or checkout session
      const metaTier = String(sessionMeta.tier || sessionMeta.plan || sessionMeta.targetTier || sessionMeta.tierName || "").toLowerCase().trim();
      if (metaTier === "vip" || metaTier === "pro") {
        targetTier = metaTier;
      }

      // 2. Check if checkout session reference or order description matches database-configured checkout URLs
      if (!targetTier) {
        const orderRef = String(sessionMeta.orderId || sessionMeta.description || "").toLowerCase();
        for (const [tierKey, config] of Object.entries(policy.tiers) as [UserTier, (typeof policy.tiers)[UserTier]][]) {
          if (tierKey === "free") continue;
          if (config.checkoutUrl && orderRef && orderRef.includes(config.checkoutUrl.toLowerCase())) {
            targetTier = tierKey;
            break;
          }
          if (config.cryptoCheckoutUrl && orderRef && orderRef.includes(config.cryptoCheckoutUrl.toLowerCase())) {
            targetTier = tierKey;
            break;
          }
        }
      }

      // 3. Match payment amount dynamically against live database policy tier pricing (stars or priceLabel)
      if (!targetTier && amount > 0) {
        const numAmount = Number(amount);
        for (const [tierKey, config] of Object.entries(policy.tiers) as [UserTier, (typeof policy.tiers)[UserTier]][]) {
          if (tierKey === "free") continue;

          // Match configured stars amount in database policy
          if (config.starsAmount && config.starsAmount > 0 && numAmount === config.starsAmount) {
            targetTier = tierKey;
            break;
          }

          // Match numeric price in database policy priceLabel (e.g., "$9.99 / month" -> 9.99 or 999 cents)
          if (config.priceLabel) {
            const priceMatch = config.priceLabel.match(/(\d+(?:\.\d+)?)/);
            if (priceMatch) {
              const parsedPrice = parseFloat(priceMatch[1]);
              const centsPrice = Math.round(parsedPrice * 100);
              if (numAmount === parsedPrice || numAmount === centsPrice) {
                targetTier = tierKey;
                break;
              }
            }
          }
        }
      }

      // 4. Resolve against actual user subscription state in the database
      // If the user already has an active paid subscription tier in the database, treat incoming payment as a renewal/quota recharge
      if (!targetTier && existingUser?.tier && (existingUser.tier === "vip" || existingUser.tier === "pro")) {
        targetTier = existingUser.tier;
      }

      // 5. Enforce Zero-Fallback: do not simulate an arbitrary tier if cannot be authoritatively resolved
      if (!targetTier) {
        if (policy.defaultTier && policy.defaultTier !== "free") {
          targetTier = policy.defaultTier;
        } else {
          logger.warn(
            { userId, sessionMeta, amount, existingUserTier: existingUser?.tier },
            "Unable to dynamically resolve payment tier from database policy or user subscription state; rejecting simulated tier assignment"
          );
          res.json({ received: true, error: "unresolved_payment_tier" });
          return;
        }
      }

      const updatedUser = await userTierService.updateUserAccess(userId, { tier: targetTier, status: "active" });
      logger.info({ userId, targetTier, updatedUser }, "Successfully applied user tier upgrade and renewed quota via payment webhook");
      
      try {
        const tierCfg = policy.tiers[targetTier];
        const tierName = tierCfg?.label || (targetTier === "vip" ? "VIP Pass" : "PRO Pass");
        const chatQuota = tierCfg?.dailyQuota !== undefined && tierCfg.dailyQuota >= 0
          ? `${tierCfg.dailyQuota}/day`
          : "Unlimited";
        const videoLimit = tierCfg?.dailyVideoQuota !== undefined && tierCfg.dailyVideoQuota >= 0
          ? `${tierCfg.dailyVideoQuota}/day`
          : (tierCfg?.allowedFeatures?.videoGen ? "Active" : "Disabled");
        const imageLimit = tierCfg?.dailyImageQuota !== undefined && tierCfg.dailyImageQuota >= 0
          ? `${tierCfg.dailyImageQuota}/day`
          : (tierCfg?.allowedFeatures?.imageGen ? "Active" : "Disabled");
        const deepReasoningStatus = tierCfg?.allowedFeatures?.deepReasoning ? "Unlocked ✨" : "Standard";

        const welcomeMessage = [
          `🎉 <b>Payment Confirmed! Welcome to ${escapeHtml(tierName)}!</b>`,
          "",
          `Your daily quotas and capabilities have been immediately activated:`,
          `• <b>Chat Messages:</b> ${chatQuota}`,
          `• <b>Authentic Video Generation:</b> ${videoLimit}`,
          `• <b>High-Resolution Image Generation:</b> ${imageLimit}`,
          `• <b>Deep Reasoning & Research:</b> ${deepReasoningStatus}`,
          "",
          `Try /video or /image now to test your new capabilities, or /tier to view your renewed quota balance!`,
        ].join("\n");

        await telegramRuntime.bot?.api.sendMessage(userId, welcomeMessage, { parse_mode: "HTML" });
      } catch (e) {
        logger.warn({ error: safeErrorMetadata(e) }, "Failed to send confirmation message to user after webhook");
      }
    }
  } catch (err) {
    logger.error({ error: safeErrorMetadata(err) }, "Failed processing payment webhook");
  }
  
  res.json({ received: true });
});

app.get("/api/dashboard/runtime", async (_req: Request, res: Response) => {
  const [models, providers, routingPolicy, routingHealth] = await Promise.all([
    unifiedModelRegistryService.list(),
    aiProviderRegistryService.list(),
    adaptiveAIRouterService.getPolicy(),
    adaptiveAIRouterService.healthSnapshot(),
  ]);
  await aiObservabilityService.initialize();
  const primary = models.find((m) => m.enabled && (m.roles.includes("primary") || m.roles.includes("primary_chat")));
  const embedding = models.find((m) => m.enabled && m.roles.includes("primary_embedding"))
    || models.find((m) => m.enabled && (m.roles.includes("embedding") || m.capabilities.includes("embedding") || m.modelId.toLowerCase().includes("embed")));
  const fast = models.find((m) => m.enabled && m.roles.includes("fast"));
  const reasoning = models.find((m) => m.enabled && m.roles.includes("reasoning"));
  const extraction = models.find((m) => m.enabled && m.roles.includes("extraction"));
  const modelPool = models.filter((m) => m.enabled && !m.capabilities.includes("embedding")).map((m) => m.modelId);

  res.json({
    controlPlane: "postgresql-authoritative",
    timestamp: new Date().toISOString(),
    runtimeHydrationReady,
    providers,
    primaryModel: primary?.modelId || "",
    primaryProvider: primary?.provider || "",
    primaryModelId: primary?.id || "",
    embeddingModel: embedding?.modelId || "",
    embeddingProvider: embedding?.provider || "",
    embeddingModelId: embedding?.id || "",
    fastModel: fast?.modelId || "",
    reasoningModel: reasoning?.modelId || "",
    extractionModel: extraction?.modelId || "",
    modelPool,
    modelRegistryCount: models.length,
    models,
    routingPolicy,
    routingHealth,
    observability: aiObservabilityService.snapshot(),
    webResearchProvider: tavilyService.isConfigured() ? "Tavily" : (process.env.TAVILY_API_KEY?.trim() ? "Tavily" : ""),
    webResearchConfigured: tavilyService.isConfigured(),
    executionEngineEnabled: isExecutionEngineEnabled(),
    telegramRuntimeActive: Boolean(realTelegramRuntime),
    cronSchedulerActive: cronTaskService.isPollingActive(),
    keyPool: apiKeyPoolService.getSummary(),
  });
});

app.get("/health", healthHandler);
app.use("/api", router);

const serveDashboard = (_req: Request, res: Response): void => {
  const html = renderDashboardHtml();
  const injected = `${renderDashboardModelControls()}${renderDashboardControlPlane()}${renderDashboardBotSimulator()}${renderDashboardResponsiveLayer()}${renderDashboardAIRoutingControls()}${renderDashboardProviderKeyControls()}${renderDashboardWebResearchControlPlane()}${renderDashboardProactiveAssistant()}${renderDashboardKnowledgeBase()}${renderDashboardMediaStorage()}${renderDashboardUserAccess()}${renderDashboardPersonas()}${renderDashboardExecutionVisualizer()}${renderDashboardDiagnostics()}${renderDashboardReactionTheme()}${renderDashboardThemeLayer()}</body>`;
  const enhanced = html.replace("</body>", () => injected);
  res.type("html").send(enhanced);
};

const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
  <defs>
    <radialGradient id="bg-glow" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#121829"/>
      <stop offset="60%" stop-color="#080b14"/>
      <stop offset="100%" stop-color="#04050a"/>
    </radialGradient>
    <linearGradient id="glass-body" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="30%" stop-color="#818cf8" stop-opacity="0.2"/>
      <stop offset="70%" stop-color="#c084fc" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="neon-glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur1"/>
      <feGaussianBlur stdDeviation="20" result="blur2"/>
      <feMerge>
        <feMergeNode in="blur2"/>
        <feMergeNode in="blur1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="neon-glow-purple" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="12" result="blur1"/>
      <feGaussianBlur stdDeviation="24" result="blur2"/>
      <feMerge>
        <feMergeNode in="blur2"/>
        <feMergeNode in="blur1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="circuit-cyan" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00f2ff"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
    <linearGradient id="circuit-purple" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e879f9"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg-glow)"/>
  <rect width="1020" height="1024" x="2" y="0" rx="223" fill="none" stroke="#1e293b" stroke-width="3" stroke-opacity="0.5"/>
  <g transform="translate(0, 10)">
    <path d="M 112 184 C 200 230 310 320 370 480 C 310 420 200 320 112 260 C 95 230 100 200 112 184 Z" fill="url(#glass-body)" stroke="#38bdf8" stroke-width="2.5" stroke-opacity="0.8"/>
    <path d="M 105 260 C 190 290 290 370 340 520 C 280 460 180 370 105 320 C 92 295 95 275 105 260 Z" fill="url(#glass-body)" stroke="#818cf8" stroke-width="2" stroke-opacity="0.7"/>
    <path d="M 120 336 C 200 355 280 420 320 560 C 265 500 180 430 120 380 C 110 360 112 345 120 336 Z" fill="url(#glass-body)" stroke="#c084fc" stroke-width="2" stroke-opacity="0.7"/>
    <path d="M 148 408 C 215 420 275 470 305 590 C 255 540 190 480 148 440 C 140 422 142 412 148 408 Z" fill="url(#glass-body)" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.6"/>
    <path d="M 180 472 C 235 480 275 515 295 610 C 255 570 205 520 180 495 C 175 482 176 475 180 472 Z" fill="url(#glass-body)" stroke="#818cf8" stroke-width="1.5" stroke-opacity="0.6"/>
    <path d="M 912 184 C 824 230 714 320 654 480 C 714 420 824 320 912 260 C 929 230 924 200 912 184 Z" fill="url(#glass-body)" stroke="#38bdf8" stroke-width="2.5" stroke-opacity="0.8"/>
    <path d="M 919 260 C 834 290 734 370 684 520 C 744 460 844 370 919 320 C 932 295 929 275 919 260 Z" fill="url(#glass-body)" stroke="#818cf8" stroke-width="2" stroke-opacity="0.7"/>
    <path d="M 904 336 C 824 355 744 420 704 560 C 759 500 844 430 904 380 C 914 360 912 345 904 336 Z" fill="url(#glass-body)" stroke="#c084fc" stroke-width="2" stroke-opacity="0.7"/>
    <path d="M 876 408 C 809 420 749 470 719 590 C 769 540 834 480 876 440 C 884 422 882 412 876 408 Z" fill="url(#glass-body)" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.6"/>
    <path d="M 844 472 C 789 480 749 515 729 610 C 769 570 819 520 844 495 C 849 482 848 475 844 472 Z" fill="url(#glass-body)" stroke="#818cf8" stroke-width="1.5" stroke-opacity="0.6"/>
    <path d="M 330 310 L 410 720 C 420 755 450 765 475 735 L 512 680 L 549 735 C 574 765 604 755 614 720 L 694 310 C 700 295 685 285 665 295 L 590 340 L 535 590 L 512 520 L 489 590 L 434 340 L 359 295 C 339 285 324 295 330 310 Z" 
          fill="url(#glass-body)" stroke="#00f2ff" stroke-width="3" stroke-opacity="0.9" filter="url(#neon-glow-cyan)"/>
    <path d="M 370 330 L 425 680 L 500 580" fill="none" stroke="url(#circuit-cyan)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#neon-glow-cyan)"/>
    <circle cx="370" cy="330" r="8" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <circle cx="500" cy="580" r="7" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <path d="M 400 370 L 440 640 L 490 580" fill="none" stroke="url(#circuit-purple)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#neon-glow-purple)"/>
    <circle cx="400" cy="370" r="7" fill="#e879f9" filter="url(#neon-glow-purple)"/>
    <path d="M 654 330 L 599 680 L 524 580" fill="none" stroke="url(#circuit-cyan)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#neon-glow-cyan)"/>
    <circle cx="654" cy="330" r="8" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <circle cx="524" cy="580" r="7" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <path d="M 624 370 L 584 640 L 534 580" fill="none" stroke="url(#circuit-purple)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#neon-glow-purple)"/>
    <circle cx="624" cy="370" r="7" fill="#e879f9" filter="url(#neon-glow-purple)"/>
    <path d="M 512 320 L 512 500" fill="none" stroke="url(#circuit-cyan)" stroke-width="6" stroke-linecap="round" filter="url(#neon-glow-cyan)"/>
    <circle cx="512" cy="320" r="9" fill="#ffffff" filter="url(#neon-glow-cyan)"/>
    <circle cx="512" cy="500" r="8" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <path d="M 140 220 C 220 270 300 350 350 480" fill="none" stroke="url(#circuit-cyan)" stroke-width="4" stroke-linecap="round" filter="url(#neon-glow-cyan)"/>
    <circle cx="140" cy="220" r="6" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <path d="M 130 290 C 200 320 280 390 325 510" fill="none" stroke="url(#circuit-purple)" stroke-width="3.5" stroke-linecap="round" filter="url(#neon-glow-purple)"/>
    <circle cx="130" cy="290" r="5" fill="#e879f9" filter="url(#neon-glow-purple)"/>
    <path d="M 884 220 C 804 270 724 350 674 480" fill="none" stroke="url(#circuit-cyan)" stroke-width="4" stroke-linecap="round" filter="url(#neon-glow-cyan)"/>
    <circle cx="884" cy="220" r="6" fill="#00f2ff" filter="url(#neon-glow-cyan)"/>
    <path d="M 894 290 C 824 320 744 390 699 510" fill="none" stroke="url(#circuit-purple)" stroke-width="3.5" stroke-linecap="round" filter="url(#neon-glow-purple)"/>
    <circle cx="894" cy="290" r="5" fill="#e879f9" filter="url(#neon-glow-purple)"/>
  </g>
</svg>`;

const sendAppIcon = (_req: Request, res: Response): void => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(APP_ICON_SVG);
};

app.get("/favicon.ico", sendAppIcon);
app.get("/favicon.svg", sendAppIcon);
app.get("/app-icon.svg", sendAppIcon);
app.get("/apple-touch-icon.png", sendAppIcon);
app.get("/pwa-192x192.png", sendAppIcon);
app.get("/pwa-512x512.png", sendAppIcon);
app.get("/pwa-maskable-512x512.png", sendAppIcon);

const PWA_MANIFEST = {
  id: "/",
  name: "Wingbuddy AI Workspace",
  short_name: "Wingbuddy",
  description: "Autonomous AI assistant with real-time web research, dual-device Telegram sync, and long-term memory vault.",
  start_url: "/app",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#0b0f19",
  theme_color: "#0b0f19",
  icons: [
    {
      src: "/pwa-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any"
    },
    {
      src: "/pwa-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any"
    },
    {
      src: "/pwa-maskable-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    },
    {
      src: "/app-icon.svg",
      sizes: "512x512",
      type: "image/svg+xml",
      purpose: "any"
    }
  ]
};

app.get(["/manifest.json", "/manifest.webmanifest"], (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(PWA_MANIFEST);
});

const SERVICE_WORKER_SCRIPT = `
const CACHE_NAME = 'wingbuddy-pwa-v2';
const PRECACHE_ASSETS = [
  '/',
  '/app',
  '/manifest.json',
  '/app-icon.svg',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
`;

app.get("/sw.js", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache");
  res.send(SERVICE_WORKER_SCRIPT);
});

// Public Landing Page (Auto-redirects logged-in users to /app unless explicitly requesting ?logout=1)
app.get("/", (req: Request, res: Response) => {
  const cookieHeader = req.headers.cookie || "";
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)wb_session_token=([^;]+)/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
  const isExplicitLogout = req.query.logout === "1";

  if (token && !isExplicitLogout) {
    return res.redirect("/app");
  }
  res.type("html").send(renderLandingPageHtml());
});

// User Web Workspace Application
app.get("/app", (_req: Request, res: Response) => {
  res.type("html").send(renderUserDashboardHtml());
});

// Dedicated Admin Control Center
app.get("/admin", serveDashboard);
app.get("/dashboard", (_req: Request, res: Response) => {
  res.redirect("/admin");
});

// 404 handler
app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  } else {
    res.status(404).type("text/plain").send("Not Found");
  }
});

// Global Express error handler
app.use((err: any, req: Request, res: Response, _next: express.NextFunction) => {
  logger.error({ error: safeErrorMetadata(err), method: req.method, path: req.path }, "Express request error");
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  }
});

export default app;
