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
import { apiKeyPoolService } from "./services/api-key-pool.service";
import { aiProviderRegistryService } from "./services/ai-provider-registry.service";
import { aiProviderKeyPoolService } from "./services/ai-provider-key-pool.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { adaptiveAIRouterService } from "./services/adaptive-ai-router.service";
import { aiObservabilityService } from "./services/ai-observability.service";
import { proactiveAssistantService } from "./services/proactive-assistant.service";
import { cronTaskService } from "./services/cron-task.service";
import { tavilyService } from "./services/tavily.service";

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

      // Check metadata for tier
      const metaTier = String(sessionMeta.tier || sessionMeta.plan || sessionMeta.targetTier || sessionMeta.tierName || "").toLowerCase();
      if (metaTier.includes("vip")) {
        explicitTier = "vip";
      } else if (metaTier.includes("pro")) {
        explicitTier = "pro";
      }

      // Check order description or overall payload text for VIP keywords
      if (!explicitTier) {
        const rawPayloadStr = JSON.stringify(payload).toLowerCase();
        if (
          rawPayloadStr.includes('"vip"') ||
          rawPayloadStr.includes("vip pass") ||
          rawPayloadStr.includes("vip tier") ||
          rawPayloadStr.includes("tier_upgrade_vip") ||
          rawPayloadStr.includes("vip_tier")
        ) {
          explicitTier = "vip";
        }
      }

      // Amount-based evaluation if not explicit
      let targetTier: "vip" | "pro" = explicitTier || "pro";
      if (!explicitTier) {
        const numAmount = Number(amount) || 0;
        // VIP prices: $24.99 (2499 cents or 24.99 USD) or NGN 15,000+
        // PRO prices: $9.99 (999 cents or 9.99 USD)
        if (numAmount >= 2000 && numAmount < 10000) {
          targetTier = "vip"; // Stripe cents for $20-$99.99
        } else if (numAmount >= 20 && numAmount < 500) {
          targetTier = "vip"; // USD units for $20-$499
        } else if (numAmount >= 15000) {
          targetTier = "vip"; // High-value fiat denominations (NGN, etc.)
        }
      }

      const updatedUser = await userTierService.updateUserAccess(userId, { tier: targetTier, status: "active" });
      logger.info({ userId, targetTier, updatedUser }, "Successfully applied user tier upgrade and renewed quota via payment webhook");
      
      try {
        const policy = await userTierService.getPolicy();
        const tierCfg = policy.tiers[targetTier];
        const tierName = targetTier === "vip" ? "👑 VIP Pass" : "⚡ PRO Pass";
        const videoLimit = tierCfg?.dailyVideoQuota ?? (targetTier === "vip" ? 10 : 3);
        const imageLimit = tierCfg?.dailyImageQuota ?? (targetTier === "vip" ? 60 : 20);

        const welcomeMessage = [
          `🎉 <b>Payment Confirmed! Welcome to ${tierName}!</b>`,
          "",
          `Your daily quotas and capabilities have been immediately activated:`,
          `• <b>Chat Messages:</b> ${tierCfg?.dailyQuota ?? 500}/day`,
          `• <b>Authentic Video Generation:</b> ${videoLimit}/day`,
          `• <b>High-Resolution Image Generation:</b> ${imageLimit}/day`,
          `• <b>Deep Reasoning & Research:</b> Unlocked ✨`,
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
    executionEngineEnabled: String(process.env.EXECUTION_ENGINE_ENABLED ?? "").toLowerCase() === "true",
    telegramRuntimeActive: Boolean(realTelegramRuntime),
    keyPool: apiKeyPoolService.getSummary(),
  });
});

app.get("/health", healthHandler);
app.use("/api", router);

const serveDashboard = (_req: Request, res: Response): void => {
  const html = renderDashboardHtml();
  const injected = `${renderDashboardModelControls()}${renderDashboardControlPlane()}${renderDashboardBotSimulator()}${renderDashboardResponsiveLayer()}${renderDashboardAIRoutingControls()}${renderDashboardProviderKeyControls()}${renderDashboardWebResearchControlPlane()}${renderDashboardProactiveAssistant()}${renderDashboardKnowledgeBase()}${renderDashboardMediaStorage()}${renderDashboardUserAccess()}${renderDashboardPersonas()}${renderDashboardExecutionVisualizer()}${renderDashboardThemeLayer()}</body>`;
  const enhanced = html.replace("</body>", () => injected);
  res.type("html").send(enhanced);
};

app.get("/favicon.ico", (_req: Request, res: Response) => {
  res.status(204).end();
});

app.get("/", serveDashboard);
app.get("/dashboard", serveDashboard);

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
