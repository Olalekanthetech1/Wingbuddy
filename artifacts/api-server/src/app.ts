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
import { apiKeyPoolService } from "./services/api-key-pool.service";

const app: Express = express();
app.use(pinoHttp({ logger, serializers: { req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; }, res(res) { return { statusCode: res.statusCode }; } } }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let realTelegramRuntime: ReturnType<typeof createTelegramBot> | null = null;

export function initOrReloadTelegramBot(): ReturnType<typeof createTelegramBot> | null {
  try {
    if (process.env.TELEGRAM_BOT_TOKEN?.trim() && (process.env.GEMINI_API_KEY?.trim() || apiKeyPoolService.getSummary().totalKeys > 0)) {
      if (realTelegramRuntime) realTelegramRuntime.stop().catch(() => {});
      realTelegramRuntime = createTelegramBot();
      logger.info("Telegram bot runtime initialized/reloaded successfully");
      return realTelegramRuntime;
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Telegram bot deferred initialization: configure TELEGRAM_BOT_TOKEN and a managed Gemini API key");
  }
  return realTelegramRuntime;
}

initOrReloadTelegramBot();

export const telegramRuntime = {
  get bot() { return realTelegramRuntime?.bot; },
  async start() {
    if (!realTelegramRuntime) initOrReloadTelegramBot();
    if (realTelegramRuntime) await realTelegramRuntime.start();
    else logger.warn("Telegram bot token or managed Gemini API key not configured; waiting for runtime configuration");
  },
  async stop() { if (realTelegramRuntime) await realTelegramRuntime.stop(); },
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
  if (!realTelegramRuntime) initOrReloadTelegramBot();
  if (realTelegramRuntime) {
    try { telegramWorkerQueue.enqueue(update); }
    catch (err) { logger.error({ error: safeErrorMetadata(err), updateId: update.update_id }, "Failed to enqueue Telegram update"); }
  } else logger.warn({ updateId: update.update_id }, "Webhook received before Telegram runtime was initialized");
};
app.post("/api/telegram/webhook", handleTelegramWebhook);
app.post("/telegram/webhook", handleTelegramWebhook);

app.get("/api/telegram/queue-metrics", (_req: Request, res: Response) => {
  res.json({ status: "ok", workerQueue: telegramWorkerQueue.getMetrics() });
});

app.get("/api/dashboard/runtime", (_req: Request, res: Response) => {
  const split = (name: string): string[] => (process.env[name] || "").split(",").map((value) => value.trim()).filter(Boolean);
  const unique = (items: string[]): string[] => [...new Set(items)];
  const primaryModel = process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_DEFAULT_MODEL?.trim() || "";
  const modelPool = unique([primaryModel, ...split("GEMINI_MODEL_POOL"), ...split("GEMINI_MODEL_FALLBACKS")]);
  res.json({ controlPlane: "postgresql-authoritative", timestamp: new Date().toISOString(), primaryModel, modelPool, fastModel: process.env.GEMINI_MODEL_FAST?.trim() || "", reasoningModel: process.env.GEMINI_MODEL_REASONING?.trim() || "", extractionModel: process.env.GEMINI_MODEL_EXTRACTION?.trim() || "", fallbackModels: split("GEMINI_MODEL_FALLBACKS"), embeddingModel: process.env.GEMINI_EMBEDDING_MODEL?.trim() || "", webResearchProvider: process.env.TAVILY_API_KEY?.trim() ? "Tavily" : "", webResearchConfigured: Boolean(process.env.TAVILY_API_KEY?.trim()), executionEngineEnabled: String(process.env.EXECUTION_ENGINE_ENABLED ?? "").toLowerCase() === "true", telegramRuntimeActive: Boolean(realTelegramRuntime), keyPool: apiKeyPoolService.getSummary() });
});

app.get("/health", healthHandler);
app.use("/api", router);

const serveDashboard = (_req: Request, res: Response): void => {
  const html = renderDashboardHtml();
  const enhanced = html.replace("</body>", `${renderDashboardModelControls()}${renderDashboardControlPlane()}</body>`);
  res.type("html").send(enhanced);
};
app.get("/", serveDashboard);
app.get("/dashboard", serveDashboard);

export default app;
