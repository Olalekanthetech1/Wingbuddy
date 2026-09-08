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
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.75rem;
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
    .flex-between { display: flex; align-items: center; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <span class="badge"><span class="live-indicator"></span> Live Multi-Key Pool & Engine Console</span>
        <h1>Wingbuddy Telegram Assistant</h1>
        <p class="subtitle">Personal AI Assistant with automated multi-key pool rotation, dynamic pgvector memory, proactive reminders, and self-tuning L1 edge caching.</p>
      </div>
      <div style="text-align: right;">
        <span id="uptimeBadge" class="pill-tag">Connecting...</span>
        <div id="pingBadge" style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">Ping: --ms</div>
      </div>
    </div>

    <div id="alertBox"></div>

    <!-- Status 4-Grid -->
    <div class="grid">
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
        <div class="card-title">🧠 AI Engine</div>
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
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <select id="userSelectDropdown" class="input" style="font-weight:600; background:#0b1329; border-color:#3b82f6;" onchange="onUserSelectionChange(this.value)">
            <option value="">Loading users...</option>
          </select>
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
    let currentSelectedUserId = '6307001401'; // Default to active Telegram user
    let cachedUsersList = [];

    function showAlert(msg, isError = false) {
      const box = document.getElementById('alertBox');
      box.textContent = msg;
      box.className = isError ? 'alert-error' : 'alert-success';
      box.style.display = 'block';
      setTimeout(() => { box.style.display = 'none'; }, 5000);
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
            select.innerHTML = '<option value="">No Telegram users registered</option>';
            document.getElementById('selectedUserHeadline').textContent = 'No registered users';
            return;
          }

          // Check if currentSelectedUserId exists in list, else pick first
          const found = cachedUsersList.find(u => String(u.telegramUserId) === String(currentSelectedUserId));
          if (!found) {
            currentSelectedUserId = String(cachedUsersList[0].telegramUserId);
          }

          select.innerHTML = cachedUsersList.map(u => {
            const displayName = (u.firstName || '') + (u.username ? (' (@' + u.username + ')') : '') || ('User #' + u.telegramUserId);
            const isSelected = String(u.telegramUserId) === String(currentSelectedUserId);
            return '<option value="' + u.telegramUserId + '" ' + (isSelected ? 'selected' : '') + '>' +
              escapeHtml(displayName) + ' [ID: ' + u.telegramUserId + ']' +
            '</option>';
          }).join('');

          updateUserHeadline();
          loadUserSettings(currentSelectedUserId);
          loadReminders(currentSelectedUserId);
          loadMemories(null, currentSelectedUserId);
        }
      } catch (e) {
        console.error('Failed to load users list', e);
      }
    }

    function onUserSelectionChange(userId) {
      currentSelectedUserId = String(userId);
      updateUserHeadline();
      loadUserSettings(currentSelectedUserId);
      loadReminders(currentSelectedUserId);
      loadMemories(null, currentSelectedUserId);
    }

    function updateUserHeadline() {
      const user = cachedUsersList.find(u => String(u.telegramUserId) === String(currentSelectedUserId));
      if (user) {
        const name = (user.firstName || '') + (user.username ? (' (@' + user.username + ')') : '');
        document.getElementById('selectedUserHeadline').textContent = name + ' — Telegram ID: ' + user.telegramUserId;
      } else {
        document.getElementById('selectedUserHeadline').textContent = 'User ID: ' + currentSelectedUserId;
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
            '<button class="btn btn-sm btn-outline" style="margin-right:0.3rem;" onclick="toggleKey(\\'' + k.id + '\\')">' + toggleBtnText + '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="deleteKey(\\'' + k.id + '\\')">🗑️</button>' +
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
          showAlert('✅ Key validated & added to pool successfully (' + data.key.name + ')');
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
                '<button class="btn btn-sm btn-danger" onclick="deleteMemory(\\'' + escapeHtml(m.key) + '\\')">🗑️</button>' +
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

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function capitalize(str) {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // Initial Load & Interval Polling
    loadUsers();
    loadStats();
    loadKeys();
    loadTelemetry();

    setInterval(loadStats, 4000);
    setInterval(loadTelemetry, 5000);
    setInterval(loadUsers, 10000); // Auto-detect new Telegram users in real time
  </script>
</body>
</html>`);
});

export default app;
export { telegramRuntime };
