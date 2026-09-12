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

    // Stripe & Coinbase Commerce
    if (payload.type === "checkout.session.completed" || payload.event?.type === "charge:confirmed") {
      const session = payload.data?.object || payload.event?.data;
      userIdStr = session?.client_reference_id || session?.metadata?.client_reference_id;
      amount = session?.amount_total || session?.pricing?.local?.amount || 0;
    }
    // Paystack & Flutterwave
    else if (payload.event === "charge.success" || payload.event === "charge.completed") {
      const reference = payload.data?.reference || payload.data?.tx_ref;
      if (reference && reference.startsWith("tg_")) {
        userIdStr = reference.split("_")[1];
      }
      amount = payload.data?.amount || 0;
    }
    // NOWPayments
    else if (payload.payment_status === "finished" || payload.payment_status === "waiting") {
      // NOWPayments sends the order_id which we can pass as the reference
      const orderId = payload.order_id || payload.order_description;
      if (orderId && orderId.startsWith("tg_")) {
        userIdStr = orderId.split("_")[1];
      }
      amount = payload.price_amount || 0;
    }

    if (userIdStr) {
      const userId = parseInt(userIdStr, 10);
      // We look at amount or metadata to determine the tier.
      // For simplicity, upgrade to VIP if amount is large, else PRO
      const targetTier = amount > 15000 ? "vip" : "pro";
      
      await userTierService.updateUserAccess(userId, { tier: targetTier, status: "active" });
      logger.info({ userId, targetTier }, "Upgraded user tier via external payment webhook");
      
      try {
        const tierName = targetTier === "vip" ? "👑 VIP Pass" : "⚡ PRO Pass";
        await telegramRuntime.bot?.api.sendMessage(userId, `🎉 <b>Payment Successful!</b>\n\nYour account has been upgraded to <b>${tierName}</b> with immediate effect.\n\nUse /persona to select unlocked specialist agents or /tier to view your renewed quotas!`, { parse_mode: "HTML" });
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
