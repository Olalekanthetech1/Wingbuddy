import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { healthHandler } from "./routes/health";
import { logger } from "./lib/logger";
import { createTelegramBot } from "./telegram/bot";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let realTelegramRuntime: ReturnType<typeof createTelegramBot> | null = null;

try {
  realTelegramRuntime = createTelegramBot();
  realTelegramRuntime.mountWebhook(app);
} catch (error) {
  logger.warn(
    { error: error instanceof Error ? error.message : String(error) },
    "Telegram bot deferred initialization: configure TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in environment",
  );
}

const telegramRuntime = {
  get bot() {
    return realTelegramRuntime?.bot;
  },
  async start() {
    if (realTelegramRuntime) {
      await realTelegramRuntime.start();
    } else {
      logger.warn("Telegram bot token not configured. Waiting for TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in environment variables.");
    }
  },
  async stop() {
    if (realTelegramRuntime) {
      await realTelegramRuntime.stop();
    }
  },
  mountWebhook(expressApp: Express) {
    if (realTelegramRuntime) {
      realTelegramRuntime.mountWebhook(expressApp);
    }
  },
};

app.get("/health", healthHandler);
app.use("/api", router);

app.get("/", (_req, res) => {
  const hasBotToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasDbUrl = Boolean(process.env.DATABASE_URL?.trim());
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wingbuddy Telegram Assistant</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --border: #1f2937;
      --accent: #3b82f6;
      --green: #10b981;
      --amber: #f59e0b;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem 1rem;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 720px;
      width: 100%;
    }
    .header {
      margin-bottom: 2rem;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background-color: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      margin-bottom: 0.75rem;
    }
    h1 {
      font-size: 1.875rem;
      font-weight: 700;
      margin: 0 0 0.5rem 0;
    }
    p.subtitle {
      color: var(--text-muted);
      margin: 0;
      font-size: 1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-online { background-color: var(--green); }
    .status-pending { background-color: var(--amber); }
    .card-title {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .card-value {
      font-size: 1.125rem;
      font-weight: 600;
      display: flex;
      align-items: center;
    }
    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 1.5rem 0 0.75rem 0;
    }
    ul {
      margin: 0;
      padding-left: 1.25rem;
      color: var(--text-muted);
      line-height: 1.6;
    }
    code {
      background-color: #1f2937;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      color: #93c5fd;
    }
    .link-group {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .btn {
      display: inline-block;
      padding: 0.625rem 1.25rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      background-color: #2563eb;
      color: white;
      transition: background-color 0.2s;
    }
    .btn:hover { background-color: #1d4ed8; }
    .btn-secondary {
      background-color: #1f2937;
      color: var(--text);
    }
    .btn-secondary:hover { background-color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">AI Studio Service</span>
      <h1>Wingbuddy Telegram Assistant</h1>
      <p class="subtitle">A Telegram personal AI assistant backed by Google Gemini and persistent conversation memory.</p>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Server Status</div>
        <div class="card-value">
          <span class="status-dot status-online"></span> Port 3000 Active
        </div>
      </div>
      <div class="card">
        <div class="card-title">Telegram Bot</div>
        <div class="card-value">
          <span class="status-dot ${hasBotToken ? 'status-online' : 'status-pending'}"></span>
          ${hasBotToken ? (webhookUrl ? 'Webhook Mode' : 'Polling Active') : 'Token Pending'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Gemini Model</div>
        <div class="card-value">
          <span class="status-dot ${hasGeminiKey ? 'status-online' : 'status-pending'}"></span>
          ${model}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Database Connection</div>
        <div class="card-value">
          <span class="status-dot ${hasDbUrl ? 'status-online' : 'status-pending'}"></span>
          ${hasDbUrl ? 'PostgreSQL Configured' : 'DATABASE_URL Required'}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0;">Configuration & Setup</div>
      <p style="color:var(--text-muted);margin-bottom:1rem;font-size:0.9rem;">
        Add your credentials and configuration in the <strong>Settings</strong> panel or environment variables:
      </p>
      <ul>
        <li><code>TELEGRAM_BOT_TOKEN</code> — Telegram Bot token from @BotFather</li>
        <li><code>GEMINI_API_KEY</code> — Google Gemini API key</li>
        <li><code>DATABASE_URL</code> — PostgreSQL database connection string</li>
        <li><code>GEMINI_MODEL</code> — Optional model override (default: <code>gemini-3.6-flash</code>)</li>
      </ul>
      <div class="link-group">
        <a class="btn" href="/api/healthz" target="_blank">View /api/healthz</a>
        <a class="btn btn-secondary" href="/health" target="_blank">View /health</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

export default app;
export { telegramRuntime };
