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
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wingbuddy AI — Multi-Key & Engine Console</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-sub: #1f293d;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --border: #1e293b;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --green: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 1.5rem 1rem 4rem 1rem;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 960px;
      width: 100%;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background-color: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      margin-bottom: 0.5rem;
    }
    .live-indicator {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.9); }
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin: 0 0 0.35rem 0;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      color: var(--text-muted);
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.4;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 0.85rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      position: relative;
    }
    .card-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .card-value {
      font-size: 1.15rem;
      font-weight: 600;
      display: flex;
      align-items: center;
    }
    .card-subtext {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.5rem;
      flex-shrink: 0;
    }
    .status-healthy { background-color: var(--green); box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); }
    .status-cooldown { background-color: var(--amber); box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
    .status-disabled { background-color: var(--text-muted); }
    .status-invalid { background-color: var(--red); }

    .section-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 0 0 0.75rem 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pill-tag {
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.2rem 0.6rem;
      border-radius: 0.375rem;
      background: #1f2937;
      color: #93c5fd;
    }

    /* Key Pool & General Tables */
    .table-container {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border-radius: 0.5rem;
      margin-top: 0.75rem;
    }
    .table-container::-webkit-scrollbar {
      height: 6px;
    }
    .table-container::-webkit-scrollbar-track {
      background: #0f172a;
    }
    .table-container::-webkit-scrollbar-thumb {
      background: #334155;
      border-radius: 3px;
    }
    .data-table {
      width: 100%;
      min-width: 650px;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .data-table th {
      text-align: left;
      padding: 0.6rem 0.75rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    .data-table td {
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .key-name {
      font-weight: 600;
      color: var(--text);
    }
    .code-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      background: #1e293b;
      padding: 0.15rem 0.45rem;
      border-radius: 0.25rem;
      color: #93c5fa;
      word-break: break-all;
    }

    .selector-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: rgba(30, 41, 59, 0.5);
      border-radius: 0.5rem;
      margin-bottom: 1rem;
      font-size: 0.85rem;
      flex-wrap: wrap;
    }
    .selector-btn {
      padding: 0.35rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.8rem;
      font-weight: 500;
      border: 1px solid var(--border);
      background: #111827;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }
    .selector-btn:hover {
      border-color: var(--accent);
      color: var(--text);
    }
    .selector-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }

    /* Forms */
    .form-row {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    @media (max-width: 640px) {
      .form-row { grid-template-columns: 1fr; }
    }
    .input {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.6rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.85rem;
      outline: none;
      max-width: 100%;
    }
    .input:focus { border-color: var(--accent); }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.6rem 1rem;
      border-radius: 0.375rem;
      font-size: 0.85rem;
      font-weight: 500;
      border: none;
      cursor: pointer;
      background-color: var(--accent);
      color: white;
      transition: background-color 0.15s;
      white-space: nowrap;
    }
    .btn:hover { background-color: var(--accent-hover); }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
    .btn-success { background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; }
    .btn-success:hover { background: rgba(16, 185, 129, 0.35); }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
    }
    .btn-outline:hover { background: #1e293b; color: var(--text); }
    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.3); }

    /* Chat Playground */
    .chat-box {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .chat-response {
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
      min-height: 70px;
      font-size: 0.9rem;
      line-height: 1.5;
      white-space: pre-wrap;
      color: #e2e8f0;
      word-break: break-word;
    }
    .prompt-pills {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-top: 0.5rem;
    }
    .prompt-pill {
      font-size: 0.75rem;
      background: #1e293b;
      color: #94a3b8;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .prompt-pill:hover { border-color: var(--accent); color: white; }

    #alertBox {
      display: none;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
      font-size: 0.85rem;
    }
    .alert-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .alert-error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .flex-between { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }

    /* Comprehensive Mobile Responsiveness */
    @media (max-width: 768px) {
      body {
        padding: 0.75rem 0.5rem 3rem 0.5rem;
      }
      .header {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
      }
      .header > div:last-child {
        text-align: left !important;
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border);
      }
      h1 {
        font-size: 1.4rem;
      }
      p.subtitle {
        font-size: 0.85rem;
      }
      .grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 0.6rem;
      }
      .card {
        padding: 0.9rem;
        border-radius: 0.6rem;
      }
      .card-value {
        font-size: 1rem;
      }
      .section-title {
        flex-wrap: wrap;
        gap: 0.5rem;
        font-size: 0.95rem;
      }
      .selector-bar {
        padding: 0.5rem;
        gap: 0.4rem;
      }
      .selector-btn {
        flex: 1 1 auto;
        padding: 0.4rem 0.6rem;
        font-size: 0.75rem;
        text-align: center;
      }
      .form-row {
        grid-template-columns: 1fr;
        gap: 0.5rem;
      }

      /* Clean Responsive Horizontal Tables */
      .table-container {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        background: #0f172a;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .data-table {
        width: 100%;
        min-width: 620px;
        border-collapse: collapse;
      }
      .data-table th, .data-table td {
        white-space: nowrap;
      }
    }

    @media (max-width: 480px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .card-title {
        font-size: 0.72rem;
      }
      .card-value {
        font-size: 0.95rem;
      }
      .pill-tag {
        font-size: 0.7rem;
        padding: 0.15rem 0.45rem;
      }
    }

    /* Execution Engine Custom Styles */
    .toggle-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      background: #0b1329;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      border: 1px solid var(--border);
    }
    .toggle-switch {
      position: relative;
      width: 44px;
      height: 24px;
      background-color: #374151;
      border-radius: 9999px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .toggle-switch.active {
      background-color: var(--green);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch.active .toggle-knob {
      transform: translateX(20px);
    }
    .node-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.45rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .node-badge-completed { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .node-badge-executing { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); animation: pulse 1.5s infinite; }
    .node-badge-pending { background: #1e293b; color: #94a3b8; }
    .node-badge-waiting { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .node-badge-failed { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    
    .arch-card {
      background: #0b1329;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.75rem;
      font-size: 0.8rem;
    }
    .arch-card-title {
      font-weight: 700;
      color: #93c5fd;
      margin-bottom: 0.25rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <span class="badge"><span class="live-indicator"></span> Autonomous Multi-Engine & Multi-Key Console</span>
        <h1>Wingbuddy Telegram Assistant</h1>
        <p class="subtitle">Autonomous AI Assistant with multi-step DAG execution graphs, distributed fenced leases, pgvector memory, and multi-key failover pool.</p>
      </div>
      <div style="text-align: right;">
        <span id="uptimeBadge" class="pill-tag">Connecting...</span>
        <div id="pingBadge" style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">Ping: --ms</div>
      </div>
    </div>

    <div id="alertBox"></div>

    <!-- Status 5-Grid with Live Execution Engine Status -->
    <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
      <div class="card">
        <div class="card-title">⚡ Autonomous Engine</div>
        <div class="card-value" id="execEngineGridValue">
          <span class="status-dot status-healthy" id="execEngineDot"></span> <span id="execEngineText">ENABLED (ON)</span>
        </div>
        <div class="card-subtext" id="execEngineSubtext">DAG Graph Planner Active</div>
      </div>

      <div class="card">
        <div class="card-title">🔑 Gemini Key Pool</div>
        <div class="card-value" id="keyPoolValue">
          <span class="status-dot status-healthy"></span> <span id="healthyKeyCount">--</span> Active Keys
        </div>
        <div class="card-subtext" id="rotationModeText">Mode: Round-Robin</div>
      </div>

      <div class="card">
        <div class="card-title">🤖 Telegram Bot</div>
        <div class="card-value" id="botStatusValue">
          <span class="status-dot status-healthy"></span> Active
        </div>
        <div class="card-subtext" id="botSubtext">Polling updates</div>
      </div>

      <div class="card">
        <div class="card-title">🧠 AI Model</div>
        <div class="card-value" id="modelValue">
          <span class="status-dot status-healthy"></span> <span id="modelName">gemini-2.5-flash</span>
        </div>
        <div class="card-subtext" id="engineSubtext">Failover & Search Ready</div>
      </div>

      <div class="card">
        <div class="card-title">💾 PostgreSQL & Vector</div>
        <div class="card-value" id="dbStatusValue">
          <span class="status-dot status-healthy"></span> <span id="vectorStatusBadge">pgvector</span>
        </div>
        <div class="card-subtext" id="dbSubtext">Adaptive Pool Active</div>
      </div>
    </div>

    <!-- 0. Autonomous Execution Engine Master Control Card -->
    <div class="card" style="margin-bottom: 1.5rem; background: linear-gradient(180deg, #111e3b 0%, #111827 100%); border-color: #3b82f6;">
      <div class="flex-between" style="border-bottom: 1px solid #1e293b; padding-bottom: 0.85rem; margin-bottom: 1rem;">
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #93c5fd; font-weight: 600;">
            ⚡ Autonomous Execution Engine (V1)
          </div>
          <div style="font-size: 1.25rem; font-weight: 700; color: #ffffff; margin-top: 0.2rem; display: flex; align-items: center; gap: 0.6rem;">
            <span>Autonomous Graph Orchestrator</span>
            <span id="execEnginePillBadge" class="pill-tag" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);">
              ● ACTIVE (ON)
            </span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <div class="toggle-wrapper" onclick="toggleExecutionEngineState()" style="cursor: pointer;">
            <span style="font-size: 0.8rem; font-weight: 600; color: #e2e8f0;">Engine Switch:</span>
            <div id="masterToggleSwitch" class="toggle-switch active">
              <div class="toggle-knob"></div>
            </div>
            <span id="masterToggleLabel" style="font-size: 0.75rem; font-weight: 700; color: #34d399;">ON</span>
          </div>
          <button class="btn btn-sm btn-outline" onclick="loadExecutionData()">🔄 Refresh Sessions</button>
        </div>
      </div>

      <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0 0 1rem 0;">
        When <b>ENABLED</b>, multi-step user prompts are compiled into topological DAG execution graphs, persisted in PostgreSQL, locked via distributed fenced leases, independently verified across tools, and aggregated without requiring manual user progression.
      </p>

      <!-- Engine Telemetry & Limits Row -->
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-bottom: 1rem; gap: 0.5rem;">
        <div style="background: #0b1329; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Max Concurrency</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #93c5fd; margin-top: 0.2rem;" id="execMaxConcurrency">10 workers</div>
        </div>
        <div style="background: #0b1329; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Per-User Max</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #93c5fd; margin-top: 0.2rem;" id="execMaxPerUser">3 concurrent</div>
        </div>
        <div style="background: #0b1329; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Lease TTL</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #93c5fd; margin-top: 0.2rem;" id="execLeaseTtl">30s fenced</div>
        </div>
        <div style="background: #0b1329; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Active Leases</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #34d399; margin-top: 0.2rem;" id="execActiveLeases">0 active</div>
        </div>
        <div style="background: #0b1329; padding: 0.65rem 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border);">
          <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Total Executions</div>
          <div style="font-size: 1.05rem; font-weight: 700; color: #f59e0b; margin-top: 0.2rem;" id="execTotalCount">0 runs</div>
        </div>
      </div>

      <!-- Live Execution Sessions Table -->
      <div style="margin-top: 1rem;">
        <div class="flex-between" style="margin-bottom: 0.4rem;">
          <span style="font-size: 0.85rem; font-weight: 600; color: #e2e8f0;">📊 Recent Autonomous Execution Sessions</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);" id="execSessionsSummary">Loading sessions...</span>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Execution ID / Graph</th>
                <th>Revision</th>
                <th>Status</th>
                <th>Nodes Breakdown</th>
                <th>Updated</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="execSessionsTableBody">
              <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading autonomous execution sessions...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Authoritative Tool Registry Table (Collapsible) -->
      <div style="margin-top: 1.25rem; padding-top: 0.85rem; border-top: 1px solid #1e293b;">
        <div class="flex-between" style="cursor: pointer;" onclick="toggleToolRegistryView()">
          <span style="font-size: 0.85rem; font-weight: 600; color: #93c5fd;">
            🛡️ Authoritative Tool Registry & Execution Policies (<span id="toolRegistryCount">0</span> Tools)
          </span>
          <button class="btn btn-sm btn-outline" id="btnToggleTools">View Registry ▼</button>
        </div>

        <div id="toolRegistryContainer" style="display: none; margin-top: 0.75rem;">
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Tool Name</th>
                  <th>Execution Policy</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody id="toolsTableBody">
                <tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1rem;">Loading tool registry...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 7 Architectural Pillars of Wingbuddy / Lekzy Fx Pro Assistant -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="flex-between" style="cursor: pointer;" onclick="toggleArchPillarsView()">
        <div style="font-size: 0.95rem; font-weight: 600; color: #ffffff; display: flex; align-items: center; gap: 0.4rem;">
          <span>🏛️ Wingbuddy & Lekzy Fx Pro Core Architecture (7 Pillars)</span>
          <span class="pill-tag" style="background: #1e293b; color: #93c5fd;">System Overview</span>
        </div>
        <button class="btn btn-sm btn-outline" id="btnToggleArch">Expand Details ▼</button>
      </div>

      <div id="archPillarsContainer" style="display: none; margin-top: 1rem;">
        <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0 0 0.85rem 0;">
          The assistant is engineered with a strict 7-pillar architecture designed for zero travel-booking hallucinations, isolated Telegram user states, and deterministic graph execution:
        </p>

        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.65rem;">
          <div class="arch-card">
            <div class="arch-card-title">1. Telegram Gateway</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Long-polling & Webhook runtime with multi-user isolation, markdown parsing, and proactive message broadcasting.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">2. Context & Intent Engine</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Lekzy Fx Pro trading & multi-topic AI domain routing. Recalls user facts via 768-dim pgvector semantic embeddings.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">3. DAG Planner & Compiler</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Compiles multi-step requests into directed acyclic graphs with explicit dependencies and deterministic topological order.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">4. PostgreSQL State Store</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Drizzle ORM backend for immutable graph revisions, execution logs, reminder queues, and CDC subscriptions.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">5. Distributed Fenced Leases</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Row-level locking with TTL fencing tokens to prevent split-brain worker races and ensure idempotency.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">6. Authoritative Tool Policies</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Strict permission tiers: Autonomous Read, Guarded Mutation, and Checkpoint Approval for destructive operations.</div>
          </div>
          <div class="arch-card">
            <div class="arch-card-title">7. Independent Aggregator</div>
            <div style="color: var(--text-muted); line-height: 1.4;">Node outputs are independently verified and synthesized into a cohesive final outcome without monolithic LLM hallucination.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Telegram User Context Switcher -->
    <div class="card" style="margin-bottom: 1.5rem; background: linear-gradient(180deg, #111e38 0%, #111827 100%); border-color: #2563eb;">
      <div class="flex-between" style="flex-wrap: wrap; gap: 0.75rem;">
        <div>
          <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#93c5fd; font-weight:600;">
            👤 Target Telegram User Context (Isolated Data)
          </div>
          <div style="font-size:1.1rem; font-weight:700; color:#ffffff; margin-top:0.2rem;" id="selectedUserHeadline">
            Loading active users...
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <select id="userSelectDropdown" class="input" style="font-weight:600; background:#0b1329; border-color:#3b82f6;" onchange="onUserSelectionChange(this.value)">
            <option value="">Loading users...</option>
          </select>
          <input type="number" id="customUserIdInput" class="input" style="width:160px; background:#0b1329; border-color:#3b82f6;" placeholder="Custom User ID..." />
          <button class="btn btn-sm btn-outline" onclick="applyCustomUserId()">Target ID</button>
          <button class="btn btn-sm btn-outline" onclick="loadUsers()">🔄 Refresh</button>
        </div>
      </div>
      <div style="font-size:0.75rem; color:#94a3b8; margin-top:0.6rem; border-top:1px solid #1e293b; padding-top:0.5rem;">
        🔒 <b>Per-User Data Isolation:</b> Changing personality, mode, reminders, or memories below strictly applies only to this selected Telegram user account.
      </div>
    </div>

    <!-- 1. Multi-Key Manager Card -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>🔑 Multi-Key Pool Manager (Key 1, Key 2, Key 3...)</span>
        <button class="btn btn-sm btn-outline" onclick="loadKeys()">🔄 Refresh Pool</button>
      </div>

      <!-- Mode Selector -->
      <div class="selector-bar">
        <span style="font-weight:600;color:var(--text);">Rotation Strategy:</span>
        <button id="btnRoundRobin" class="selector-btn active" onclick="setRotationMode('round_robin')">
          🔄 Round-Robin (Balance Load)
        </button>
        <button id="btnFailover" class="selector-btn" onclick="setRotationMode('failover')">
          🛡️ Automatic Failover (Key 1 → Key 2 → Key 3)
        </button>
        <span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);" id="failoverTip">
          Auto-switches key if rate-limited (429)
        </span>
      </div>

      <!-- Keys Table -->
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Key / Label</th>
              <th>Token Preview</th>
              <th>Status</th>
              <th>Requests</th>
              <th>Latency</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody id="keysTableBody">
            <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading API keys...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Add New Key Form -->
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border);">
        <div style="font-size:0.875rem;font-weight:600;margin-bottom:0.4rem;">➕ Add API Key to Pool</div>
        <div class="form-row">
          <input type="text" id="newKeyName" class="input" placeholder="Label (e.g. Key 2, Backup)" />
          <input type="password" id="newKeyValue" class="input" placeholder="Paste Gemini API Key (AIzaSy...)" />
          <button id="btnAddKey" class="btn" onclick="addKey()">
            <span>Test & Add Key</span>
          </button>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;">
          ✨ Every added key is verified against Google Gemini before being activated in the pool.
        </div>
      </div>
    </div>

    <!-- 1.5. Adaptive Environment Variables & Secrets Configurator Card -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>⚙️ Adaptive Environment Variables & Secrets Configurator</span>
        <button class="btn btn-sm btn-outline" onclick="loadEnvVars()">🔄 Refresh Secrets</button>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.75rem 0;">
        Manage runtime credentials, API tokens, webhooks, database connection strings, and server flags live.
      </p>

      <!-- Category Filter Bar -->
      <div class="selector-bar" style="margin-bottom:1rem;">
        <span style="font-weight:600;color:var(--text);">Category:</span>
        <button id="envFilterAll" class="selector-btn active" onclick="filterEnvCategory('all')">All</button>
        <button id="envFilterCore" class="selector-btn" onclick="filterEnvCategory('core')">🔑 Core Credentials</button>
        <button id="envFilterWebhook" class="selector-btn" onclick="filterEnvCategory('webhook')">🌐 Webhooks</button>
        <button id="envFilterAccess" class="selector-btn" onclick="filterEnvCategory('access')">⚙️ Access & Models</button>
        <button id="envFilterPerformance" class="selector-btn" onclick="filterEnvCategory('performance')">🚀 Server & Perf</button>
        <button id="envFilterCustom" class="selector-btn" onclick="filterEnvCategory('custom')">✨ Custom Vars</button>
      </div>

      <!-- Env Vars Table -->
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Variable Name</th>
              <th>Category</th>
              <th>Status</th>
              <th style="min-width: 220px;">Value / Secret Token</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody id="envTableBody">
            <tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading environment variables...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Add Custom Variable Form -->
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border);">
        <div style="font-size:0.875rem;font-weight:600;margin-bottom:0.4rem;">➕ Add Custom Environment Variable</div>
        <div class="form-row">
          <input type="text" id="newEnvKey" class="input" placeholder="Variable Key (e.g. CUSTOM_SERVICE_KEY)" />
          <input type="password" id="newEnvVal" class="input" placeholder="Value / Secret Token" />
          <button class="btn" onclick="addCustomEnvVar()">Save Variable</button>
        </div>
      </div>
    </div>

    <!-- 2. AI Personality & Mode Configurator Card -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>🎭 AI Personality & Operating Mode Configurator</span>
        <span class="pill-tag" id="activePersonaBadge">Active: Playful / General</span>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.75rem 0;">
        Configure how the bot speaks and reasons across chats. Switches take effect instantly with automatic L1 cache invalidation:
      </p>

      <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Personality Tone:</div>
      <div class="selector-bar" style="margin-bottom:0.75rem;" id="personalityButtons">
        <button class="selector-btn" onclick="setPersonality('playful')">🎭 Playful</button>
        <button class="selector-btn" onclick="setPersonality('concise')">⚡ Concise</button>
        <button class="selector-btn" onclick="setPersonality('analytical')">🔬 Analytical</button>
        <button class="selector-btn" onclick="setPersonality('empathetic')">💖 Empathetic</button>
        <button class="selector-btn" onclick="setPersonality('creative')">🎨 Creative</button>
        <button class="selector-btn" onclick="setPersonality('professional')">💼 Professional</button>
      </div>

      <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Operating Mode:</div>
      <div class="selector-bar" style="margin-bottom:0;" id="modeButtons">
        <button class="selector-btn" onclick="setMode('general')">🌐 General Assistant</button>
        <button class="selector-btn" onclick="setMode('coder')">💻 Coder / Engineer</button>
        <button class="selector-btn" onclick="setMode('research')">🔍 Deep Research</button>
        <button class="selector-btn" onclick="setMode('brainstorm')">💡 Brainstorming</button>
      </div>
    </div>

    <!-- 3. Proactive Reminders Live Manager -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>⏰ Proactive Reminders & Scheduled Alerts</span>
        <button class="btn btn-sm btn-outline" onclick="loadReminders()">🔄 Refresh Queue</button>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.75rem 0;">
        Real-time scheduled alerts with CDC (Change Data Capture) synchronization. Cancel or snooze items live:
      </p>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Reminder / Prompt</th>
              <th>Due Time</th>
              <th>Status</th>
              <th>Snoozes</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody id="remindersTableBody">
            <tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading scheduled reminders...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Quick Schedule Reminder Form -->
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border);">
        <div style="font-size:0.875rem;font-weight:600;margin-bottom:0.4rem;">➕ Schedule New Reminder</div>
        <div class="form-row">
          <input type="text" id="newReminderPrompt" class="input" placeholder="Prompt (e.g. Call team meeting, review pull request)" />
          <input type="number" id="newReminderMinutes" class="input" placeholder="Minutes from now (e.g. 15, 60)" />
          <button class="btn" onclick="addReminder()">Schedule</button>
        </div>
      </div>
    </div>

    <!-- 4. Long-Term Semantic Memories (pgvector) Hub -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>🧠 Long-Term Memory Hub & Semantic Knowledge (pgvector)</span>
        <button class="btn btn-sm btn-outline" onclick="loadMemories()">🔄 Refresh</button>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.75rem 0;">
        Episodic user memories stored with 768-dimensional Gemini vector embeddings for semantic recall:
      </p>

      <!-- Search Bar -->
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
        <input type="text" id="memorySearchInput" class="input" style="flex:1;" placeholder="Search semantic facts or keywords..." onkeydown="if(event.key==='Enter') searchMemories()" />
        <button class="btn btn-outline" onclick="searchMemories()">Search</button>
        <button class="btn btn-outline" onclick="document.getElementById('memorySearchInput').value=''; loadMemories();">Clear</button>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Key / Subject</th>
              <th>Category</th>
              <th>Memory Fact Content</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody id="memoriesTableBody">
            <tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Loading long-term memories...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Add Memory Form -->
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border);">
        <div style="font-size:0.875rem;font-weight:600;margin-bottom:0.4rem;">➕ Add Long-Term Memory Fact</div>
        <div class="form-row">
          <input type="text" id="newMemoryKey" class="input" placeholder="Key (e.g. preferred_stack, project_goal)" />
          <input type="text" id="newMemoryContent" class="input" placeholder="Fact / Instruction Content" />
          <button class="btn" onclick="addMemory()">Store Memory</button>
        </div>
      </div>
    </div>

    <!-- 5. Adaptive Telemetry & System Insights -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>⚡ Adaptive Engine Telemetry & Self-Tuning Systems</span>
        <button class="btn btn-sm btn-outline" onclick="flushCache()">🔄 Flush L1 Cache</button>
      </div>
      <div class="grid" style="margin-bottom:0.5rem;">
        <div style="background:#0b1120;padding:0.75rem;border-radius:0.5rem;border:1px solid var(--border);">
          <div style="font-size:0.75rem;color:var(--text-muted);">CPU & SYSTEM CONCURRENCY</div>
          <div style="font-size:1rem;font-weight:600;margin-top:0.2rem;" id="telemetryCpu">-- Cores</div>
        </div>
        <div style="background:#0b1120;padding:0.75rem;border-radius:0.5rem;border:1px solid var(--border);">
          <div style="font-size:0.75rem;color:var(--text-muted);">HEAP MEMORY PRESSURE</div>
          <div style="font-size:1rem;font-weight:600;margin-top:0.2rem;" id="telemetryHeap">-- MB</div>
        </div>
        <div style="background:#0b1120;padding:0.75rem;border-radius:0.5rem;border:1px solid var(--border);">
          <div style="font-size:0.75rem;color:var(--text-muted);">DYNAMIC POOL CONNECTIONS</div>
          <div style="font-size:1rem;font-weight:600;margin-top:0.2rem;" id="telemetryPool">-- max</div>
        </div>
        <div style="background:#0b1120;padding:0.75rem;border-radius:0.5rem;border:1px solid var(--border);">
          <div style="font-size:0.75rem;color:var(--text-muted);">ADAPTIVE L1 CACHE TTL</div>
          <div style="font-size:1rem;font-weight:600;margin-top:0.2rem;" id="telemetryTtl">Dynamic (5s-300s)</div>
        </div>
      </div>
    </div>

    <!-- 6. Interactive Bot Simulator -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-title">
        <span>💬 Interactive Bot Simulator (Test Multi-Key Execution)</span>
        <span class="pill-tag">Live Testing</span>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 0.75rem 0;">
        Send a test prompt to verify key rotation, pgvector memory recall, and response generation in real time:
      </p>

      <div class="prompt-pills">
        <span class="prompt-pill" onclick="setPrompt('What is my preferred programming language and project architecture?')">🧠 Recall Stored Memory</span>
        <span class="prompt-pill" onclick="setPrompt('Explain how Gemini 2.5 Flash processes tokens in 2 sentences.')">⚡ Flash Processing</span>
        <span class="prompt-pill" onclick="setPrompt('Remind me in 30 minutes to review project roadmap')">⏰ Natural Reminder</span>
        <span class="prompt-pill" onclick="setPrompt('Write a quick TypeScript snippet for cosine similarity')">💻 Coder Prompt</span>
      </div>

      <div class="chat-box">
        <div style="display:flex;gap:0.5rem;">
          <input type="text" id="chatInput" class="input" style="flex:1;" placeholder="Type your message or prompt..." onkeydown="if(event.key==='Enter') sendTestChat()" />
          <button id="btnSendChat" class="btn" onclick="sendTestChat()">Send</button>
        </div>
        <div id="chatResponse" class="chat-response">Ready. Enter a message above to test key execution...</div>
      </div>
    </div>
  </div>

  <script>
    let currentRotationMode = 'round_robin';
    let currentPersonality = 'playful';
    let currentMode = 'general';
    let currentSelectedUserId = '';
    let cachedUsersList = [];
    let isExecutionEngineActive = true;
    let cachedExecutionSessions = [];

    function showAlert(msg, isError = false) {
      const box = document.getElementById('alertBox');
      box.textContent = msg;
      box.className = isError ? 'alert-error' : 'alert-success';
      box.style.display = 'block';
      setTimeout(() => { box.style.display = 'none'; }, 5000);
    }

    // Toggle Collapsible Sections
    function toggleToolRegistryView() {
      const container = document.getElementById('toolRegistryContainer');
      const btn = document.getElementById('btnToggleTools');
      if (container.style.display === 'none' || !container.style.display) {
        container.style.display = 'block';
        btn.textContent = 'Hide Registry ▲';
      } else {
        container.style.display = 'none';
        btn.textContent = 'View Registry ▼';
      }
    }

    function toggleArchPillarsView() {
      const container = document.getElementById('archPillarsContainer');
      const btn = document.getElementById('btnToggleArch');
      if (container.style.display === 'none' || !container.style.display) {
        container.style.display = 'block';
        btn.textContent = 'Collapse Details ▲';
      } else {
        container.style.display = 'none';
        btn.textContent = 'Expand Details ▼';
      }
    }

    // Execution Engine Data & Toggle Operations
    async function loadExecutionData() {
      try {
        const [healthRes, sessionsRes] = await Promise.all([
          fetch('/api/execution/health'),
          fetch('/api/execution/sessions?limit=15')
        ]);

        if (healthRes.ok) {
          const healthData = await healthRes.json();
          const auto = healthData.autonomousExecution || {};
          const cfg = auto.config || {};
          const metrics = auto.metrics || {};
          const tools = auto.tools || [];

          isExecutionEngineActive = Boolean(auto.enabled);
          updateExecutionToggleUI(isExecutionEngineActive);

          document.getElementById('execMaxConcurrency').textContent = (cfg.maxConcurrency || 10) + ' workers';
          document.getElementById('execMaxPerUser').textContent = (cfg.maxPerUser || 3) + ' concurrent';
          document.getElementById('execLeaseTtl').textContent = Math.round((cfg.leaseDurationMs || 30000) / 1000) + 's fenced';
          document.getElementById('execActiveLeases').textContent = (metrics.activeLeasesCount || 0) + ' active';
          document.getElementById('execTotalCount').textContent = (metrics.totalExecutionsStarted || 0) + ' runs';

          document.getElementById('toolRegistryCount').textContent = tools.length;
          renderToolsTable(tools);
        }

        if (sessionsRes.ok) {
          const sessData = await sessionsRes.json();
          cachedExecutionSessions = sessData.sessions || [];
          renderExecutionSessions(cachedExecutionSessions);
        }
      } catch (err) {
        console.error('Failed to load execution engine data', err);
      }
    }

    function updateExecutionToggleUI(enabled) {
      const toggleSwitch = document.getElementById('masterToggleSwitch');
      const toggleLabel = document.getElementById('masterToggleLabel');
      const pillBadge = document.getElementById('execEnginePillBadge');
      const gridDot = document.getElementById('execEngineDot');
      const gridText = document.getElementById('execEngineText');
      const gridSubtext = document.getElementById('execEngineSubtext');

      if (enabled) {
        toggleSwitch.className = 'toggle-switch active';
        toggleLabel.textContent = 'ON';
        toggleLabel.style.color = '#34d399';
        pillBadge.textContent = '● ACTIVE (ON)';
        pillBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        pillBadge.style.color = '#34d399';
        pillBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';

        gridDot.className = 'status-dot status-healthy';
        gridText.textContent = 'ENABLED (ON)';
        gridSubtext.textContent = 'DAG Graph Planner Active';
      } else {
        toggleSwitch.className = 'toggle-switch';
        toggleLabel.textContent = 'OFF';
        toggleLabel.style.color = '#9ca3af';
        pillBadge.textContent = '⏸️ DISABLED (OFF)';
        pillBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        pillBadge.style.color = '#f87171';
        pillBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';

        gridDot.className = 'status-dot status-cooldown';
        gridText.textContent = 'DISABLED (OFF)';
        gridSubtext.textContent = 'Conversational Pass-through';
      }
    }

    async function toggleExecutionEngineState() {
      try {
        const res = await fetch('/api/execution/toggle', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          isExecutionEngineActive = Boolean(data.enabled);
          updateExecutionToggleUI(isExecutionEngineActive);
          showAlert(data.message || 'Execution engine state updated');
          loadExecutionData();
          loadStats();
        } else {
          showAlert('Failed to toggle execution engine: ' + (data.error || 'Server error'), true);
        }
      } catch (err) {
        showAlert('Network error while toggling execution engine', true);
      }
    }

    function renderExecutionSessions(sessions) {
      const tbody = document.getElementById('execSessionsTableBody');
      const summary = document.getElementById('execSessionsSummary');

      if (!sessions || sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No recent autonomous executions recorded yet. Execute a task to view DAG nodes!</td></tr>';
        summary.textContent = '0 total sessions recorded';
        return;
      }

      summary.textContent = sessions.length + ' active/recent session(s)';

      tbody.innerHTML = sessions.map(s => {
        let statusBadge = '';
        if (s.status === 'completed') {
          statusBadge = '<span class="node-badge node-badge-completed">✅ COMPLETED</span>';
        } else if (s.status === 'executing') {
          statusBadge = '<span class="node-badge node-badge-executing">⚡ EXECUTING</span>';
        } else if (s.status === 'paused_for_approval') {
          statusBadge = '<span class="node-badge node-badge-waiting">⚠️ WAITING APPROVAL</span>';
        } else if (s.status === 'failed') {
          statusBadge = '<span class="node-badge node-badge-failed">❌ FAILED</span>';
        } else if (s.status === 'cancelled') {
          statusBadge = '<span class="node-badge node-badge-pending">⏸️ CANCELLED</span>';
        } else {
          statusBadge = '<span class="node-badge node-badge-pending">' + escapeHtml(s.status.toUpperCase()) + '</span>';
        }

        const completedNodes = (s.completedNodes || []).map(n => '<span class="node-badge node-badge-completed">' + escapeHtml(n) + '</span>').join(' ');
        const currentNodes = (s.currentNodes || []).map(n => '<span class="node-badge node-badge-executing">' + escapeHtml(n) + '</span>').join(' ');
        const waitingNodes = (s.waitingApprovalNodes || []).map(n => '<span class="node-badge node-badge-waiting">' + escapeHtml(n) + '</span>').join(' ');
        const failedNodes = (s.failedNodes || []).map(n => '<span class="node-badge node-badge-failed">' + escapeHtml(n) + '</span>').join(' ');

        const nodeBreakdown = [completedNodes, currentNodes, waitingNodes, failedNodes].filter(Boolean).join(' ') || '<span style="color:var(--text-muted);font-size:0.75rem;">None</span>';

        const updatedTime = new Date(s.updatedAt || s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        let actions = '';
        if (s.status === 'paused_for_approval' && (s.waitingApprovalNodes || []).length > 0) {
          const waitingNodeId = s.waitingApprovalNodes[0];
          actions += '<button class="btn btn-sm btn-success" style="margin-right:0.25rem;" onclick="submitNodeApproval(\\'' + escapeAttr(s.graphId) + '\\', ' + s.planRevision + ', \\'' + escapeAttr(waitingNodeId) + '\\', true)">Approve</button>';
          actions += '<button class="btn btn-sm btn-danger" style="margin-right:0.25rem;" onclick="submitNodeApproval(\\'' + escapeAttr(s.graphId) + '\\', ' + s.planRevision + ', \\'' + escapeAttr(waitingNodeId) + '\\', false)">Deny</button>';
        } else if (s.status === 'executing') {
          actions += '<button class="btn btn-sm btn-outline" style="margin-right:0.25rem;" onclick="pauseExecutionSession(\\'' + escapeAttr(s.graphId) + '\\', ' + s.planRevision + ')">Pause</button>';
          actions += '<button class="btn btn-sm btn-danger" onclick="cancelExecutionSession(\\'' + escapeAttr(s.graphId) + '\\', ' + s.planRevision + ')">Cancel</button>';
        } else if (s.status === 'paused') {
          actions += '<button class="btn btn-sm btn-success" onclick="resumeExecutionSession(\\'' + escapeAttr(s.graphId) + '\\', ' + s.planRevision + ')">Resume</button>';
        }

        return '<tr>' +
          '<td><div style="font-weight:600;font-family:monospace;font-size:0.8rem;color:#93c5fd;">' + escapeHtml(s.graphId) + '</div><div style="font-size:0.72rem;color:var(--text-muted);">Exec: ' + escapeHtml(s.executionId.slice(0, 16)) + '...</div></td>' +
          '<td><span class="code-badge">r' + s.planRevision + '</span></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td><div style="display:flex;gap:0.25rem;flex-wrap:wrap;max-width:260px;">' + nodeBreakdown + '</div></td>' +
          '<td style="font-size:0.75rem;color:var(--text-muted);">' + updatedTime + '</td>' +
          '<td style="text-align:right;">' + (actions || '<span style="color:var(--text-muted);font-size:0.75rem;">--</span>') + '</td>' +
        '</tr>';
      }).join('');
    }

    function renderToolsTable(tools) {
      const tbody = document.getElementById('toolsTableBody');
      if (!tools || tools.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:1rem;">No tools registered in Authoritative ToolRegistry.</td></tr>';
        return;
      }

      tbody.innerHTML = tools.map(t => {
        const policy = t.policy || {};
        let policyBadge = '<span class="pill-tag" style="background:#1e293b;color:#93c5fd;">Autonomous Read</span>';
        if (policy.isDestructive) {
          policyBadge = '<span class="pill-tag" style="background:rgba(239,68,68,0.2);color:#f87171;">Destructive Action</span>';
        } else if (policy.requiresApproval) {
          policyBadge = '<span class="pill-tag" style="background:rgba(245,158,11,0.2);color:#fbbf24;">Approval Required</span>';
        } else if (policy.isMutating) {
          policyBadge = '<span class="pill-tag" style="background:rgba(59,130,246,0.2);color:#60a5fa;">Guarded Mutation</span>';
        }

        return '<tr>' +
          '<td><span class="code-badge" style="font-weight:700;">' + escapeHtml(t.name) + '</span></td>' +
          '<td>' + policyBadge + '</td>' +
          '<td style="color:var(--text-muted);font-size:0.8rem;">' + escapeHtml(policy.description || 'System capability integration node') + '</td>' +
        '</tr>';
      }).join('');
    }

    async function submitNodeApproval(graphId, planRevision, nodeId, approved) {
      try {
        const res = await fetch('/api/execution/approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId, planRevision, nodeId, approved, telegramUserId: currentSelectedUserId || 1 })
        });
        const data = await res.json();
        if (res.ok) {
          showAlert(approved ? '✅ Node ' + nodeId + ' approved! Continuing DAG...' : '⚠️ Node ' + nodeId + ' denied.');
          loadExecutionData();
        } else {
          showAlert('Approval submission failed: ' + (data.error || 'Server error'), true);
        }
      } catch (err) {
        showAlert('Network error during approval submission', true);
      }
    }

    async function pauseExecutionSession(graphId, planRevision) {
      try {
        const res = await fetch('/api/execution/pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId, planRevision, reason: 'Paused via dashboard console' })
        });
        if (res.ok) {
          showAlert('Execution session paused');
          loadExecutionData();
        }
      } catch (e) {}
    }

    async function resumeExecutionSession(graphId, planRevision) {
      try {
        const res = await fetch('/api/execution/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId, planRevision, telegramUserId: currentSelectedUserId || 1 })
        });
        if (res.ok) {
          showAlert('Execution session resumed');
          loadExecutionData();
        }
      } catch (e) {}
    }

    async function cancelExecutionSession(graphId, planRevision) {
      if (!confirm('Cancel this active execution graph?')) return;
      try {
        const res = await fetch('/api/execution/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId, planRevision, reason: 'Cancelled via dashboard console' })
        });
        if (res.ok) {
          showAlert('Execution session cancelled');
          loadExecutionData();
        }
      } catch (e) {}
    }

    // 0. Telegram Users Loader & Context Switcher
    async function loadUsers() {
      try {
        const res = await fetch('/api/dashboard/users');
        if (res.ok) {
          const data = await res.json();
          cachedUsersList = data.users || [];
          const select = document.getElementById('userSelectDropdown');
          
          if (cachedUsersList.length === 0) {
            select.innerHTML = '<option value="">No registered Telegram users</option>';
            if (!currentSelectedUserId) {
              document.getElementById('selectedUserHeadline').textContent = 'No registered users — enter custom ID or wait for Telegram activity';
            }
          } else {
            // Check if currentSelectedUserId exists in list, else pick first registered user
            const found = cachedUsersList.find(u => String(u.telegramUserId) === String(currentSelectedUserId));
            if (!found && !currentSelectedUserId) {
              currentSelectedUserId = String(cachedUsersList[0].telegramUserId);
            }

            select.innerHTML = cachedUsersList.map(u => {
              const displayName = (u.firstName || '') + (u.username ? (' (@' + u.username + ')') : '') || ('User #' + u.telegramUserId);
              const isSelected = String(u.telegramUserId) === String(currentSelectedUserId);
              return '<option value="' + u.telegramUserId + '" ' + (isSelected ? 'selected' : '') + '>' +
                escapeHtml(displayName) + ' [ID: ' + u.telegramUserId + ']' +
              '</option>';
            }).join('');
            
            if (currentSelectedUserId && !found) {
              select.innerHTML += '<option value="' + currentSelectedUserId + '" selected>Custom Target [ID: ' + currentSelectedUserId + ']</option>';
            }
            updateUserHeadline();
          }

          if (currentSelectedUserId) {
            loadUserSettings(currentSelectedUserId);
            loadReminders(currentSelectedUserId);
            loadMemories(null, currentSelectedUserId);
          }
        }
      } catch (e) {
        console.error('Failed to load users list', e);
      }
    }

    function applyCustomUserId() {
      const val = document.getElementById('customUserIdInput').value.trim();
      if (!val) {
        showAlert('Please enter a numeric Telegram User ID', true);
        return;
      }
      onUserSelectionChange(val);
      document.getElementById('customUserIdInput').value = '';
    }

    function onUserSelectionChange(userId) {
      if (!userId) return;
      currentSelectedUserId = String(userId);
      updateUserHeadline();
      loadUserSettings(currentSelectedUserId);
      loadReminders(currentSelectedUserId);
      loadMemories(null, currentSelectedUserId);
    }

    function updateUserHeadline() {
      if (!currentSelectedUserId) {
        document.getElementById('selectedUserHeadline').textContent = 'No active user selected';
        return;
      }
      const user = cachedUsersList.find(u => String(u.telegramUserId) === String(currentSelectedUserId));
      if (user) {
        const name = (user.firstName || '') + (user.username ? (' (@' + user.username + ')') : '');
        document.getElementById('selectedUserHeadline').textContent = name + ' — Telegram ID: ' + user.telegramUserId;
      } else {
        document.getElementById('selectedUserHeadline').textContent = 'Custom User Context — Telegram ID: ' + currentSelectedUserId;
      }
    }

    async function loadStats() {
      const start = Date.now();
      try {
        const res = await fetch('/api/stats');
        const ping = Date.now() - start;
        document.getElementById('pingBadge').textContent = 'Ping: ' + ping + 'ms';

        if (res.ok) {
          const data = await res.json();
          document.getElementById('modelName').textContent = data.geminiModel || 'gemini-2.5-flash';
          document.getElementById('uptimeBadge').textContent = 'Uptime: ' + formatUptime(data.uptimeSeconds);
          
          if (data.keyPool) {
            updateKeyPoolUI(data.keyPool);
          }
        }
      } catch (e) {
        document.getElementById('uptimeBadge').textContent = 'Connecting...';
      }
    }

    async function loadTelemetry() {
      try {
        const res = await fetch('/api/dashboard/telemetry');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('telemetryCpu').textContent = data.system.cpuCores + ' Cores';
          document.getElementById('telemetryHeap').textContent = data.system.heapUsedMb + ' / ' + data.system.heapTotalMb + ' MB (' + Math.round(data.system.memoryPressureRatio * 100) + '%)';
          document.getElementById('telemetryPool').textContent = data.pool.adaptiveMaxConnections + ' conns (' + (data.pool.pgVectorEnabled ? 'pgvector' : 'hybrid') + ')';
          document.getElementById('telemetryTtl').textContent = Math.round(data.cache.adaptiveCurrentTtlMs / 1000) + 's (Auto-tuning)';
          
          document.getElementById('vectorStatusBadge').textContent = data.pool.pgVectorEnabled ? 'pgvector (768d)' : 'PostgreSQL';
          document.getElementById('dbSubtext').textContent = 'Pool: ' + data.pool.adaptiveMaxConnections + ' conns max';
        }
      } catch (e) {}
    }

    function formatUptime(sec) {
      if (!sec) return '0s';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m > 0 ? (m + 'm ' + s + 's') : (s + 's');
    }

    function updateKeyPoolUI(pool) {
      currentRotationMode = pool.rotationMode;
      document.getElementById('healthyKeyCount').textContent = pool.healthyKeys + '/' + pool.totalKeys;
      document.getElementById('rotationModeText').textContent = 'Mode: ' + (pool.rotationMode === 'failover' ? 'Failover' : 'Round-Robin');

      document.getElementById('btnRoundRobin').className = 'selector-btn ' + (pool.rotationMode === 'round_robin' ? 'active' : '');
      document.getElementById('btnFailover').className = 'selector-btn ' + (pool.rotationMode === 'failover' ? 'active' : '');

      const tbody = document.getElementById('keysTableBody');
      if (!pool.keys || pool.keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No keys in pool. Add one below!</td></tr>';
        return;
      }

      tbody.innerHTML = pool.keys.map((k) => {
        let statusBadge = '';
        if (k.status === 'healthy') {
          statusBadge = '<span class="status-dot status-healthy"></span><span style="color:var(--green);font-weight:600;">Healthy</span>';
        } else if (k.status === 'cooldown') {
          statusBadge = '<span class="status-dot status-cooldown"></span><span style="color:var(--amber);font-weight:600;">Cooldown (' + k.cooldownSecondsLeft + 's)</span>';
        } else if (k.status === 'disabled') {
          statusBadge = '<span class="status-dot status-disabled"></span><span style="color:var(--text-muted);">Disabled</span>';
        } else {
          statusBadge = '<span class="status-dot status-invalid"></span><span style="color:var(--red);">Invalid</span>';
        }

        const isEnv = k.source === 'env';
        const toggleBtnText = k.status === 'disabled' ? '▶️ Enable' : '⏸️ Disable';

        return '<tr class="key-row">' +
          '<td><div class="key-name">' + escapeHtml(k.name) + '</div><div style="font-size:0.75rem;color:var(--text-muted);">' + (isEnv ? 'Environment variable' : 'Dashboard added') + '</div></td>' +
          '<td><span class="code-badge">' + escapeHtml(k.maskedKey) + '</span></td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + (k.totalSuccess || 0) + ' reqs' + (k.totalErrors > 0 ? ' <span style="color:var(--amber);font-size:0.75rem;">(' + k.totalErrors + ' err)</span>' : '') + '</td>' +
          '<td>' + (k.avgLatencyMs ? (k.avgLatencyMs + 'ms') : '--') + '</td>' +
          '<td style="text-align:right;">' +
            '<button class="btn btn-sm btn-outline" style="margin-right:0.3rem;" data-id="' + k.id + '" onclick="toggleKey(this.dataset.id)">' + toggleBtnText + '</button>' +
            '<button class="btn btn-sm btn-danger" data-id="' + k.id + '" onclick="deleteKey(this.dataset.id)">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    async function loadKeys() {
      try {
        const res = await fetch('/api/keys');
        if (res.ok) {
          const data = await res.json();
          updateKeyPoolUI(data);
        }
      } catch (err) {
        console.error('Failed to load keys', err);
      }
    }

    async function addKey() {
      const nameInput = document.getElementById('newKeyName');
      const keyInput = document.getElementById('newKeyValue');
      const btn = document.getElementById('btnAddKey');

      const key = keyInput.value.trim();
      const name = nameInput.value.trim();

      if (!key) {
        showAlert('Please enter an API key', true);
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Verifying...';

      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, name }),
        });
        const data = await res.json();
        if (res.ok) {
          showAlert(data.message || ('✅ Key validated & added to pool successfully (' + data.key.name + ')'));
          keyInput.value = '';
          nameInput.value = '';
          loadKeys();
        } else {
          showAlert('❌ ' + (data.error || 'Failed to add key'), true);
        }
      } catch (err) {
        showAlert('Network error while validating key', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Test & Add Key';
      }
    }

    async function toggleKey(id) {
      try {
        const res = await fetch('/api/keys/' + id + '/toggle', { method: 'PATCH' });
        if (res.ok) loadKeys();
      } catch (e) {}
    }

    async function deleteKey(id) {
      if (!confirm('Remove this key from the pool?')) return;
      try {
        const res = await fetch('/api/keys/' + id, { method: 'DELETE' });
        if (res.ok) {
          showAlert('Key removed from pool');
          loadKeys();
        }
      } catch (e) {}
    }

    async function setRotationMode(mode) {
      try {
        const res = await fetch('/api/keys/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        if (res.ok) {
          showAlert('Rotation strategy updated to ' + (mode === 'failover' ? 'Failover' : 'Round-Robin'));
          loadKeys();
        }
      } catch (e) {}
    }

    // 2. Personality & Mode Controls (Scoped to currentSelectedUserId)
    async function loadUserSettings(userId) {
      const uid = userId || currentSelectedUserId;
      try {
        const res = await fetch('/api/dashboard/user-settings?userId=' + encodeURIComponent(uid));
        if (res.ok) {
          const data = await res.json();
          currentPersonality = data.personality || 'playful';
          currentMode = data.mode || 'general';
          updatePersonalityButtons();
        }
      } catch (e) {}
    }

    function updatePersonalityButtons() {
      document.getElementById('activePersonaBadge').textContent = 'Active: ' + capitalize(currentPersonality) + ' / ' + capitalize(currentMode);
      
      const pBtns = document.querySelectorAll('#personalityButtons .selector-btn');
      pBtns.forEach(btn => {
        const p = btn.textContent.toLowerCase();
        btn.className = 'selector-btn ' + (p.includes(currentPersonality) ? 'active' : '');
      });

      const mBtns = document.querySelectorAll('#modeButtons .selector-btn');
      mBtns.forEach(btn => {
        const m = btn.textContent.toLowerCase();
        btn.className = 'selector-btn ' + (m.includes(currentMode) ? 'active' : '');
      });
    }

    async function setPersonality(personality) {
      if (!currentSelectedUserId) {
        showAlert('Please select or enter a target Telegram User ID first', true);
        return;
      }
      try {
        const res = await fetch('/api/dashboard/user-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personality, userId: currentSelectedUserId }),
        });
        if (res.ok) {
          currentPersonality = personality;
          updatePersonalityButtons();
          showAlert('Personality updated to ' + capitalize(personality) + ' for User #' + currentSelectedUserId);
        }
      } catch (e) {}
    }

    async function setMode(mode) {
      if (!currentSelectedUserId) {
        showAlert('Please select or enter a target Telegram User ID first', true);
        return;
      }
      try {
        const res = await fetch('/api/dashboard/user-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, userId: currentSelectedUserId }),
        });
        if (res.ok) {
          currentMode = mode;
          updatePersonalityButtons();
          showAlert('Operating mode updated to ' + capitalize(mode) + ' for User #' + currentSelectedUserId);
        }
      } catch (e) {}
    }

    // 3. Proactive Reminders (Scoped to currentSelectedUserId)
    async function loadReminders(userId) {
      const uid = userId || currentSelectedUserId;
      try {
        const res = await fetch('/api/dashboard/reminders?userId=' + encodeURIComponent(uid));
        if (res.ok) {
          const data = await res.json();
          const tbody = document.getElementById('remindersTableBody');
          if (!data.reminders || data.reminders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No scheduled reminders found for this user. Create one below!</td></tr>';
            return;
          }

          tbody.innerHTML = data.reminders.map(r => {
            const dueDate = new Date(r.dueAt);
            const isDue = dueDate.getTime() <= Date.now();
            const statusHtml = r.isCompleted
              ? '<span style="color:var(--text-muted);">✅ Completed</span>'
              : (isDue ? '<span style="color:var(--amber);font-weight:600;">🔔 Due Now</span>' : '<span style="color:var(--green);">⏰ Scheduled</span>');

            return '<tr>' +
              '<td><div style="font-weight:600;">' + escapeHtml(r.prompt) + '</div><div style="font-size:0.75rem;color:var(--text-muted);">ID: #' + r.id + ' | User: #' + r.telegramUserId + '</div></td>' +
              '<td>' + dueDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td>' +
              '<td>' + statusHtml + '</td>' +
              '<td>' + (r.snoozeCount || 0) + '</td>' +
              '<td style="text-align:right;">' +
                (!r.isCompleted ? '<button class="btn btn-sm btn-success" style="margin-right:0.3rem;" onclick="completeReminder(' + r.id + ')">Done</button>' : '') +
                (!r.isCompleted ? '<button class="btn btn-sm btn-outline" style="margin-right:0.3rem;" onclick="snoozeReminder(' + r.id + ')">+10m</button>' : '') +
                '<button class="btn btn-sm btn-danger" onclick="deleteReminder(' + r.id + ')">🗑️</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {}
    }

    async function addReminder() {
      if (!currentSelectedUserId) {
        showAlert('Please select or enter a target Telegram User ID first', true);
        return;
      }
      const promptInput = document.getElementById('newReminderPrompt');
      const minutesInput = document.getElementById('newReminderMinutes');
      const prompt = promptInput.value.trim();
      const minutes = parseInt(minutesInput.value.trim(), 10) || 15;

      if (!prompt) {
        showAlert('Please enter a reminder prompt', true);
        return;
      }

      try {
        const res = await fetch('/api/dashboard/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, dueInMinutes: minutes, userId: currentSelectedUserId }),
        });
        if (res.ok) {
          showAlert('✅ Reminder scheduled for User #' + currentSelectedUserId);
          promptInput.value = '';
          minutesInput.value = '';
          loadReminders();
        }
      } catch (e) {}
    }

    async function completeReminder(id) {
      try {
        const res = await fetch('/api/dashboard/reminders/' + id + '/complete', { method: 'PATCH' });
        if (res.ok) {
          showAlert('Reminder marked done');
          loadReminders();
        }
      } catch (e) {}
    }

    async function snoozeReminder(id) {
      try {
        const res = await fetch('/api/dashboard/reminders/' + id + '/snooze', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: 10 }),
        });
        if (res.ok) {
          showAlert('Reminder snoozed for 10 minutes');
          loadReminders();
        }
      } catch (e) {}
    }

    async function deleteReminder(id) {
      if (!confirm('Cancel this reminder?')) return;
      try {
        const res = await fetch('/api/dashboard/reminders/' + id, { method: 'DELETE' });
        if (res.ok) {
          showAlert('Reminder removed');
          loadReminders();
        }
      } catch (e) {}
    }

    // 4. Long-Term Memories (Scoped to currentSelectedUserId)
    async function loadMemories(searchQuery, userId) {
      const uid = userId || currentSelectedUserId;
      try {
        let url = '/api/dashboard/memories?userId=' + encodeURIComponent(uid);
        if (searchQuery) url += '&search=' + encodeURIComponent(searchQuery);

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const tbody = document.getElementById('memoriesTableBody');
          if (!data.memories || data.memories.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No memory facts found for this user. Add one below!</td></tr>';
            return;
          }

          tbody.innerHTML = data.memories.map(m => {
            return '<tr>' +
              '<td><span class="code-badge">' + escapeHtml(m.key) + '</span></td>' +
              '<td><span class="pill-tag">' + escapeHtml(m.category) + '</span></td>' +
              '<td>' + escapeHtml(m.content) + '</td>' +
              '<td style="text-align:right;">' +
                '<button class="btn btn-sm btn-danger" data-key="' + escapeAttr(m.key) + '" onclick="deleteMemory(this.dataset.key)">🗑️</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {}
    }

    function searchMemories() {
      const q = document.getElementById('memorySearchInput').value.trim();
      loadMemories(q, currentSelectedUserId);
    }

    async function addMemory() {
      if (!currentSelectedUserId) {
        showAlert('Please select or enter a target Telegram User ID first', true);
        return;
      }
      const keyInput = document.getElementById('newMemoryKey');
      const contentInput = document.getElementById('newMemoryContent');
      const key = keyInput.value.trim();
      const content = contentInput.value.trim();

      if (!key || !content) {
        showAlert('Please provide both a key and content', true);
        return;
      }

      try {
        const res = await fetch('/api/dashboard/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, content, category: 'fact', userId: currentSelectedUserId }),
        });
        if (res.ok) {
          showAlert('✅ Memory fact stored and vectorized for User #' + currentSelectedUserId);
          keyInput.value = '';
          contentInput.value = '';
          loadMemories();
        }
      } catch (e) {}
    }

    async function deleteMemory(key) {
      if (!confirm('Delete memory "' + key + '"?')) return;
      try {
        const res = await fetch('/api/dashboard/memories/' + encodeURIComponent(key) + '?userId=' + encodeURIComponent(currentSelectedUserId), { method: 'DELETE' });
        if (res.ok) {
          showAlert('Memory deleted');
          loadMemories();
        }
      } catch (e) {}
    }

    // 5. Cache Flush
    async function flushCache() {
      try {
        const res = await fetch('/api/dashboard/cache/flush', { method: 'POST' });
        if (res.ok) {
          showAlert('✅ L1 In-Memory Cache invalidated across worker nodes');
          loadTelemetry();
        }
      } catch (e) {}
    }

    // 6. Test Chat
    function setPrompt(text) {
      document.getElementById('chatInput').value = text;
      sendTestChat();
    }

    async function sendTestChat() {
      const input = document.getElementById('chatInput');
      const box = document.getElementById('chatResponse');
      const btn = document.getElementById('btnSendChat');
      const msg = input.value.trim();
      if (!msg) return;

      btn.disabled = true;
      box.textContent = '⚡ Routing across key pool, recalling pgvector memories & generating reply for User #' + currentSelectedUserId + '...';

      try {
        const res = await fetch('/api/chat/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            personality: currentPersonality,
            mode: currentMode,
            userId: currentSelectedUserId,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          box.textContent = data.reply + '\\n\\n⏱️ Latency: ' + data.latencyMs + 'ms';
          loadStats();
          loadTelemetry();
        } else {
          box.textContent = '❌ Error: ' + (data.error || 'Request failed');
        }
      } catch (err) {
        box.textContent = '❌ Network error';
      } finally {
        btn.disabled = false;
      }
    }

    // 7. Adaptive Environment Variables Configurator Functions
    let cachedEnvVars = [];
    let currentEnvCategory = 'all';
    let unmaskedKeys = new Set();

    async function loadEnvVars() {
      try {
        const res = await fetch('/api/env');
        if (res.ok) {
          const data = await res.json();
          cachedEnvVars = data.variables || [];
          renderEnvVars();
        }
      } catch (e) {
        console.error('Failed to load environment variables', e);
      }
    }

    function filterEnvCategory(category) {
      currentEnvCategory = category;
      ['All', 'Core', 'Webhook', 'Access', 'Performance', 'Custom'].forEach(c => {
        const btn = document.getElementById('envFilter' + c);
        if (btn) btn.classList.remove('active');
      });
      const activeBtn = document.getElementById('envFilter' + capitalize(category));
      if (activeBtn) activeBtn.classList.add('active');
      renderEnvVars();
    }

    function toggleEnvMask(key) {
      if (unmaskedKeys.has(key)) {
        unmaskedKeys.delete(key);
      } else {
        unmaskedKeys.add(key);
      }
      renderEnvVars();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }

    function escapeAttr(str) {
      if (!str) return '';
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function renderEnvVars() {
      const tbody = document.getElementById('envTableBody');
      if (!tbody) return;

      const filtered = cachedEnvVars.filter(v => {
        if (currentEnvCategory === 'all') return true;
        return v.category === currentEnvCategory;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No variables found in category "' + escapeHtml(currentEnvCategory) + '"</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(v => {
        const isUnmasked = unmaskedKeys.has(v.key);
        const maskIcon = isUnmasked ? '🙈' : '👁️';
        const isSetBadge = v.isSet ? '<span class="status-badge online">Configured</span>' : '<span class="status-badge offline">Unset</span>';

        const safeKeyAttr = escapeAttr(v.key);
        const safeValAttr = escapeAttr(v.value || '');

        let testBtn = '';
        if (v.key === 'GEMINI_API_KEY' || v.key === 'TELEGRAM_BOT_TOKEN' || v.key === 'DATABASE_URL') {
          testBtn = '<button class="btn btn-sm btn-outline" style="margin-right:0.35rem;" data-key="' + safeKeyAttr + '" onclick="testEnvVar(this.dataset.key)">🧪 Test</button>';
        }

        let deleteBtn = '';
        if (v.category === 'custom' || !v.required) {
          deleteBtn = '<button class="btn btn-sm btn-danger" data-key="' + safeKeyAttr + '" onclick="deleteEnvVar(this.dataset.key)">🗑️</button>';
        }

        return '<tr>' +
          '<td><div class="code-badge" style="font-weight:700;">' + escapeHtml(v.key) + '</div><div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">' + escapeHtml(v.description || '') + '</div></td>' +
          '<td><span class="pill-tag">' + escapeHtml(v.category) + '</span></td>' +
          '<td>' + isSetBadge + '</td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:0.4rem;width:100%;min-width:220px;">' +
              '<input type="' + (isUnmasked ? 'text' : 'password') + '" id="env_input_' + safeKeyAttr + '" class="input" style="font-family:monospace;font-size:0.8rem;padding:0.4rem 0.6rem;width:100%;flex:1;min-width:0;box-sizing:border-box;" value="' + safeValAttr + '" />' +
              (v.isSensitive ? '<button class="btn btn-sm btn-outline" style="padding:0.35rem 0.5rem;" data-key="' + safeKeyAttr + '" onclick="toggleEnvMask(this.dataset.key)">' + maskIcon + '</button>' : '') +
            '</div>' +
          '</td>' +
          '<td style="text-align:right;">' +
            testBtn +
            '<button class="btn btn-sm" style="margin-right:0.35rem;" data-key="' + safeKeyAttr + '" onclick="saveEnvVar(this.dataset.key)">💾 Save</button>' +
            deleteBtn +
          '</td>' +
        '</tr>';
      }).join('');
    }

    async function saveEnvVar(key) {
      const input = document.getElementById('env_input_' + key);
      if (!input) return;
      const newVal = input.value;

      try {
        const res = await fetch('/api/env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: { [key]: newVal } }),
        });
        const data = await res.json();
        if (res.ok) {
          showAlert('✅ Environment variable ' + key + ' updated live!');
          loadEnvVars();
          loadStats();
        } else {
          showAlert('Error: ' + (data.error || 'Failed to save'), true);
        }
      } catch (e) {
        showAlert('Network error saving environment variable', true);
      }
    }

    async function testEnvVar(key) {
      const input = document.getElementById('env_input_' + key);
      const val = input ? input.value : '';
      showAlert('🧪 Testing connection for ' + key + '...');

      try {
        const res = await fetch('/api/env/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: val }),
        });
        const data = await res.json();
        if (data.ok) {
          showAlert('✅ Test Passed (' + data.latencyMs + 'ms): ' + data.message);
        } else {
          showAlert('❌ Test Failed: ' + (data.error || data.message || 'Verification failed'), true);
        }
      } catch (e) {
        showAlert('Network error during connection test', true);
      }
    }

    async function addCustomEnvVar() {
      const kInput = document.getElementById('newEnvKey');
      const vInput = document.getElementById('newEnvVal');
      const k = kInput.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const v = vInput.value.trim();

      if (!k) {
        showAlert('Please specify a variable name', true);
        return;
      }

      try {
        const res = await fetch('/api/env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: { [k]: v } }),
        });
        if (res.ok) {
          showAlert('✅ Custom variable ' + k + ' created!');
          kInput.value = '';
          vInput.value = '';
          loadEnvVars();
        }
      } catch (e) {}
    }

    async function deleteEnvVar(key) {
      if (!confirm('Remove environment variable "' + key + '" from runtime?')) return;
      try {
        const res = await fetch('/api/env/' + encodeURIComponent(key), { method: 'DELETE' });
        if (res.ok) {
          showAlert('Variable ' + key + ' removed');
          loadEnvVars();
        }
      } catch (e) {}
    }

    function capitalize(str) {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Initial Load & Interval Polling
    loadUsers();
    loadStats();
    loadKeys();
    loadEnvVars();
    loadTelemetry();
    loadExecutionData();

    setInterval(loadStats, 4000);
    setInterval(loadTelemetry, 5000);
    setInterval(loadExecutionData, 5000);
    setInterval(loadUsers, 10000); // Auto-detect new Telegram users in real time
  </script>
</body>
</html>`);
});

export default app;
export { telegramRuntime };
