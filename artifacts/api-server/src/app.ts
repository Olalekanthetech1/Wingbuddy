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
import { apiKeyPoolService } from "./services/api-key-pool.service";
import { aiProviderRegistryService } from "./services/ai-provider-registry.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { adaptiveAIRouterService } from "./services/adaptive-ai-router.service";
import { aiObservabilityService } from "./services/ai-observability.service";
import { proactiveAssistantService } from "./services/proactive-assistant.service";

const app: Express = express();
app.use(pinoHttp({ logger, serializers: { req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; }, res(res) { return { statusCode: res.statusCode }; } } }));
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
        await realTelegramRuntime.stop().catch(() => {});
      }
      realTelegramRuntime = createTelegramBot();
      proactiveAssistantService.attachBot(realTelegramRuntime.bot);
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
        // synchronous stop attempt; handled properly by async init
        realTelegramRuntime.stop().catch(() => {});
      }
      realTelegramRuntime = createTelegramBot();
      proactiveAssistantService.attachBot(realTelegramRuntime.bot);
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
    webResearchProvider: process.env.TAVILY_API_KEY?.trim() ? "Tavily" : "",
    webResearchConfigured: Boolean(process.env.TAVILY_API_KEY?.trim()),
    executionEngineEnabled: String(process.env.EXECUTION_ENGINE_ENABLED ?? "").toLowerCase() === "true",
    telegramRuntimeActive: Boolean(realTelegramRuntime),
    keyPool: apiKeyPoolService.getSummary(),
  });
});

app.get("/health", healthHandler);
app.use("/api", router);

const serveDashboard = (_req: Request, res: Response): void => {
  const html = renderDashboardHtml();
  const enhanced = html.replace("</body>", `${renderDashboardModelControls()}${renderDashboardControlPlane()}${renderDashboardBotSimulator()}${renderDashboardResponsiveLayer()}${renderDashboardAIRoutingControls()}${renderDashboardProviderKeyControls()}${renderDashboardProactiveAssistant()}${renderDashboardKnowledgeBase()}${renderDashboardMediaStorage()}${renderDashboardUserAccess()}${renderDashboardPersonas()}${renderDashboardThemeLayer()}</body>`);
  res.type("html").send(enhanced);
};

app.get("/", serveDashboard);
app.get("/dashboard", serveDashboard);

export default app;
