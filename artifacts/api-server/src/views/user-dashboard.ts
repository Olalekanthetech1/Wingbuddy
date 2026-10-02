export function renderUserDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" id="main-html">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Wingbuddy AI | User Workspace</title>
  <meta name="theme-color" content="#0b0f19">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/svg+xml" href="/app-icon.svg">
  <link rel="alternate icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Wingbuddy">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <!-- Firebase SDK -->
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
            mono: ['"JetBrains Mono"', 'monospace'],
          },
          colors: {
            app: {
              bg: 'var(--app-bg)',
              surface: 'var(--app-surface)',
              text: 'var(--app-text)',
              border: 'var(--app-border)',
              highlight: 'var(--app-highlight)',
            },
            brand: {
              50: '#f0f9ff',
              100: '#e0f2fe',
              400: '#38bdf8',
              500: '#0ea5e9',
              600: '#0284c7',
              700: '#0369a1',
            }
          }
        }
      }
    }
  </script>
  <style>
    :root { 
      color-scheme: light; 
      --app-bg: #f8fafc;
      --app-surface: #ffffff;
      --app-text: #1e293b;
      --app-border: rgba(0, 0, 0, 0.08);
      --app-highlight: rgba(0, 0, 0, 0.04);
    }
    .dark { 
      color-scheme: dark; 
      --app-bg: #0b0f19;
      --app-surface: #0e1424;
      --app-text: #f8fafc;
      --app-border: rgba(255, 255, 255, 0.05);
      --app-highlight: rgba(255, 255, 255, 0.05);
    }
    html, body { 
      background-color: var(--app-bg); 
      color: var(--app-text); 
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; 
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .glass-panel { background: var(--app-surface); border: 1px solid var(--app-border); }
    .chat-bubble-user { background: #0284c7; color: #ffffff; }
    .chat-bubble-ai { background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); }
    .chat-bubble-tg { border-left: 3px solid #38bdf8; }
    .chat-bubble-voice { border-left: 3px solid #a855f7; }
    pre { background: #0f172a; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; border: 1px solid rgba(255, 255, 255, 0.08); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(255, 255, 255, 0.08); padding: 2px 5px; border-radius: 4px; }
    pre code { background: transparent; padding: 0; }
    /* Custom Scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 0px; }
    ::-webkit-scrollbar:horizontal { height: 0px !important; display: none !important; width: 0px !important; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }

    /* Strict Zero-Horizontal-Scroll on Chat and Views */
    #chat-thread {
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior-y: contain;
      scrollbar-width: thin;
    }
    .chat-bubble-user, .chat-bubble-ai {
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .prose {
      word-break: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
    }
  </style>
</head>
<body class="h-screen flex flex-col antialiased overflow-hidden selection:bg-brand-500 selection:text-white bg-app-bg text-app-text">

  <!-- TOP APP BAR -->
  <header class="h-16 border-b border-app-border bg-app-surface px-4 sm:px-6 flex items-center justify-between z-30 shrink-0">
    <div class="flex items-center gap-3">
      <a href="/app" class="flex items-center gap-2.5">
        <img src="/app-icon.svg" alt="Wingbuddy Logo" class="w-9 h-9 rounded-xl shadow-md shadow-brand-500/20 object-cover" />
        <div>
          <span class="font-extrabold text-lg tracking-tight text-app-text">Wingbuddy <span class="text-brand-400 text-xs font-semibold">AI Workspace</span></span>
        </div>
      </a>

      <!-- Telegram Status Pill -->
      <div id="tg-status-pill" onclick="openTelegramSyncModal()" class="cursor-pointer ml-1 sm:ml-3 px-3 py-1 rounded-full bg-app-highlight hover:bg-black/5 dark:hover:bg-white/10 border border-app-border text-xs flex items-center gap-2 transition">
        <span class="w-2 h-2 rounded-full bg-amber-400" id="tg-status-dot"></span>
        <span class="text-app-text opacity-70 font-medium" id="tg-status-text">Checking Telegram Sync...</span>
      </div>

      <!-- Real-time Event Bus indicator -->
      <div id="sse-status-pill" class="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-app-highlight border border-app-border text-xs text-app-text opacity-70">
        <span id="sse-status-dot" class="w-2 h-2 rounded-full bg-app-text opacity-30"></span>
        <span id="sse-status-text" class="font-medium">Connecting...</span>
      </div>
    </div>

    <!-- Right Controls -->
    <div class="flex items-center gap-3">
      <!-- Notification Filter Mode -->
      <div class="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-app-highlight border border-app-border text-xs">
        <span class="text-app-text opacity-60">TG Notify:</span>
        <select id="select-notify-pref" onchange="updateNotifyPreference(this.value)" class="bg-transparent text-brand-400 font-semibold focus:outline-none cursor-pointer">
          <option value="full" class="bg-app-bg text-app-text">Full Replies</option>
          <option value="digest_only" class="bg-app-bg text-app-text">Tasks &amp; Alerts Only</option>
          <option value="silent" class="bg-app-bg text-app-text">Silent History Sync</option>
        </select>
      </div>

      <!-- Theme Switcher -->
      <div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-highlight border border-app-border text-xs">
        <span class="text-app-text opacity-60">Theme:</span>
        <select id="header-theme-select" onchange="updateTheme(this.value)" class="bg-transparent text-brand-400 font-semibold focus:outline-none cursor-pointer">
          <option value="system" class="bg-app-bg text-app-text">System</option>
          <option value="light" class="bg-app-bg text-app-text">Light</option>
          <option value="dark" class="bg-app-bg text-app-text">Dark</option>
        </select>
      </div>

      <!-- Admin switch link if admin -->
      <a id="admin-portal-link" href="/admin" class="hidden px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 text-xs font-semibold transition flex items-center gap-1.5">
        <span>⚙️ Admin Panel</span>
      </a>

      <!-- User Profile Menu -->
      <div class="flex items-center gap-2.5 pl-2 border-l border-app-border">
        <div id="user-avatar" class="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-500 to-sky-400 flex items-center justify-center text-white font-bold text-xs uppercase shadow-sm">
          U
        </div>
        <div class="hidden sm:block text-left">
          <div id="user-name" class="text-xs font-bold text-app-text truncate max-w-[120px]">User</div>
          <div id="user-email" class="text-[10px] text-app-text opacity-60 truncate max-w-[120px]">user@example.com</div>
        </div>
        <button onclick="handleLogout()" title="Sign Out" class="p-1.5 rounded-lg text-app-text opacity-50 hover:opacity-100 hover:bg-app-highlight transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        </button>
      </div>
    </div>
  </header>

  <!-- MAIN WORKSPACE LAYOUT (Full-width clean refined canvas) -->
  <div class="flex-1 flex overflow-hidden w-full relative">
    <!-- CONTENT VIEW AREA -->
    <main class="flex-1 flex flex-col overflow-hidden bg-app-bg w-full">

      <!-- TAB 0: AUTHORITATIVE OVERVIEW DASHBOARD -->
      <section id="tab-view-overview" class="flex-1 overflow-y-auto p-3.5 sm:p-6 md:p-8 max-w-6xl w-full mx-auto space-y-4 sm:space-y-6 pb-28 sm:pb-36">
        
        <!-- Welcome & Telemetry Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-app-border pb-5">
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-xl sm:text-2xl font-extrabold text-app-text tracking-tight">
                Welcome back, <span id="ov-user-name" class="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-sky-300 to-indigo-300">...</span>
              </h1>
              <span id="ov-badge-role" class="px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 text-[10px] font-bold uppercase tracking-wider">Active</span>
            </div>
            <p class="text-xs text-app-text opacity-50 mt-1">Autonomous Multi-Device Workspace • Live Signals &amp; Verified Data</p>
          </div>

          <!-- Live Heartbeat & Refresh Control -->
          <div class="flex items-center gap-3 self-start sm:self-auto">
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-app-highlight border border-app-border text-xs">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span id="ov-sync-indicator" class="text-app-text opacity-70 font-medium">Authoritative Sync</span>
              <span class="text-app-text opacity-30">•</span>
              <span id="ov-last-updated-text" class="text-[11px] font-mono text-app-text opacity-50">Loading...</span>
            </div>
            <button onclick="loadOverview(true)" id="ov-btn-refresh" class="p-2 rounded-xl bg-app-highlight hover:bg-black/5 dark:hover:bg-white/10 text-app-text opacity-70 hover:opacity-100 transition flex items-center gap-1.5 text-xs font-semibold" title="Refresh Live Data">
              <span>🔄</span>
              <span class="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        <!-- Top Dual Hub Cards: Assistant Intelligence & Telegram Continuity -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <!-- Card 1: Assistant Intelligence Status -->
          <div class="glass-panel rounded-2xl p-5 space-y-4 flex flex-col justify-between relative overflow-hidden">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <span id="ov-assistant-dot" class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <h3 id="ov-assistant-status-label" class="font-bold text-app-text text-base">Assistant Ready</h3>
                </div>
                <p id="ov-assistant-details" class="text-xs text-app-text opacity-50 mt-1">Live and responding to tasks, research, and conversational requests.</p>
              </div>
              <span id="ov-assistant-status-pill" class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Ready
              </span>
            </div>

            <div class="p-3 rounded-xl bg-app-highlight border border-app-border flex items-center justify-between gap-3 text-xs">
              <div class="flex items-center gap-2 text-app-text opacity-70">
                <span>⚡</span>
                <span>Multi-Step Autonomy &amp; Real-Time Web Search Active</span>
              </div>
            </div>

            <div class="flex items-center justify-between pt-1">
              <span class="text-[11px] text-app-text opacity-50">Continuous conversational context</span>
              <button onclick="switchTab('chat')" class="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-brand-600/20 transition">
                <span>💬 Open Live Chat</span>
              </button>
            </div>
          </div>

          <!-- Card 2: User Profile & Telegram Continuity -->
          <div class="glass-panel rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-3">
                <div id="ov-profile-avatar" class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-500 to-indigo-500 flex items-center justify-center text-white font-extrabold text-base uppercase shadow-md shadow-brand-500/20 shrink-0">
                  U
                </div>
                <div>
                  <div id="ov-profile-name" class="font-extrabold text-app-text text-base">Loading profile...</div>
                  <div id="ov-profile-email" class="text-xs text-app-text opacity-50 font-mono">user@domain</div>
                  <div class="text-[10px] text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>Cloud Workspace Synced</span>
                  </div>
                </div>
              </div>
              <div id="ov-tg-badge">
                <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Checking...</span>
              </div>
            </div>

            <div class="p-3.5 rounded-xl bg-app-highlight border border-app-border flex items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <span class="text-xl">📱</span>
                <div>
                  <div id="ov-tg-title" class="text-xs font-bold text-app-text">Telegram Synchronization</div>
                  <div id="ov-tg-subtitle" class="text-[11px] text-app-text opacity-50 mt-0.5">Verifying paired mobile connection...</div>
                </div>
              </div>
              <div id="ov-tg-action-container">
                <button onclick="openTelegramSyncModal()" class="px-3.5 py-1.5 rounded-lg bg-[#229ED9] hover:bg-[#1e8cc0] text-white text-xs font-bold transition shadow-sm">
                  Connect Telegram
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Personal Intelligence Metrics Grid -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-bold uppercase tracking-wider text-app-text opacity-50">Personal Intelligence Metrics</h2>
            <span class="text-[10px] text-app-text opacity-30 font-mono">Live Database Records</span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            
            <!-- Tile 1: Memory Vault -->
            <div onclick="switchTab('memory')" class="glass-panel hover:border-brand-500/40 rounded-2xl p-4 sm:p-5 transition cursor-pointer group">
              <div class="flex items-center justify-between text-app-text opacity-60 mb-2">
                <span class="text-xs font-semibold">Memory Vault</span>
                <span class="text-base group-hover:scale-110 transition">🧠</span>
              </div>
              <div id="ov-metric-memories" class="text-2xl sm:text-3xl font-extrabold text-app-text">—</div>
              <div id="ov-metric-memories-sub" class="text-[11px] text-app-text opacity-50 mt-1 truncate">Stored knowledge facts</div>
            </div>

            <!-- Tile 2: Scheduled Tasks -->
            <div onclick="switchTab('tasks')" class="glass-panel hover:border-brand-500/40 rounded-2xl p-4 sm:p-5 transition cursor-pointer group">
              <div class="flex items-center justify-between text-app-text opacity-60 mb-2">
                <span class="text-xs font-semibold">Scheduled Tasks</span>
                <span class="text-base group-hover:scale-110 transition">⚡</span>
              </div>
              <div id="ov-metric-tasks" class="text-2xl sm:text-3xl font-extrabold text-app-text">—</div>
              <div id="ov-metric-tasks-sub" class="text-[11px] text-app-text opacity-50 mt-1 truncate">Autonomous jobs</div>
            </div>

            <!-- Tile 3: Reminders & Alerts -->
            <div onclick="switchTab('reminders')" class="glass-panel hover:border-brand-500/40 rounded-2xl p-4 sm:p-5 transition cursor-pointer group">
              <div class="flex items-center justify-between text-app-text opacity-60 mb-2">
                <span class="text-xs font-semibold">Reminders</span>
                <span class="text-base group-hover:scale-110 transition">⏰</span>
              </div>
              <div id="ov-metric-reminders" class="text-2xl sm:text-3xl font-extrabold text-app-text">—</div>
              <div id="ov-metric-reminders-sub" class="text-[11px] text-app-text opacity-50 mt-1 truncate">Scheduled alarms</div>
            </div>

            <!-- Tile 4: Synchronized Messages -->
            <div onclick="switchTab('chat')" class="glass-panel hover:border-brand-500/40 rounded-2xl p-4 sm:p-5 transition cursor-pointer group">
              <div class="flex items-center justify-between text-app-text opacity-60 mb-2">
                <span class="text-xs font-semibold">Messages</span>
                <span class="text-base group-hover:scale-110 transition">💬</span>
              </div>
              <div id="ov-metric-messages" class="text-2xl sm:text-3xl font-extrabold text-app-text">—</div>
              <div id="ov-metric-messages-sub" class="text-[11px] text-app-text opacity-50 mt-1 truncate">Conversational history</div>
            </div>
          </div>

          <!-- Quota & Usage Ledger Card -->
          <div id="ov-quota-card" class="hidden mt-3 glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">💎</span>
              <div>
                <div class="text-xs font-bold text-app-text flex items-center gap-2">
                  <span id="ov-quota-title">Daily Interaction Usage</span>
                  <span id="ov-quota-tier" class="px-2 py-0.2 rounded-full bg-brand-500/20 text-brand-600 dark:text-brand-300 text-[10px] uppercase font-bold">Standard</span>
                </div>
                <div id="ov-quota-reset" class="text-[11px] text-app-text opacity-50 mt-0.5">Resets daily at 00:00 UTC</div>
              </div>
            </div>
            <div id="ov-quota-progress-container" class="flex-1 max-w-xs flex flex-col gap-1 hidden">
              <div class="flex justify-between text-[11px] font-mono">
                <span class="text-app-text opacity-50">Used: <span id="ov-quota-used" class="text-app-text font-bold">0</span></span>
                <span class="text-app-text opacity-50">Limit: <span id="ov-quota-limit" class="text-brand-500 font-bold">50</span></span>
              </div>
              <div class="w-full bg-app-highlight rounded-full h-2 overflow-hidden">
                <div id="ov-quota-bar" class="bg-gradient-to-r from-brand-500 to-indigo-500 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
              </div>
            </div>
            <div id="ov-quota-unlimited-container" class="hidden text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
              <span>✨ Unlimited Plan • <span id="ov-quota-unlimited-used">0</span> interactions today</span>
            </div>
          </div>
        </div>

        <!-- Adaptive Context Prompts & Fast Actions -->
        <div class="glass-panel rounded-2xl p-5 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-app-text">Suggested Assistant Actions</h3>
              <p class="text-xs text-app-text opacity-50 mt-0.5">Context-aware triggers adapted to your current workspace state.</p>
            </div>
          </div>

          <!-- Dynamic Prompts Grid -->
          <div id="ov-dynamic-prompts" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <!-- Rendered dynamically based on live data -->
          </div>

          <!-- Direct Creation Shortcuts -->
          <div class="pt-3 border-t border-app-border flex flex-wrap items-center gap-2">
            <span class="text-[11px] font-bold text-app-text opacity-50 uppercase tracking-wider mr-1">Shortcuts:</span>
            <button onclick="openCreateTaskModal()" class="px-3 py-1.5 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-80 hover:opacity-100 border border-app-border text-xs font-semibold transition flex items-center gap-1.5">
              <span>⚡ + Create Task</span>
            </button>
            <button onclick="openCreateMemoryModal()" class="px-3 py-1.5 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-80 hover:opacity-100 border border-app-border text-xs font-semibold transition flex items-center gap-1.5">
              <span>🧠 + Add Memory</span>
            </button>
            <button onclick="openCreateReminderModal()" class="px-3 py-1.5 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-80 hover:opacity-100 border border-app-border text-xs font-semibold transition flex items-center gap-1.5">
              <span>⏰ + Set Reminder</span>
            </button>
          </div>
        </div>

        <!-- 2-Column Recent Activity Split -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          <!-- Column 1: Recent Autonomous Tasks -->
          <div class="glass-panel rounded-2xl p-5 space-y-3 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between border-b border-app-border pb-2.5">
                <div class="flex items-center gap-2">
                  <span class="text-base">⚡</span>
                  <h3 class="font-bold text-app-text text-sm">Recent Autonomous Tasks</h3>
                </div>
                <button onclick="switchTab('tasks')" class="text-xs text-brand-500 dark:text-brand-400 hover:underline">View All →</button>
              </div>

              <div id="ov-recent-tasks-list" class="mt-3 space-y-2">
                <div class="text-center py-6 text-app-text opacity-50 text-xs">Loading tasks...</div>
              </div>
            </div>

            <button onclick="openCreateTaskModal()" class="w-full py-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-80 hover:opacity-100 border border-app-border text-xs font-semibold transition text-center mt-2">
              + Create New Task
            </button>
          </div>

          <!-- Column 2: Recent Memory Vault -->
          <div class="glass-panel rounded-2xl p-5 space-y-3 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between border-b border-app-border pb-2.5">
                <div class="flex items-center gap-2">
                  <span class="text-base">🧠</span>
                  <h3 class="font-bold text-app-text text-sm">Recent Memory Vault</h3>
                </div>
                <button onclick="switchTab('memory')" class="text-xs text-brand-500 dark:text-brand-400 hover:underline">View Vault →</button>
              </div>

              <div id="ov-recent-memories-list" class="mt-3 space-y-2">
                <div class="text-center py-6 text-app-text opacity-50 text-xs">Loading memories...</div>
              </div>
            </div>

            <button onclick="openCreateMemoryModal()" class="w-full py-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-80 hover:opacity-100 border border-app-border text-xs font-semibold transition text-center mt-2">
              + Store New Memory
            </button>
          </div>
        </div>

      </section>

      <!-- TAB 1: LIVE CHAT WORKSPACE -->
      <section id="tab-view-chat" class="hidden flex-1 flex flex-col overflow-hidden">
        <!-- Chat Sub-header Bar with Multi-Conversation Controls -->
        <div class="px-3 sm:px-4 py-2 border-b border-app-border bg-app-bg/95 backdrop-blur-md flex items-center justify-between shrink-0 max-w-4xl w-full mx-auto gap-2">
          <!-- Active Conversation Switcher Trigger -->
          <div class="flex items-center gap-2 min-w-0">
            <button onclick="openConversationsDrawer()" class="px-3 py-1.5 rounded-xl bg-app-highlight hover:bg-app-highlight/80 border border-app-border text-xs font-semibold text-app-text flex items-center gap-1.5 transition truncate cursor-pointer shadow-sm group active:scale-95" title="Switch or view all conversations">
              <span class="text-brand-400">💬</span>
              <span id="active-chat-title" class="truncate max-w-[130px] sm:max-w-[220px]">New Chat</span>
              <svg class="w-3.5 h-3.5 text-app-text opacity-40 group-hover:opacity-100 transition shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse hidden sm:inline-block" title="Synced across Web & Telegram"></span>
          </div>

          <!-- Chat Action Buttons: New Chat, Delete Chat, Clear -->
          <div class="flex items-center gap-1.5 shrink-0">
            <button onclick="createNewChat()" class="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-brand-600/20 active:scale-95 cursor-pointer" title="Create a new conversation thread">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
              <span>New Chat</span>
            </button>
            <button onclick="deleteCurrentChat()" class="p-1.5 rounded-xl text-app-text opacity-40 hover:text-red-400 hover:bg-red-500/10 border border-app-border transition flex items-center justify-center cursor-pointer" title="Delete current conversation">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
            <button onclick="clearChatHistory()" class="hidden md:flex p-1.5 rounded-xl text-app-text opacity-40 hover:text-amber-400 hover:bg-amber-500/10 border border-app-border transition items-center justify-center cursor-pointer" title="Clear messages in this conversation">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
          </div>
        </div>

        <!-- Message Thread -->
        <div id="chat-thread" class="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4 max-w-4xl w-full mx-auto">
          <!-- Chat messages dynamically rendered here -->
          <div class="text-center py-12 text-app-text opacity-50 text-xs">
            <div class="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center text-xl mx-auto mb-3">
              ⚡
            </div>
            <div class="font-bold text-app-text text-sm mb-1">Wingbuddy Workspace Ready</div>
            <p>Messages, tasks, and memory items synchronize bi-directionally between Web and Telegram.</p>
          </div>
        </div>

        <!-- Chat Input Form -->
        <div class="p-4 border-t border-app-border bg-app-surface shrink-0 pb-20 sm:pb-24">
          <div class="max-w-4xl mx-auto">
            <form id="chat-form" onsubmit="handleChatSubmit(event)" class="relative flex items-end gap-2">
              <textarea id="chat-input" rows="1" placeholder="Type a message or task goal..."
                        class="w-full rounded-xl bg-app-highlight border border-app-border focus:border-brand-500 px-4 py-3.5 text-sm text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none resize-none min-h-[50px] max-h-[160px] leading-relaxed transition-[height] duration-75"></textarea>
              <button id="chat-send-btn" type="submit" class="h-12 px-5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm flex items-center justify-center transition shadow-lg shadow-brand-600/20 shrink-0 active:scale-95">
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>
      </section>

      <!-- TAB 2: SCHEDULED TASKS -->
      <section id="tab-view-tasks" class="hidden flex-1 overflow-y-auto p-4 sm:p-8 max-w-5xl w-full mx-auto space-y-6 pb-28 sm:pb-36">
        <div class="flex items-center justify-between border-b border-app-border pb-4">
          <div>
            <h2 class="text-xl font-bold text-app-text">Scheduled Tasks &amp; Autonomous Digests</h2>
            <p class="text-xs text-app-text opacity-60 mt-1">Autonomous multi-step jobs executing in background and publishing digests to Telegram &amp; Web.</p>
          </div>
          <button onclick="openCreateTaskModal()" class="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition flex items-center gap-2">
            <span>+ Create Task</span>
          </button>
        </div>

        <div id="tasks-list" class="grid grid-cols-1 gap-4">
          <!-- Tasks dynamically rendered here -->
          <div class="text-center py-12 text-app-text opacity-40 text-xs">Loading active tasks...</div>
        </div>
      </section>

      <!-- TAB 3: MEMORY VAULT -->
      <section id="tab-view-memory" class="hidden flex-1 overflow-y-auto p-4 sm:p-8 max-w-5xl w-full mx-auto space-y-6 pb-28 sm:pb-36">
        <div class="flex items-center justify-between border-b border-app-border pb-4">
          <div>
            <h2 class="text-xl font-bold text-app-text">Persistent Memory Vault</h2>
            <p class="text-xs text-app-text opacity-60 mt-1">Multi-tenant isolated long-term knowledge learned across Telegram and Web.</p>
          </div>
          <button onclick="openCreateMemoryModal()" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition flex items-center gap-2">
            <span>+ Add Memory</span>
          </button>
        </div>

        <div id="memory-list" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Memories dynamically rendered here -->
          <div class="text-center py-12 text-app-text opacity-40 text-xs">Loading user memory vault...</div>
        </div>
      </section>

      <!-- TAB 4: REMINDERS -->
      <section id="tab-view-reminders" class="hidden flex-1 overflow-y-auto p-4 sm:p-8 max-w-5xl w-full mx-auto space-y-6 pb-28 sm:pb-36">
        <div class="flex items-center justify-between border-b border-app-border pb-4">
          <div>
            <h2 class="text-xl font-bold text-app-text">Proactive Reminders &amp; Alarms</h2>
            <p class="text-xs text-app-text opacity-60 mt-1">Scheduled alerts pushed to your Telegram and active Web workspace.</p>
          </div>
          <button onclick="openCreateReminderModal()" class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition flex items-center gap-2">
            <span>+ Create Reminder</span>
          </button>
        </div>

        <div id="reminders-list" class="space-y-3">
          <!-- Reminders dynamically rendered here -->
          <div class="text-center py-12 text-app-text opacity-40 text-xs">Loading reminders...</div>
        </div>
      </section>

      <!-- TAB 5: TELEGRAM & SYNC SETTINGS -->
      <section id="tab-view-settings" class="hidden flex-1 overflow-y-auto p-4 sm:p-8 max-w-4xl w-full mx-auto space-y-6 pb-28 sm:pb-36">
        <div class="border-b border-app-border pb-4">
          <h2 class="text-xl font-bold text-app-text">Account Profile &amp; Telegram Synchronization</h2>
          <p class="text-xs text-app-text opacity-60 mt-1">Manage single display name resolution, cross-platform linking, and notification dispatch controls.</p>
        </div>

        <!-- User Identity & Preferred Name Card -->
        <div class="glass-panel rounded-2xl p-6 space-y-4 border border-brand-500/20">
          <div class="flex items-center gap-3 border-b border-app-border pb-3">
            <div class="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 text-xl">
              👤
            </div>
            <div>
              <h3 class="font-bold text-app-text text-sm">Authoritative Identity &amp; Preferred Name</h3>
              <p class="text-xs text-app-text opacity-60">Single source of truth used across Web Chat, Telegram Bot, and AI Assistant.</p>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <label class="block text-xs font-semibold text-app-text opacity-70 mb-1">Preferred Name</label>
              <div class="flex items-center gap-2">
                <input id="settings-pref-name-input" type="text" placeholder="e.g. Lekzy or Femi" maxlength="40" class="flex-1 bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder-app-text placeholder-opacity-40 focus:outline-none focus:border-brand-500/50" />
                <button onclick="savePreferredNameSettings()" class="px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold transition shadow-sm">
                  Save Name
                </button>
              </div>
              <div id="settings-name-feedback" class="hidden text-xs mt-1.5 font-medium"></div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div class="p-3 rounded-xl bg-app-highlight border border-app-border">
                <div class="text-[11px] text-app-text opacity-50 font-medium">Resolved Display Name</div>
                <div id="settings-resolved-display-name" class="font-bold text-brand-600 dark:text-brand-300 mt-0.5">Loading...</div>
              </div>
              <div class="p-3 rounded-xl bg-app-highlight border border-app-border">
                <div class="text-[11px] text-app-text opacity-50 font-medium">Name Source Priority</div>
                <div id="settings-name-source-label" class="font-bold text-app-text mt-0.5">Loading...</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Interface Theme Switcher -->
        <div class="glass-panel rounded-2xl p-6 space-y-4 border border-app-border">
          <div class="flex items-center gap-3 border-b border-app-border pb-3">
            <div class="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 text-xl">
              🌓
            </div>
            <div>
              <h3 class="font-bold text-app-text text-sm">Interface Visual Theme</h3>
              <p class="text-xs text-app-text opacity-60">Adaptive UI mode for high-focus or late-night sessions.</p>
            </div>
          </div>
          <div class="flex items-center gap-2 p-1.5 bg-app-highlight rounded-2xl border border-app-border w-fit">
            <button onclick="updateTheme('light')" id="theme-btn-light" class="px-5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Light</button>
            <button onclick="updateTheme('dark')" id="theme-btn-dark" class="px-5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">Dark</button>
            <button onclick="updateTheme('system')" id="theme-btn-system" class="px-5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95">System</button>
          </div>
        </div>

        <!-- Admin: Persona Registry -->
        <div id="admin-persona-section" class="hidden glass-panel rounded-2xl p-6 space-y-4 border border-indigo-500/30">
          <div class="flex items-center justify-between border-b border-app-border pb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-xl">
                🎭
              </div>
              <div>
                <h3 class="font-bold text-app-text text-sm">Staff AI Persona Registry</h3>
                <p class="text-xs text-app-text opacity-60">Authoritative control over system instructions and availability.</p>
              </div>
            </div>
            <button onclick="loadAdminPersonas()" class="p-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 transition flex items-center gap-1 text-xs font-bold" title="Refresh Registry">
              <span>🔄</span>
              <span class="hidden sm:inline">Refresh</span>
            </button>
          </div>
          
          <div id="admin-persona-list" class="space-y-4">
            <div class="text-center py-8 text-app-text opacity-40 text-xs italic">Loading persona registry...</div>
          </div>
        </div>

        <!-- Telegram Connection Card -->
        <div class="glass-panel rounded-2xl p-6 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-[#229ED9]/10 border border-[#229ED9]/30 flex items-center justify-center text-[#229ED9] text-2xl">
                📱
              </div>
              <div>
                <h3 class="font-bold text-app-text text-sm">Telegram Bot Synchronization</h3>
                <p id="settings-tg-desc" class="text-xs text-app-text opacity-60 mt-0.5">Link your Telegram account to chat and receive automated digests on mobile.</p>
              </div>
            </div>
            <div id="settings-tg-action">
              <button onclick="generateTelegramLink()" class="px-4 py-2 rounded-xl bg-[#229ED9] hover:bg-[#1e8cc0] text-white text-xs font-bold transition flex items-center gap-2">
                <span>Connect Telegram</span>
              </button>
            </div>
          </div>

          <div id="settings-pairing-box" class="hidden p-4 rounded-xl bg-app-highlight border border-brand-500/30 space-y-3">
            <div class="text-xs font-bold text-brand-500 dark:text-brand-400">⚡ Single-Use Connection Link (10-minute TTL):</div>
            <div class="flex items-center gap-2">
              <input id="pairing-link-input" readonly class="flex-1 bg-app-surface border border-app-border rounded-lg px-3 py-2 text-xs font-mono text-app-text opacity-80" />
              <button onclick="copyPairingLink()" class="px-3 py-2 rounded-lg bg-app-highlight hover:bg-app-highlight/80 text-xs font-semibold text-app-text">Copy</button>
              <a id="pairing-link-open" target="_blank" class="px-3 py-2 rounded-lg bg-[#229ED9] hover:bg-[#1e8cc0] text-xs font-bold text-white">Open in Telegram</a>
            </div>
            <p class="text-[11px] text-app-text opacity-50">Or type <code class="text-brand-500 font-bold">/start</code> in <a id="pairing-bot-link" target="_blank" class="text-sky-500 dark:text-sky-400 underline font-mono">Telegram Bot</a> with this link token.</p>
          </div>
        </div>

        <!-- Notification Policy -->
        <div class="glass-panel rounded-2xl p-6 space-y-4">
          <h3 class="font-bold text-app-text text-sm">Granular Notification Mode</h3>
          <div class="space-y-2">
            <label class="flex items-start gap-3 p-3 rounded-xl bg-app-highlight border border-app-border cursor-pointer hover:border-brand-500/30 transition">
              <input type="radio" name="radio-notify" value="full" onchange="updateNotifyPreference(this.value)" class="mt-1 text-brand-500" checked />
              <div>
                <div class="text-xs font-bold text-app-text">Full Cross-Interaction Mode</div>
                <div class="text-[11px] text-app-text opacity-60">Receive Telegram copies of all answers generated in the web workspace.</div>
              </div>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-xl bg-app-highlight border border-app-border cursor-pointer hover:border-brand-500/30 transition">
              <input type="radio" name="radio-notify" value="digest_only" onchange="updateNotifyPreference(this.value)" class="mt-1 text-brand-500" />
              <div>
                <div class="text-xs font-bold text-app-text">Digest &amp; Alerts Only (Recommended)</div>
                <div class="text-[11px] text-app-text opacity-60">Only receive morning automated task digests (e.g. Remote Job alerts) and reminder alarms on Telegram.</div>
              </div>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-xl bg-app-highlight border border-app-border cursor-pointer hover:border-brand-500/30 transition">
              <input type="radio" name="radio-notify" value="silent" onchange="updateNotifyPreference(this.value)" class="mt-1 text-brand-500" />
              <div>
                <div class="text-xs font-bold text-app-text">Silent History Sync</div>
                <div class="text-[11px] text-app-text opacity-60">Maintain database synchronization without triggering push notifications on Telegram.</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Magic Link Generator -->
        <div class="glass-panel rounded-2xl p-6 space-y-3">
          <h3 class="font-bold text-app-text text-sm">Mobile Magic Login SSO</h3>
          <p class="text-xs text-app-text opacity-60">Generate a one-time login link from your Telegram bot anytime by typing <code class="text-brand-500 font-bold">/web</code> in the bot chat.</p>
        </div>
      </section>

    </main>
  </div>

  <!-- UNIFIED FLOATING BOTTOM NAVIGATION DOCK -->
  <nav id="unified-bottom-nav" class="fixed bottom-0 sm:bottom-4 left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 sm:w-auto z-40 bg-app-bg/95 sm:bg-app-surface/95 backdrop-blur-xl sm:backdrop-blur-2xl border-t sm:border border-app-border px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-around sm:justify-center gap-1 sm:gap-2 shadow-2xl sm:shadow-[0_20px_50px_rgba(0,0,0,0.85)] sm:rounded-2xl">
    <button onclick="switchTab('overview')" id="mobile-nav-btn-overview" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/30 dark:border-brand-500/40 text-[10px] sm:text-xs font-bold transition shadow-sm">
      <span class="text-base sm:text-lg">📊</span>
      <span>Overview</span>
    </button>
    <button onclick="switchTab('chat')" id="mobile-nav-btn-chat" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition">
      <span class="text-base sm:text-lg">💬</span>
      <span>Chat</span>
    </button>
    <button onclick="switchTab('tasks')" id="mobile-nav-btn-tasks" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition relative">
      <span class="text-base sm:text-lg">⚡</span>
      <span>Tasks</span>
      <span id="badge-task-count" class="px-1.5 py-0.2 rounded-full bg-brand-500/20 text-brand-600 dark:text-brand-400 text-[10px] font-bold">0</span>
    </button>
    <button onclick="switchTab('memory')" id="mobile-nav-btn-memory" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition">
      <span class="text-base sm:text-lg">🧠</span>
      <span>Memory</span>
    </button>
    <button onclick="switchTab('reminders')" id="mobile-nav-btn-reminders" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition">
      <span class="text-base sm:text-lg">⏰</span>
      <span>Reminders</span>
    </button>
    <button onclick="switchTab('settings')" id="mobile-nav-btn-settings" class="flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition">
      <span class="text-base sm:text-lg">⚙️</span>
      <span>Sync</span>
    </button>
  </nav>

  <!-- MODALS -->
  <div id="modal-create-task" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="glass-panel rounded-2xl p-6 max-w-lg w-full space-y-4 border border-app-border shadow-2xl">
      <div class="flex items-center justify-between border-b border-app-border pb-3">
        <h3 class="font-bold text-app-text text-base flex items-center gap-2">
          <span>⚡</span>
          <span>Create Autonomous Task</span>
        </h3>
        <button onclick="closeCreateTaskModal()" class="text-app-text opacity-40 hover:opacity-100 text-xl leading-none">&times;</button>
      </div>
      <form onsubmit="handleCreateTaskSubmit(event)" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Task Title</label>
          <input id="task-input-title" required placeholder="e.g., Remote AI Engineer Job Search" class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Execution Goal &amp; Instructions</label>
          <textarea id="task-input-goal" rows="3" required placeholder="e.g., Scan job platforms for remote senior roles paying $160k+ and compile links..." class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none focus:border-brand-500 resize-none"></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Task Category</label>
          <select id="task-input-type" class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text focus:outline-none focus:border-brand-500">
            <option value="research">Web &amp; Intelligence Research</option>
            <option value="job_search">Job &amp; Career Search</option>
            <option value="coding">Software &amp; Coding Analysis</option>
            <option value="general">General Autonomous Task</option>
          </select>
        </div>
        <div id="task-submit-error" class="hidden text-xs text-red-400 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"></div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" onclick="closeCreateTaskModal()" class="px-4 py-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 text-xs font-semibold">Cancel</button>
          <button id="task-btn-submit" type="submit" class="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-lg shadow-brand-600/20">Create Task</button>
        </div>
      </form>
    </div>
  </div>

  <div id="modal-create-memory" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="glass-panel rounded-2xl p-6 max-w-lg w-full space-y-4 border border-app-border shadow-2xl">
      <div class="flex items-center justify-between border-b border-app-border pb-3">
        <h3 class="font-bold text-app-text text-base flex items-center gap-2">
          <span>🧠</span>
          <span>Add Long-Term Memory</span>
        </h3>
        <button onclick="closeCreateMemoryModal()" class="text-app-text opacity-40 hover:opacity-100 text-xl leading-none">&times;</button>
      </div>
      <form onsubmit="handleCreateMemorySubmit(event)" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Key / Topic Name</label>
          <input id="mem-input-key" required placeholder="e.g., preferred_ide, tech_stack, location" class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none focus:border-purple-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Memory Content</label>
          <textarea id="mem-input-content" rows="3" required placeholder="Describe what Wingbuddy should remember about you across sessions..." class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none focus:border-purple-500 resize-none"></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Category</label>
          <select id="mem-input-category" class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text focus:outline-none focus:border-purple-500">
            <option value="preference">User Preference</option>
            <option value="profile">Profile Fact</option>
            <option value="workflow">Workflow &amp; Habits</option>
            <option value="general">General Knowledge</option>
          </select>
        </div>
        <div id="mem-submit-error" class="hidden text-xs text-red-400 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"></div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" onclick="closeCreateMemoryModal()" class="px-4 py-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 text-xs font-semibold">Cancel</button>
          <button id="mem-btn-submit" type="submit" class="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/20">Save Memory</button>
        </div>
      </form>
    </div>
  </div>

  <div id="modal-create-reminder" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="glass-panel rounded-2xl p-6 max-w-lg w-full space-y-4 border border-app-border shadow-2xl">
      <div class="flex items-center justify-between border-b border-app-border pb-3">
        <h3 class="font-bold text-app-text text-base flex items-center gap-2">
          <span>⏰</span>
          <span>Schedule Proactive Reminder</span>
        </h3>
        <button onclick="closeCreateReminderModal()" class="text-app-text opacity-40 hover:opacity-100 text-xl leading-none">&times;</button>
      </div>
      <form onsubmit="handleCreateReminderSubmit(event)" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Reminder Alert Prompt</label>
          <input id="rem-input-prompt" required placeholder="e.g., Review weekly analytics report and sync with team..." class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text placeholder:text-app-text placeholder:opacity-40 focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-app-text opacity-70 mb-1">Remind In</label>
          <select id="rem-input-time" class="w-full bg-app-highlight border border-app-border rounded-xl px-3.5 py-2.5 text-xs text-app-text focus:outline-none focus:border-amber-500">
            <option value="15">In 15 minutes</option>
            <option value="30">In 30 minutes</option>
            <option value="60" selected>In 1 hour</option>
            <option value="180">In 3 hours</option>
            <option value="1440">Tomorrow (24 hours)</option>
          </select>
        </div>
        <div id="rem-submit-error" class="hidden text-xs text-red-400 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"></div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="button" onclick="closeCreateReminderModal()" class="px-4 py-2 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 text-xs font-semibold">Cancel</button>
          <button id="rem-btn-submit" type="submit" class="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-600/20">Schedule Reminder</button>
        </div>
      </form>
    </div>
  </div>

  <div id="modal-edit-persona" class="hidden fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
    <div class="glass-panel rounded-3xl p-6 max-w-2xl w-full space-y-5 border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
      <div class="flex items-center justify-between border-b border-app-border pb-4 shrink-0">
        <div class="flex items-center gap-3">
          <span id="edit-persona-emoji" class="text-2xl">🎭</span>
          <div>
            <h3 class="font-extrabold text-app-text text-base">Edit AI Persona</h3>
            <p id="edit-persona-id-label" class="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 uppercase tracking-widest mt-0.5"></p>
          </div>
        </div>
        <button onclick="closeEditPersonaModal()" class="w-8 h-8 rounded-full bg-app-highlight flex items-center justify-center text-app-text opacity-40 hover:opacity-100 transition">&times;</button>
      </div>
      
      <div class="flex-1 overflow-y-auto pr-1 space-y-4">
        <div>
          <label class="block text-[11px] font-bold text-app-text opacity-50 uppercase tracking-wider mb-2">Display Name</label>
          <input id="edit-persona-name" class="w-full bg-app-highlight border border-app-border rounded-xl px-4 py-3 text-sm text-app-text focus:outline-none focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-[11px] font-bold text-app-text opacity-50 uppercase tracking-wider mb-2">Tagline / Mission</label>
          <input id="edit-persona-tagline" class="w-full bg-app-highlight border border-app-border rounded-xl px-4 py-3 text-sm text-app-text focus:outline-none focus:border-indigo-500 transition" />
        </div>
        <div>
          <label class="block text-[11px] font-bold text-app-text opacity-50 uppercase tracking-wider mb-2">Core System Instructions</label>
          <textarea id="edit-persona-prompt" rows="8" class="w-full bg-app-highlight border border-app-border rounded-xl px-4 py-3 text-sm text-app-text font-mono leading-relaxed focus:outline-none focus:border-indigo-500 transition resize-none"></textarea>
          <p class="text-[10px] text-app-text opacity-40 mt-2">These instructions define the model's identity, tone, and logical constraints.</p>
        </div>
      </div>

      <div id="edit-persona-error" class="hidden p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium"></div>

      <div class="flex items-center justify-end gap-3 pt-2 border-t border-app-border shrink-0">
        <button onclick="closeEditPersonaModal()" class="px-6 py-2.5 rounded-xl bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 text-xs font-bold transition">Cancel</button>
        <button id="btn-save-persona" onclick="savePersonaEdits()" class="px-8 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/20 transition active:scale-95">Save Changes</button>
      </div>
    </div>
  </div>

  <div id="modal-conversations" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="glass-panel rounded-2xl p-5 sm:p-6 max-w-lg w-full space-y-4 border border-app-border shadow-2xl flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between border-b border-app-border pb-3">
        <div class="flex items-center gap-2">
          <span class="text-brand-400 text-lg">💬</span>
          <h3 class="font-bold text-app-text text-base">Conversations History</h3>
        </div>
        <button onclick="closeConversationsDrawer()" class="text-app-text opacity-40 hover:opacity-100 text-xl leading-none">&times;</button>
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-app-text opacity-60" id="conv-count-label">Saved chat threads</span>
        <button onclick="createNewChat(); closeConversationsDrawer();" class="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
          <span>Start New Chat</span>
        </button>
      </div>

      <div id="conversations-list-container" class="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px] max-h-[380px]">
        <div class="text-center py-8 text-app-text opacity-40 text-xs">Loading conversations...</div>
      </div>

      <div class="border-t border-app-border pt-3 flex items-center justify-between">
        <span class="text-[11px] text-app-text opacity-50">Threads persist permanently</span>
        <button type="button" onclick="closeConversationsDrawer()" class="px-4 py-2 rounded-xl bg-app-highlight hover:bg-black/5 dark:hover:bg-white/10 text-app-text opacity-70 text-xs font-semibold">Close</button>
      </div>
    </div>
  </div>

  <!-- SCRIPTS & APPLICATION LOGIC -->
  <script>
    let currentUser = null;
    let sseEventSource = null;
    let currentTab = 'overview';

    // Responsive auto-resize and touch-friendly chat textarea handling
    const textarea = document.getElementById('chat-input');
    if (textarea) {
      const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
      
      // Adapt placeholder dynamically based on device capabilities
      if (!isTouchDevice && window.innerWidth >= 640) {
        textarea.placeholder = "Type a message or task goal... (Shift+Enter for new line)";
      } else {
        textarea.placeholder = "Type a message or task goal...";
      }

      function adjustTextareaHeight() {
        textarea.style.height = 'auto';
        const targetHeight = Math.min(Math.max(textarea.scrollHeight, 50), 160);
        textarea.style.height = targetHeight + 'px';
      }

      textarea.addEventListener('input', adjustTextareaHeight);
      textarea.addEventListener('focus', adjustTextareaHeight);

      textarea.addEventListener('keydown', function(e) {
        // On desktop keyboards (fine pointer), Enter sends and Shift+Enter inserts newline.
        // On mobile touch keyboards (coarse pointer), Enter allows drafting multi-line text naturally, and Send button submits.
        if (e.key === 'Enter') {
          if (!isTouchDevice && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit(e);
          }
        }
      });
    }

    async function initWorkspace() {
      // 1. Check Magic Token in URL query
      const urlParams = new URLSearchParams(window.location.search);
      const magicToken = urlParams.get('magic_token');
      if (magicToken) {
        try {
          const res = await fetch('/api/auth/magic-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: magicToken })
          });
          const data = await res.json();
          if (data.sessionToken) {
            localStorage.setItem('wb_session_token', data.sessionToken);
            localStorage.setItem('wb_user', JSON.stringify(data.user));
            // Remove token from URL
            window.history.replaceState({}, document.title, '/app');
          }
        } catch (err) {
          console.error(err);
        }
      }

      // 2. Validate Session
      let sessionToken = localStorage.getItem('wb_session_token');
      if (!sessionToken) {
        const cookieMatch = document.cookie.match(/(?:^|;\\s*)wb_session_token=([^;]+)/);
        if (cookieMatch) {
          sessionToken = decodeURIComponent(cookieMatch[1]);
          localStorage.setItem('wb_session_token', sessionToken);
        }
      }

      if (!sessionToken) {
        let savedEmail = null;
        try {
          const userStr = localStorage.getItem('wb_user');
          if (userStr) {
            const u = JSON.parse(userStr);
            if (u.email) savedEmail = u.email;
          }
        } catch(e) {}

        if (savedEmail) {
          try {
            const autoRes = await fetch('/api/auth/instant-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: savedEmail })
            });
            const autoData = await autoRes.json();
            if (autoData.sessionToken) {
              sessionToken = autoData.sessionToken;
              localStorage.setItem('wb_session_token', sessionToken);
              localStorage.setItem('wb_user', JSON.stringify(autoData.user));
              document.cookie = 'wb_session_token=' + encodeURIComponent(sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
            }
          } catch (e) {
            console.error('Auto login recovery error:', e);
          }
        }
      }

      if (!sessionToken) {
        window.location.replace('/');
        return;
      }

      try {
        let res = await fetch('/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + sessionToken }
        });
        if (!res.ok) {
          let savedEmail = null;
          try {
            const userStr = localStorage.getItem('wb_user');
            if (userStr) {
              const u = JSON.parse(userStr);
              if (u.email) savedEmail = u.email;
            }
          } catch(e) {}

          if (savedEmail) {
            const refreshRes = await fetch('/api/auth/instant-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: savedEmail })
            });
            const refreshData = await refreshRes.json();
            if (refreshData.sessionToken) {
              sessionToken = refreshData.sessionToken;
              localStorage.setItem('wb_session_token', sessionToken);
              localStorage.setItem('wb_user', JSON.stringify(refreshData.user));
              document.cookie = 'wb_session_token=' + encodeURIComponent(sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
              res = await fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + sessionToken }
              });
            }
          }
        }
        if (!res.ok) {
          localStorage.removeItem('wb_session_token');
          document.cookie = 'wb_session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          window.location.replace('/');
          return;
        }
        document.cookie = 'wb_session_token=' + encodeURIComponent(sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
        const data = await res.json();
        currentUser = data.user;
        renderUserProfile(currentUser);
        applyTheme(currentUser.themePreference || 'system');
        initSSE(sessionToken);
        loadOverview();
        loadConversations();
        loadChatMessages();
        loadTasks();
        loadMemories();
        loadReminders();

        // Handle initial URL hash or tab routing
        const hash = (window.location.hash || '').replace('#', '');
        const validTabs = ['overview', 'chat', 'tasks', 'memory', 'reminders', 'settings'];
        if (validTabs.includes(hash)) {
          switchTab(hash, false);
        } else {
          switchTab('overview', false);
        }
      } catch (err) {
        console.error('Session validation error:', err);
      }
    }

    function renderUserProfile(user) {
      document.getElementById('user-name').innerText = user.name || user.email.split('@')[0];
      document.getElementById('user-email').innerText = user.email;
      if (user.picture) {
        document.getElementById('user-avatar').innerHTML = '<img src="' + user.picture + '" class="w-8 h-8 rounded-full" />';
      } else {
        document.getElementById('user-avatar').innerText = (user.name || user.email)[0].toUpperCase();
      }

      // Admin button
      if (user.role === 'admin') {
        document.getElementById('admin-portal-link').classList.remove('hidden');
        document.getElementById('admin-persona-section').classList.remove('hidden');
        loadAdminPersonas();
      }

      // Telegram Sync Pill
      const dot = document.getElementById('tg-status-dot');
      const text = document.getElementById('tg-status-text');
      const notifySelect = document.getElementById('select-notify-pref');
      if (notifySelect) notifySelect.value = user.notificationPreference || 'full';

      if (user.telegramUserId) {
        dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
        text.innerText = user.telegramUsername ? '@' + user.telegramUsername : 'Synced (' + user.telegramUserId + ')';
        document.getElementById('settings-tg-desc').innerText = 'Connected as ' + (user.telegramUsername ? '@' + user.telegramUsername : user.telegramUserId);
        document.getElementById('settings-tg-action').innerHTML = '<span class="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center gap-1.5">🟢 Connected</span>';
      } else {
        dot.className = 'w-2 h-2 rounded-full bg-amber-400';
        text.innerText = 'Connect Telegram';
      }
    }

    // Theme Management
    let themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    function applyTheme(theme) {
      const html = document.documentElement;
      const isDark = theme === 'dark' || (theme === 'system' && themeMediaQuery.matches);
      
      if (isDark) {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }

      // Update buttons UI
      ['light', 'dark', 'system'].forEach(t => {
        const btn = document.getElementById('theme-btn-' + t);
        if (!btn) return;
        if (t === theme) {
          btn.className = 'px-5 py-2 rounded-xl text-xs font-extrabold bg-brand-500 text-white shadow-md shadow-brand-500/20';
        } else {
          btn.className = 'px-5 py-2 rounded-xl text-xs font-bold text-app-text opacity-50 hover:opacity-100 transition-colors';
        }
      });

      const headerSelect = document.getElementById('header-theme-select');
      if (headerSelect) headerSelect.value = theme;
    }

    // Listen for system theme changes
    themeMediaQuery.addEventListener('change', () => {
      if (currentUser && currentUser.themePreference === 'system') {
        applyTheme('system');
      }
    });

    async function updateTheme(theme) {
      applyTheme(theme);
      if (currentUser) currentUser.themePreference = theme;
      
      const token = localStorage.getItem('wb_session_token');
      try {
        await fetch('/api/user/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ themePreference: theme })
        });
      } catch (err) {
        console.warn('Failed saving theme preference:', err);
      }
    }

    // Admin: Persona Management
    let allPersonas = [];
    let editingPersonaId = null;

    async function loadAdminPersonas() {
      if (currentUser?.role !== 'admin') return;
      const token = localStorage.getItem('wb_session_token');
      const list = document.getElementById('admin-persona-list');
      
      try {
        const res = await fetch('/api/personas', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success) {
          allPersonas = data.personas;
          renderAdminPersonas(allPersonas);
        }
      } catch (err) {
        list.innerHTML = '<div class="text-red-400 text-xs text-center py-4">Failed to load personas registry.</div>';
      }
    }

    function renderAdminPersonas(personas) {
      const list = document.getElementById('admin-persona-list');
      list.innerHTML = '';
      
      personas.forEach(p => {
        const card = document.createElement('div');
        card.className = 'glass-panel rounded-2xl p-5 space-y-4 border ' + (p.enabled ? 'border-app-border' : 'border-red-500/20 opacity-70');
        card.innerHTML = \`
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="text-2xl">${p.emoji}</span>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="font-bold text-app-text text-sm">${escapeHtml(p.name)}</h4>
                  <span class="text-[9px] font-mono text-app-text opacity-50 tracking-tighter uppercase px-1.5 py-0.5 rounded bg-app-highlight">${p.id}</span>
                </div>
                <p class="text-[11px] text-app-text opacity-60 mt-0.5">${escapeHtml(p.tagline)}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="togglePersona('${p.id}', ${!p.enabled})" class="px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${p.enabled ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20'}">
                ${p.enabled ? '🟢 Enabled' : '🔴 Disabled'}
              </button>
              <button onclick="openEditPersonaModal('${p.id}')" class="p-2 rounded-lg bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-60 hover:opacity-100 transition">✏️</button>
            </div>
          </div>
          <div class="p-3 bg-app-highlight rounded-xl border border-app-border">
            <div class="text-[9px] font-bold text-app-text opacity-50 uppercase tracking-widest mb-1.5 flex items-center justify-between">
              <span>System Instructions</span>
              <span class="${p.isBuiltIn ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400'}">${p.isBuiltIn ? 'Built-in' : 'Custom'}</span>
            </div>
            <p class="text-[11px] text-app-text opacity-80 font-mono leading-relaxed line-clamp-3">${escapeHtml(p.systemPrompt)}</p>
          </div>
        \`;
        list.appendChild(card);
      });
    }

    async function togglePersona(id, enabled) {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch(\`/api/personas/\${id}/toggle\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        if (data.success) {
          loadAdminPersonas();
          if (window.toast) window.toast('✓ Persona status updated');
        }
      } catch (err) {
        alert('Failed to toggle persona');
      }
    }

    function openEditPersonaModal(id) {
      const p = allPersonas.find(x => x.id === id);
      if (!p) return;
      
      editingPersonaId = id;
      document.getElementById('edit-persona-id-label').innerText = 'ID: ' + p.id;
      document.getElementById('edit-persona-emoji').innerText = p.emoji;
      document.getElementById('edit-persona-name').value = p.name;
      document.getElementById('edit-persona-tagline').value = p.tagline;
      document.getElementById('edit-persona-prompt').value = p.systemPrompt;
      document.getElementById('edit-persona-error').classList.add('hidden');
      
      document.getElementById('modal-edit-persona').classList.remove('hidden');
    }

    function closeEditPersonaModal() {
      document.getElementById('modal-edit-persona').classList.add('hidden');
      editingPersonaId = null;
    }

    async function savePersonaEdits() {
      if (!editingPersonaId) return;
      const token = localStorage.getItem('wb_session_token');
      const name = document.getElementById('edit-persona-name').value.trim();
      const tagline = document.getElementById('edit-persona-tagline').value.trim();
      const systemPrompt = document.getElementById('edit-persona-prompt').value.trim();
      const btn = document.getElementById('btn-save-persona');
      const errEl = document.getElementById('edit-persona-error');

      if (!name || !systemPrompt) {
        errEl.innerText = 'Name and system instructions are required.';
        errEl.classList.remove('hidden');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Saving...';
      
      try {
        const res = await fetch(\`/api/personas/\${editingPersonaId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ name, tagline, systemPrompt })
        });
        const data = await res.json();
        if (data.success) {
          closeEditPersonaModal();
          loadAdminPersonas();
          if (window.toast) window.toast('✓ Persona changes saved');
        } else {
          throw new Error(data.error || 'Failed to save changes');
        }
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Save Changes';
      }
    }

    const renderedMessageIds = new Set();
    let sseReconnectTimer = null;

    function initSSE(token) {
      if (sseEventSource) {
        try { sseEventSource.close(); } catch(e) {}
      }
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);

      sseEventSource = new EventSource('/api/auth/events?token=' + encodeURIComponent(token));

      sseEventSource.onopen = () => {
        console.log('Realtime workspace event stream connected');
        const dot = document.getElementById('sse-status-dot');
        const text = document.getElementById('sse-status-text');
        if (dot) {
          dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
        }
        if (text) {
          text.innerText = 'Live Event Bus';
        }
      };

      sseEventSource.addEventListener('chat_message', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.data?.action === 'cleared') {
            loadChatMessages();
          } else if (payload.data) {
            removeThinkingIndicator();
            appendMessageToThread(payload.data);
          }
          loadOverview();
        } catch (err) {
          console.error('Failed parsing chat SSE event:', err);
        }
      });

      sseEventSource.addEventListener('telegram_paired', (e) => {
        try {
          const payload = JSON.parse(e.data);
          alert('🎉 Telegram Account Synced Successfully!');
          if (currentUser) {
            currentUser.telegramUserId = payload.data.telegramUserId;
            currentUser.telegramUsername = payload.data.telegramUsername;
            renderUserProfile(currentUser);
          }
          loadOverview();
        } catch (err) {
          console.error('Failed parsing telegram_paired event:', err);
        }
      });

      sseEventSource.onerror = (err) => {
        console.warn('SSE disconnected; reconnecting in 5s...');
        const dot = document.getElementById('sse-status-dot');
        const text = document.getElementById('sse-status-text');
        if (dot) {
          dot.className = 'w-2 h-2 rounded-full bg-rose-500';
        }
        if (text) {
          text.innerText = 'Sync Offline';
        }
        try { sseEventSource.close(); } catch(e) {}
        sseReconnectTimer = setTimeout(() => {
          const currentToken = localStorage.getItem('wb_session_token');
          if (currentToken) initSSE(currentToken);
        }, 5000);
      };
    }

    let currentConversationId = null;
    let conversationsList = [];

    async function loadConversations() {
      const token = localStorage.getItem('wb_session_token');
      if (!token) return;
      try {
        const res = await fetch('/api/user/chat/conversations', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.conversations && Array.isArray(data.conversations)) {
          conversationsList = data.conversations;
          if (!currentConversationId || !conversationsList.some(c => c.id === currentConversationId)) {
            currentConversationId = conversationsList[0]?.id || null;
          }
          const active = conversationsList.find(c => c.id === currentConversationId);
          const activeTitleEl = document.getElementById('active-chat-title');
          if (activeTitleEl) {
            activeTitleEl.textContent = active?.title || 'New Chat';
          }
          renderConversationsList();
        }
      } catch (err) {
        console.error('Failed loading conversations:', err);
      }
    }

    function renderConversationsList() {
      const container = document.getElementById('conversations-list-container');
      const countLabel = document.getElementById('conv-count-label');
      if (!container) return;
      if (countLabel) {
        countLabel.textContent = conversationsList.length + ' conversation thread' + (conversationsList.length === 1 ? '' : 's');
      }

      if (conversationsList.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-app-text opacity-50 text-xs">No saved conversations yet. Click "Start New Chat" above.</div>';
        return;
      }

      container.innerHTML = conversationsList.map(c => {
        const isActive = c.id === currentConversationId;
        const timeStr = new Date(c.updatedAt || c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const snippet = c.lastMessageSnippet ? escapeHtml(c.lastMessageSnippet) : 'No messages yet';
        
        return \`
          <div onclick="switchConversation(${c.id})" class="group cursor-pointer p-3 rounded-xl border transition flex items-center justify-between gap-3 ${isActive ? 'bg-brand-500/10 dark:bg-brand-600/20 border-brand-500/30 dark:border-brand-500/40 text-app-text shadow-sm' : 'bg-app-highlight border-app-border text-app-text opacity-70 hover:opacity-100 hover:bg-app-highlight/80'}">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${isActive ? 'bg-brand-500 text-white' : 'bg-app-highlight text-app-text opacity-50 group-hover:opacity-100'}">
                💬
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h4 class="font-bold text-xs truncate ${isActive ? 'text-brand-600 dark:text-brand-300 font-extrabold' : 'text-app-text'}">${escapeHtml(c.title || 'New Chat')}</h4>
                  ${isActive ? '<span class="px-1.5 py-0.2 text-[9px] font-mono font-bold rounded bg-brand-500/20 text-brand-600 dark:text-brand-300 border border-brand-500/30 dark:border-brand-500/40">ACTIVE</span>' : ''}
                </div>
                <p class="text-[11px] text-app-text opacity-50 truncate mt-0.5">${snippet}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[10px] text-app-text opacity-40 font-mono hidden sm:inline-block">${timeStr}</span>
              <button onclick="deleteConversation(${c.id}, event)" class="p-1.5 rounded-lg text-app-text opacity-40 hover:opacity-100 hover:text-red-500 transition cursor-pointer" title="Delete this conversation">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function openConversationsDrawer() {
      loadConversations();
      const modal = document.getElementById('modal-conversations');
      if (modal) modal.classList.remove('hidden');
    }

    function closeConversationsDrawer() {
      const modal = document.getElementById('modal-conversations');
      if (modal) modal.classList.add('hidden');
    }

    async function switchConversation(convId) {
      if (currentConversationId === convId) {
        closeConversationsDrawer();
        return;
      }
      currentConversationId = convId;
      const active = conversationsList.find(c => c.id === convId);
      const activeTitleEl = document.getElementById('active-chat-title');
      if (activeTitleEl) {
        activeTitleEl.textContent = active?.title || 'New Chat';
      }
      closeConversationsDrawer();
      renderConversationsList();
      await loadChatMessages(convId);
    }

    async function createNewChat() {
      const token = localStorage.getItem('wb_session_token');
      if (!token) return;
      try {
        const res = await fetch('/api/user/chat/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ title: 'New Chat' })
        });
        const data = await res.json();
        if (data.conversation) {
          currentConversationId = data.conversation.id;
          const activeTitleEl = document.getElementById('active-chat-title');
          if (activeTitleEl) activeTitleEl.textContent = 'New Chat';
          
          const thread = document.getElementById('chat-thread');
          if (thread) {
            thread.innerHTML = '<div id="chat-empty-state" class="text-center py-12 text-app-text opacity-50 text-xs"><div class="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center text-xl mx-auto mb-3">⚡</div><div class="font-bold text-app-text opacity-80 text-sm mb-1">Wingbuddy Workspace Ready</div><p>Ask anything, plan autonomous tasks, or sync with your Telegram bot.</p></div>';
          }
          renderedMessageIds.clear();
          await loadConversations();
          
          const input = document.getElementById('chat-input');
          if (input) input.focus();
        }
      } catch (err) {
        console.error('Failed creating new chat:', err);
      }
    }

    async function deleteConversation(convId, event) {
      if (event) event.stopPropagation();
      if (!confirm('Delete this conversation and all its messages?')) return;
      
      const token = localStorage.getItem('wb_session_token');
      if (!token) return;
      try {
        const res = await fetch('/api/user/chat/conversations/' + convId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.activeConversationId) {
          currentConversationId = data.activeConversationId;
        }
        await loadConversations();
        await loadChatMessages(currentConversationId);
      } catch (err) {
        console.error('Failed deleting conversation:', err);
      }
    }

    async function deleteCurrentChat() {
      if (currentConversationId) {
        await deleteConversation(currentConversationId);
      }
    }

    async function loadChatMessages(targetConvId) {
      const token = localStorage.getItem('wb_session_token');
      const convId = targetConvId || currentConversationId;
      try {
        const url = convId ? '/api/user/chat/messages?conversationId=' + convId : '/api/user/chat/messages';
        const res = await fetch(url, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.conversationId && !currentConversationId) {
          currentConversationId = data.conversationId;
        }
        const thread = document.getElementById('chat-thread');
        thread.innerHTML = '';
        renderedMessageIds.clear();

        if (!data.messages || data.messages.length === 0) {
          thread.innerHTML = '<div id="chat-empty-state" class="text-center py-12 text-app-text opacity-50 text-xs"><div class="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center text-xl mx-auto mb-3">⚡</div><div class="font-bold text-app-text opacity-80 text-sm mb-1">Wingbuddy Workspace Ready</div><p>Ask anything, plan autonomous tasks, or sync with your Telegram bot.</p></div>';
          return;
        }

        data.messages.forEach(m => appendMessageToThread(m, false));
        thread.scrollTop = thread.scrollHeight;
      } catch (err) {
        console.error('Failed loading chat messages:', err);
      }
    }

    function showThinkingIndicator() {
      const thread = document.getElementById('chat-thread');
      if (document.getElementById('chat-thinking-bubble')) return;
      const emptyState = document.getElementById('chat-empty-state');
      if (emptyState) emptyState.remove();

      const bubble = document.createElement('div');
      bubble.id = 'chat-thinking-bubble';
      bubble.className = 'flex justify-start';
      bubble.innerHTML = \`
        <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 chat-bubble-ai rounded-tl-sm space-y-2 shadow-md border border-brand-500/20 bg-app-surface/90">
          <div class="flex items-center gap-2 text-[10px] text-brand-400 font-semibold tracking-wide uppercase">
            <span class="inline-block w-2 h-2 rounded-full bg-brand-400 animate-ping"></span>
            <span>Wingbuddy is thinking...</span>
          </div>
          <div class="flex items-center gap-1.5 py-1">
            <span class="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-2 h-2 rounded-full bg-brand-400/80 animate-bounce" style="animation-delay: 300ms"></span>
          </div>
        </div>
      \`;
      thread.appendChild(bubble);
      thread.scrollTop = thread.scrollHeight;
    }

    function removeThinkingIndicator() {
      const bubble = document.getElementById('chat-thinking-bubble');
      if (bubble) bubble.remove();
    }

    function appendMessageToThread(msg, shouldScroll = true) {
      if (!msg) return;
      const isUser = msg.role === 'user';
      const msgIdStr = msg.id != null ? String(msg.id) : null;
      const clientMsgId = msg.clientMsgId != null ? String(msg.clientMsgId) : null;

      // 1. Direct ID deduplication
      if (msgIdStr && renderedMessageIds.has(msgIdStr)) return;
      if (clientMsgId && renderedMessageIds.has(clientMsgId)) return;

      const thread = document.getElementById('chat-thread');
      if (!thread) return;

      // 2. Reconcile optimistic user bubble with incoming authoritative user message
      if (isUser && !msg.isOptimistic) {
        let existingOptimistic = null;
        if (clientMsgId) {
          existingOptimistic = thread.querySelector('[data-client-msg-id="' + clientMsgId + '"]');
        }
        if (!existingOptimistic) {
          const optimisticNodes = thread.querySelectorAll('[data-optimistic="true"]');
          for (const node of optimisticNodes) {
            if (node.dataset.content === msg.content) {
              existingOptimistic = node;
              break;
            }
          }
        }

        if (existingOptimistic) {
          existingOptimistic.dataset.optimistic = 'false';
          if (msgIdStr) {
            existingOptimistic.dataset.msgId = msgIdStr;
            renderedMessageIds.add(msgIdStr);
          }
          if (clientMsgId) {
            renderedMessageIds.add(clientMsgId);
          }
          return;
        }
      }

      // 3. Prevent duplicate assistant/model messages with identical content in short succession
      if (!isUser && msg.content) {
        const lastMsgBubble = thread.lastElementChild;
        if (lastMsgBubble && lastMsgBubble.dataset.role === 'model' && lastMsgBubble.dataset.content === msg.content) {
          if (msgIdStr) renderedMessageIds.add(msgIdStr);
          return;
        }
      }

      if (msgIdStr) renderedMessageIds.add(msgIdStr);
      if (clientMsgId) renderedMessageIds.add(clientMsgId);

      const emptyState = document.getElementById('chat-empty-state');
      if (emptyState) emptyState.remove();

      const bubble = document.createElement('div');
      bubble.className = 'flex ' + (isUser ? 'justify-end' : 'justify-start');
      bubble.dataset.role = msg.role;
      bubble.dataset.content = msg.content || '';
      if (msgIdStr) bubble.dataset.msgId = msgIdStr;
      if (clientMsgId) bubble.dataset.clientMsgId = clientMsgId;
      if (msg.isOptimistic) bubble.dataset.optimistic = 'true';

      let sourceBadge = '';
      if (msg.source === 'telegram_voice') {
        sourceBadge = '<span class="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-mono">🎙️ TG Voice</span>';
      } else if (msg.source === 'telegram') {
        sourceBadge = '<span class="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[9px] font-mono">📱 Telegram</span>';
      } else {
        sourceBadge = '<span class="px-1.5 py-0.2 rounded bg-app-highlight text-app-text opacity-70 text-[9px] font-mono">💻 Web</span>';
      }

      const formattedContent = isUser ? escapeHtml(msg.content) : (typeof marked !== 'undefined' ? marked.parse(msg.content || '') : escapeHtml(msg.content || ''));

      bubble.innerHTML = \`
        <div class="max-w-[88%] sm:max-w-[75%] rounded-2xl p-4 \${isUser ? 'chat-bubble-user rounded-tr-sm' : 'chat-bubble-ai rounded-tl-sm'} space-y-1.5 shadow-md break-words">
          <div class="flex items-center justify-between gap-3 text-[10px] opacity-75 font-semibold">
            <span>\${isUser ? 'YOU' : 'WINGBUDDY AI'}</span>
            <div class="flex items-center gap-1.5">
              \${sourceBadge}
              <span>\${new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <div class="text-sm leading-relaxed prose prose-invert max-w-none break-words">\${formattedContent}</div>
        </div>
      \`;

      // If this is an AI reply, ensure we remove the thinking placeholder first
      if (!isUser) {
        removeThinkingIndicator();
      }

      thread.appendChild(bubble);
      if (shouldScroll) thread.scrollTop = thread.scrollHeight;
    }

    let isSubmittingChat = false;

    async function handleChatSubmit(e) {
      if (e) e.preventDefault();
      if (isSubmittingChat) return;

      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('chat-send-btn');
      const content = input ? input.value.trim() : '';
      if (!content) return;

      isSubmittingChat = true;
      input.value = '';
      input.style.height = 'auto';

      // Generate clientMsgId for deterministic optimistic reconciliation
      const clientMsgId = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

      // Optimistically append user message
      appendMessageToThread({
        id: clientMsgId,
        clientMsgId: clientMsgId,
        isOptimistic: true,
        role: 'user',
        content,
        source: 'web',
        createdAt: new Date()
      }, true);

      // Show thinking bubble & disable send button during inference
      showThinkingIndicator();
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
        sendBtn.innerHTML = '<span>Thinking...</span>';
      }

      let token = localStorage.getItem('wb_session_token');
      if (!token) {
        window.location.replace('/');
        return;
      }

      try {
        let res = await fetch('/api/user/chat/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ content, clientMsgId, conversationId: currentConversationId })
        });

        if (res.status === 401) {
          localStorage.removeItem('wb_session_token');
          window.location.replace('/');
          return;
        }

        const data = await res.json();
        removeThinkingIndicator();

        if (res.ok && data.assistantMessage) {
          appendMessageToThread(data.assistantMessage, true);
          if (data.conversationId) currentConversationId = data.conversationId;
          if (data.conversationTitle) {
            const activeTitleEl = document.getElementById('active-chat-title');
            if (activeTitleEl) activeTitleEl.textContent = data.conversationTitle;
          }
          loadConversations();
        } else if (!res.ok || data.error) {
          appendMessageToThread({
            id: 'err-' + Date.now(),
            role: 'model',
            content: '⚠️ **Error Processing Request:** ' + (data.error || 'The server encountered an unexpected error.'),
            source: 'web',
            createdAt: new Date()
          }, true);
        }
      } catch (err) {
        console.error('Send failed:', err);
        removeThinkingIndicator();
        appendMessageToThread({
          id: 'err-' + Date.now(),
          role: 'model',
          content: '⚠️ **Network connection error.** Please check your internet connection and retry.',
          source: 'web',
          createdAt: new Date()
        }, true);
      } finally {
        isSubmittingChat = false;
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          sendBtn.innerHTML = '<span>Send</span>';
        }
        if (input) input.focus();
      }
    }

    async function clearChatHistory() {
      if (!confirm('Clear all messages in this conversation thread?')) return;
      const token = localStorage.getItem('wb_session_token');
      try {
        const url = currentConversationId ? '/api/user/chat/clear?conversationId=' + currentConversationId : '/api/user/chat/clear';
        await fetch(url, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const thread = document.getElementById('chat-thread');
        thread.innerHTML = '<div id="chat-empty-state" class="text-center py-12 text-app-text opacity-50 text-xs"><div class="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center text-xl mx-auto mb-3">⚡</div><div class="font-bold text-app-text opacity-80 text-sm mb-1">Wingbuddy Workspace Ready</div><p>Ask anything, plan autonomous tasks, or sync with your Telegram bot.</p></div>';
        renderedMessageIds.clear();
        await loadConversations();
      } catch (err) {
        console.error('Failed clearing chat:', err);
      }
    }

    function sendQuickPrompt(promptText) {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = promptText;
        handleChatSubmit(null);
      }
    }

    async function clearChatHistory() {
      if (!confirm('Are you sure you want to clear your conversation history?')) return;
      const token = localStorage.getItem('wb_session_token');
      await fetch('/api/user/chat/clear', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      renderedMessageIds.clear();
      loadChatMessages();
    }

    // Tasks Management
    async function loadTasks() {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch('/api/user/tasks', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        const list = document.getElementById('tasks-list');
        list.innerHTML = '';

        if (!data.tasks || data.tasks.length === 0) {
          list.innerHTML = '<div class="glass-panel rounded-2xl p-8 text-center text-app-text opacity-50 text-xs">No autonomous tasks created yet. Click "+ Create Task" to automate recurring research or workflows.</div>';
          return;
        }

        document.getElementById('badge-task-count').innerText = data.tasks.length;

        data.tasks.forEach(task => {
          const card = document.createElement('div');
          card.className = 'glass-panel rounded-2xl p-5 space-y-3';
          card.innerHTML = \`
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <span class="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-500 dark:text-brand-400 flex items-center justify-center font-bold text-sm">⚡</span>
                <div>
                  <h3 class="font-bold text-app-text text-sm">${escapeHtml(task.title)} <span class="text-app-text opacity-40 text-xs font-mono font-normal">#${task.id}</span></h3>
                  <p class="text-xs text-app-text opacity-60 mt-0.5">${escapeHtml(task.goal)}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${task.status === 'active' ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400' : 'bg-app-highlight text-app-text opacity-50'}">${task.status}</span>
                <button onclick="runTaskNow('${task.id}')" class="px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition flex items-center gap-1">
                  <span>⚡ Run Now</span>
                </button>
              </div>
            </div>
            \${task.steps && task.steps.length > 0 ? \`
              <div class="pt-2 border-t border-app-border space-y-1.5">
                <div class="text-[11px] font-bold text-app-text opacity-50">Execution Plan Steps:</div>
                \${task.steps.map(s => \`
                  <div class="flex items-center justify-between text-xs py-1 px-2 rounded bg-app-highlight">
                    <span class="text-app-text opacity-80">${s.step_order}. ${escapeHtml(s.title)}</span>
                    <span class="text-[10px] font-mono text-app-text opacity-40">${s.status}</span>
                  </div>
                \`).join('')}
              </div>
            \` : ''}
          \`;
          list.appendChild(card);
        });
      } catch (err) {
        console.error('Failed loading tasks:', err);
      }
    }

    async function runTaskNow(taskId) {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch('/api/user/tasks/' + taskId + '/run', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        alert(data.message || 'Task execution triggered!');
        loadTasks();
      } catch (err) {
        alert('Failed triggering task');
      }
    }

    // Memories Management
    async function loadMemories() {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch('/api/user/memories', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        let data;
        const contentType = res.headers.get('content-type') || '';
        if (res.status === 429 || !contentType.includes('application/json')) {
          const text = await res.text();
          const errorMsg = text.includes('Rate exceeded') ? 'Rate limit exceeded. Please try again shortly.' : 'Unable to parse server response.';
          throw new Error(errorMsg);
        } else {
          data = await res.json();
        }

        const list = document.getElementById('memory-list');
        list.innerHTML = '';

        if (!data.memories || data.memories.length === 0) {
          list.innerHTML = '<div class="glass-panel col-span-2 rounded-2xl p-8 text-center text-app-text opacity-50 text-xs">No memories recorded yet. Wingbuddy automatically learns facts as you chat or you can manually add facts.</div>';
          return;
        }

        data.memories.forEach(mem => {
          const card = document.createElement('div');
          card.className = 'glass-panel rounded-2xl p-4 space-y-2';
          card.innerHTML = \`
            <div class="flex items-center justify-between text-xs">
              <span class="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-600 dark:text-purple-300 font-bold uppercase text-[10px]">${escapeHtml(mem.category || 'general')}</span>
              <button onclick="deleteMemory('${encodeURIComponent(mem.key)}')" class="text-app-text opacity-40 hover:opacity-100 hover:text-red-500 transition text-[11px]">Delete</button>
            </div>
            <div class="font-bold text-app-text text-xs font-mono">${escapeHtml(mem.key)}</div>
            <p class="text-xs text-app-text opacity-70 leading-relaxed">\${escapeHtml(mem.content)}</p>
          \`;
          list.appendChild(card);
        });
      } catch (err) {
        console.error('Failed loading memories:', err);
        const list = document.getElementById('memory-list');
        if (list) {
          list.innerHTML = \`<div class="glass-panel col-span-2 rounded-2xl p-8 text-center text-red-400/90 text-xs">⚠️ Failed loading memories: \${escapeHtml(err.message || err)}</div>\`;
        }
      }
    }

    async function deleteMemory(key) {
      if (!confirm('Delete this memory item?')) return;
      const token = localStorage.getItem('wb_session_token');
      await fetch('/api/user/memories/' + key, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      loadMemories();
    }

    // Reminders Management
    async function loadReminders() {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch('/api/user/reminders', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        const list = document.getElementById('reminders-list');
        list.innerHTML = '';

        if (!data.reminders || data.reminders.length === 0) {
          list.innerHTML = '<div class="glass-panel rounded-2xl p-8 text-center text-app-text opacity-50 text-xs">No active reminders. Tell Wingbuddy "Remind me to..." anytime in chat.</div>';
          return;
        }

        data.reminders.forEach(rem => {
          const card = document.createElement('div');
          card.className = 'glass-panel rounded-2xl p-4 flex items-center justify-between';
          card.innerHTML = \`
            <div class="space-y-1">
              <div class="text-xs font-bold text-app-text">${escapeHtml(rem.prompt)}</div>
              <div class="text-[11px] text-app-text opacity-50 font-mono">Due: ${new Date(rem.due_at).toLocaleString()}</div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="snoozeReminder('${rem.id}', 60)" class="px-2.5 py-1 rounded-lg bg-app-highlight hover:bg-app-highlight/80 text-xs text-app-text opacity-80">+1h</button>
              <button onclick="completeReminder('${rem.id}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white">Done</button>
            </div>
          \`;
          list.appendChild(card);
        });
      } catch (err) {
        console.error('Failed loading reminders:', err);
      }
    }

    async function snoozeReminder(id, minutes) {
      const token = localStorage.getItem('wb_session_token');
      await fetch('/api/user/reminders/' + id + '/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ minutes })
      });
      loadReminders();
    }

    async function completeReminder(id) {
      const token = localStorage.getItem('wb_session_token');
      await fetch('/api/user/reminders/' + id + '/complete', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      loadReminders();
    }

    // Authoritative Zero-Fallback Overview Dashboard
    let lastOverviewFetchTime = null;
    let overviewTimerInterval = null;

    function formatRelativeSeconds(timestamp) {
      if (!timestamp) return 'just now';
      const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      if (sec < 5) return 'just now';
      if (sec < 60) return sec + 's ago';
      const min = Math.floor(sec / 60);
      if (min < 60) return min + 'm ago';
      const hrs = Math.floor(min / 60);
      return hrs + 'h ago';
    }

    function updateOverviewTimestamp() {
      const el = document.getElementById('ov-last-updated-text');
      if (el && lastOverviewFetchTime) {
        el.innerText = 'Updated ' + formatRelativeSeconds(lastOverviewFetchTime);
      }
    }

    async function loadOverview(manual = false) {
      const token = localStorage.getItem('wb_session_token');
      if (!token) return;

      const refreshBtn = document.getElementById('ov-btn-refresh');
      if (manual && refreshBtn) {
        refreshBtn.classList.add('opacity-50', 'pointer-events-none');
        refreshBtn.innerHTML = '<span>⏳</span> <span class="hidden sm:inline">Refreshing...</span>';
      }

      try {
        const res = await fetch('/api/user/overview', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        lastOverviewFetchTime = Date.now();
        updateOverviewTimestamp();
        if (!overviewTimerInterval) {
          overviewTimerInterval = setInterval(updateOverviewTimestamp, 2000);
        }

        // 1. User & Profile Card
        const u = data.user || currentUser || {};
        const displayName = u.displayName || u.preferredName || null;
        const greeting = u.greeting || 'Hey 👋';
        const userEmail = u.email || 'user@example.com';
        const userId = u.id || u.telegramUserId || '—';

        const nameEl = document.getElementById('ov-user-name');
        if (nameEl) nameEl.innerText = displayName ? displayName : greeting;

        const profNameEl = document.getElementById('ov-profile-name');
        if (profNameEl) profNameEl.innerText = displayName ? displayName : (u.hasName ? 'User' : 'No name set');

        const profEmailEl = document.getElementById('ov-profile-email');
        if (profEmailEl) profEmailEl.innerText = userEmail;

        const profIdEl = document.getElementById('ov-profile-id');
        if (profIdEl) profIdEl.innerText = '#' + userId;

        const prefNameInput = document.getElementById('settings-pref-name-input');
        if (prefNameInput && u.preferredName !== undefined && document.activeElement !== prefNameInput) {
          prefNameInput.value = u.preferredName || '';
        }

        const resolvedDispEl = document.getElementById('settings-resolved-display-name');
        if (resolvedDispEl) resolvedDispEl.innerText = displayName ? displayName : 'None (Greets plainly: "Hey 👋")';

        const nameSrcEl = document.getElementById('settings-name-source-label');
        if (nameSrcEl) {
          nameSrcEl.innerText = u.nameSource ? (u.nameSource === 'user' ? '👤 User Set' : u.nameSource === 'telegram' ? '📱 Telegram Import' : '🌐 Google OAuth') : 'None';
        }

        const avatarEl = document.getElementById('ov-profile-avatar');
        if (avatarEl) {
          if (u.picture) {
            avatarEl.innerHTML = '<img src="' + escapeHtml(u.picture) + '" class="w-12 h-12 rounded-2xl object-cover" />';
          } else {
            const initial = displayName ? displayName[0].toUpperCase() : '?';
            avatarEl.innerText = initial;
          }
        }

        // 2. Telegram Synchronization (Truthful zero-fallback state)
        const tg = data.telegram || {};
        const isPaired = Boolean(tg.isPaired);
        const tgBadge = document.getElementById('ov-tg-badge');
        const tgTitle = document.getElementById('ov-tg-title');
        const tgSubtitle = document.getElementById('ov-tg-subtitle');
        const tgAction = document.getElementById('ov-tg-action-container');
        const btnTgSync = document.getElementById('ov-btn-tg-sync');

        if (isPaired) {
          const handle = tg.telegramUsername ? '@' + tg.telegramUsername : 'ID: ' + tg.telegramUserId;
          if (tgBadge) tgBadge.innerHTML = '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🟢 Synced &amp; Active</span>';
          if (tgTitle) tgTitle.innerText = 'Telegram Linked (' + handle + ')';
          if (tgSubtitle) tgSubtitle.innerText = 'Real-time bidirectional message and alert mirroring active.';
          if (tgAction) tgAction.innerHTML = '<button onclick="openTelegramSettings()" class="px-3 py-1.5 rounded-lg bg-app-highlight hover:bg-app-highlight/80 text-app-text opacity-70 hover:opacity-100 text-xs font-semibold border border-app-border transition">Sync Settings</button>';
          if (btnTgSync) btnTgSync.classList.add('hidden');
        } else {
          if (tgBadge) tgBadge.innerHTML = '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">🟡 Telegram Not Connected</span>';
          if (tgTitle) tgTitle.innerText = 'Telegram Bot Unpaired';
          if (tgSubtitle) tgSubtitle.innerText = 'Connect your Telegram account to chat on mobile and receive morning alerts.';
          if (tgAction) tgAction.innerHTML = '<button onclick="openTelegramSyncModal()" class="px-3.5 py-1.5 rounded-lg bg-[#229ED9] hover:bg-[#1e8cc0] text-white text-xs font-bold transition shadow-sm">Connect Telegram</button>';
          if (btnTgSync) btnTgSync.classList.remove('hidden');
        }

        // 3. Agent Telemetry & Router Health
        const agent = data.agent || {};
        const dot = document.getElementById('ov-agent-dot');
        const label = document.getElementById('ov-agent-status-label');
        const pill = document.getElementById('ov-agent-status-pill');
        const modelName = document.getElementById('ov-agent-model-name');
        const keyPool = document.getElementById('ov-agent-key-pool');

        if (modelName) modelName.innerText = agent.activeModel || 'Gemini 3.1 Flash Lite';
        if (keyPool) keyPool.innerText = (agent.healthyKeys ?? '—') + '/' + (agent.totalKeys ?? '—') + ' keys healthy';

        if (agent.status === 'online') {
          if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
          if (label) label.innerText = agent.statusLabel || 'Agent Online • Ready';
          if (pill) {
            pill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
            pill.innerText = 'Online';
          }
        } else if (agent.status === 'degraded') {
          if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
          if (label) label.innerText = agent.statusLabel || 'Degraded • Key Cooldown';
          if (pill) {
            pill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
            pill.innerText = 'Degraded';
          }
        } else {
          if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-red-400';
          if (label) label.innerText = agent.statusLabel || 'Provider Offline';
          if (pill) {
            pill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold tracking-wide uppercase bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20';
            pill.innerText = 'Offline';
          }
        }

        // 4. Metrics (Strict zero-fallback numbers from DB queries)
        const m = data.metrics || {};
        
        // Memory count
        const memCount = m.memories?.count ?? 0;
        const memEl = document.getElementById('ov-metric-memories');
        const memSubEl = document.getElementById('ov-metric-memories-sub');
        if (memEl) memEl.innerText = memCount;
        if (memSubEl) memSubEl.innerText = memCount === 0 ? 'No memories indexed yet' : (memCount === 1 ? '1 context fact retained' : memCount + ' context facts retained');

        // Tasks count
        const taskActive = m.tasks?.active ?? 0;
        const taskTotal = m.tasks?.total ?? 0;
        const taskEl = document.getElementById('ov-metric-tasks');
        const taskSubEl = document.getElementById('ov-metric-tasks-sub');
        if (taskEl) taskEl.innerText = taskActive;
        if (taskSubEl) taskSubEl.innerText = taskTotal === 0 ? 'No scheduled tasks' : (taskActive + ' active • ' + taskTotal + ' total');

        // Reminders count
        const remPending = m.reminders?.pending ?? 0;
        const remTotal = m.reminders?.total ?? 0;
        const remEl = document.getElementById('ov-metric-reminders');
        const remSubEl = document.getElementById('ov-metric-reminders-sub');
        if (remEl) remEl.innerText = remPending;
        if (remSubEl) remSubEl.innerText = remTotal === 0 ? 'No reminders scheduled' : (remPending + ' pending • ' + remTotal + ' total');

        // Messages count
        const msgTotal = m.messages?.total ?? 0;
        const msgEl = document.getElementById('ov-metric-messages');
        const msgSubEl = document.getElementById('ov-metric-messages-sub');
        if (msgEl) msgEl.innerText = msgTotal;
        if (msgSubEl) msgSubEl.innerText = msgTotal === 0 ? 'No messages exchanged yet' : (msgTotal === 1 ? '1 message in database' : msgTotal + ' messages in database');

        // Quota Card (Only show if DB row exists)
        const qCard = document.getElementById('ov-quota-card');
        if (m.quota) {
          if (qCard) qCard.classList.remove('hidden');
          const qTier = document.getElementById('ov-quota-tier');
          const qUsed = document.getElementById('ov-quota-used');
          const qLimit = document.getElementById('ov-quota-limit');
          const qRem = document.getElementById('ov-quota-remaining');
          if (qTier) {
            qTier.innerText = m.quota.tier || 'Free';
            qTier.className = 'px-2 py-0.2 rounded-full bg-brand-500/20 text-brand-600 dark:text-brand-300 text-[10px] uppercase font-bold';
          }
          if (qUsed) qUsed.innerText = m.quota.requestsToday ?? 0;
          if (qLimit) qLimit.innerText = m.quota.dailyQuota ?? 50;
          if (qRem) qRem.innerText = m.quota.remaining ?? 50;
        } else {
          if (qCard) qCard.classList.add('hidden');
        }

        // 5. Recent Tasks (Real DB rows)
        const tasksList = document.getElementById('ov-recent-tasks-list');
        if (tasksList) {
          const rows = data.recentTasks || [];
          if (rows.length === 0) {
            tasksList.innerHTML = '<div class="p-4 rounded-xl bg-app-highlight text-center text-app-text opacity-40 text-xs">No autonomous tasks created yet. Click "+ Create Task" to start automated research or digests.</div>';
          } else {
            tasksList.innerHTML = rows.map(t => \`
              <div class="p-3 rounded-xl bg-app-highlight border border-app-border flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-app-text text-xs truncate">${escapeHtml(t.title)}</div>
                  <div class="text-[11px] text-app-text opacity-50 truncate mt-0.5">${escapeHtml(t.goal)}</div>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 \${t.status === 'active' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-app-highlight text-app-text opacity-50'}">\${escapeHtml(t.status)}</span>
              </div>
            \`).join('');
          }
        }

        // 6. Recent Memories (Real DB rows)
        const memList = document.getElementById('ov-recent-memories-list');
        if (memList) {
          const rows = data.recentMemories || [];
          if (rows.length === 0) {
            memList.innerHTML = '<div class="p-4 rounded-xl bg-app-highlight text-center text-app-text opacity-40 text-xs">No memories stored in context vault yet. Chat with Wingbuddy to retain long-term facts.</div>';
          } else {
            memList.innerHTML = rows.map(m => \`
              <div class="p-3 rounded-xl bg-app-highlight border border-app-border flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-app-text text-xs truncate">${escapeHtml(m.key)}</div>
                  <div class="text-[11px] text-app-text opacity-50 truncate mt-0.5">${escapeHtml(m.content)}</div>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-600 dark:text-purple-300 uppercase shrink-0">\${escapeHtml(m.category || 'general')}</span>
              </div>
            \`).join('');
          }
        }

      } catch (err) {
        console.error('Failed fetching overview:', err);
        const lastUp = document.getElementById('ov-last-updated-text');
        if (lastUp) lastUp.innerText = 'Telemetry sync failed';
      } finally {
        if (manual && refreshBtn) {
          refreshBtn.classList.remove('opacity-50', 'pointer-events-none');
          refreshBtn.innerHTML = '<span>🔄</span> <span class="hidden sm:inline">Refresh</span>';
        }
      }
    }

    async function savePreferredNameSettings() {
      const input = document.getElementById('settings-pref-name-input');
      const feedback = document.getElementById('settings-name-feedback');
      if (!input || !feedback) return;

      const newName = input.value.trim();
      feedback.classList.remove('hidden', 'text-emerald-400', 'text-rose-400');
      feedback.classList.add('text-app-text', 'opacity-50');
      feedback.innerText = 'Saving preferred name...';

      try {
        const token = localStorage.getItem('wb_session_token');
        const res = await fetch('/api/user/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ preferredName: newName })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          feedback.classList.remove('text-app-text', 'opacity-50');
          feedback.classList.add('text-rose-400');
          feedback.innerText = data.error || 'Failed to save name.';
          return;
        }

        feedback.classList.remove('text-app-text', 'opacity-50');
        feedback.classList.add('text-emerald-400');
        feedback.innerText = '✅ Preferred name updated to ' + (data.preferredName || newName || 'None') + '!';
        loadOverview(true);
      } catch (err) {
        feedback.classList.remove('text-app-text', 'opacity-50');
        feedback.classList.add('text-rose-400');
        feedback.innerText = 'Network error saving preferred name.';
      }
    }

    function sendQuickPromptAndOpenChat(promptText) {
      switchTab('chat');
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = promptText;
        input.focus();
      }
    }

    // Modal Control: Tasks
    function openCreateTaskModal() {
      const modal = document.getElementById('modal-create-task');
      if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('task-input-title')?.focus();
      }
    }
    function closeCreateTaskModal() {
      const modal = document.getElementById('modal-create-task');
      if (modal) modal.classList.add('hidden');
      const errEl = document.getElementById('task-submit-error');
      if (errEl) errEl.classList.add('hidden');
    }
    async function handleCreateTaskSubmit(event) {
      event.preventDefault();
      const token = localStorage.getItem('wb_session_token');
      const title = document.getElementById('task-input-title').value.trim();
      const goal = document.getElementById('task-input-goal').value.trim();
      const taskType = document.getElementById('task-input-type').value;
      const btn = document.getElementById('task-btn-submit');
      const errEl = document.getElementById('task-submit-error');

      if (!title || !goal) return;
      btn.disabled = true;
      btn.innerText = 'Creating...';
      errEl.classList.add('hidden');

      try {
        const res = await fetch('/api/user/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ title, goal, taskType })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed creating task');
        closeCreateTaskModal();
        document.getElementById('task-input-title').value = '';
        document.getElementById('task-input-goal').value = '';
        loadOverview();
        loadTasks();
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Create Task';
      }
    }

    // Modal Control: Memory
    function openCreateMemoryModal() {
      const modal = document.getElementById('modal-create-memory');
      if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('mem-input-key')?.focus();
      }
    }
    function closeCreateMemoryModal() {
      const modal = document.getElementById('modal-create-memory');
      if (modal) modal.classList.add('hidden');
      const errEl = document.getElementById('mem-submit-error');
      if (errEl) errEl.classList.add('hidden');
    }
    async function handleCreateMemorySubmit(event) {
      event.preventDefault();
      const token = localStorage.getItem('wb_session_token');
      const key = document.getElementById('mem-input-key').value.trim();
      const content = document.getElementById('mem-input-content').value.trim();
      const category = document.getElementById('mem-input-category').value;
      const btn = document.getElementById('mem-btn-submit');
      const errEl = document.getElementById('mem-submit-error');

      if (!key || !content) return;
      btn.disabled = true;
      btn.innerText = 'Saving...';
      errEl.classList.add('hidden');

      try {
        const res = await fetch('/api/user/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ key, content, category })
        });
        
        let data;
        const contentType = res.headers.get('content-type') || '';
        if (res.status === 429 || !contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(text.includes('Rate exceeded') ? 'Rate limit exceeded. Please wait a moment and try again.' : 'Failed saving memory: unexpected response');
        } else {
          data = await res.json();
        }
        
        if (!res.ok) throw new Error(data.error || 'Failed saving memory');
        closeCreateMemoryModal();
        document.getElementById('mem-input-key').value = '';
        document.getElementById('mem-input-content').value = '';
        loadOverview();
        loadMemories();
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Save Memory';
      }
    }

    // Modal Control: Reminder
    function openCreateReminderModal() {
      const modal = document.getElementById('modal-create-reminder');
      if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('rem-input-prompt')?.focus();
      }
    }
    function closeCreateReminderModal() {
      const modal = document.getElementById('modal-create-reminder');
      if (modal) modal.classList.add('hidden');
      const errEl = document.getElementById('rem-submit-error');
      if (errEl) errEl.classList.add('hidden');
    }
    async function handleCreateReminderSubmit(event) {
      event.preventDefault();
      const token = localStorage.getItem('wb_session_token');
      const prompt = document.getElementById('rem-input-prompt').value.trim();
      const minutes = parseInt(document.getElementById('rem-input-time').value, 10);
      const btn = document.getElementById('rem-btn-submit');
      const errEl = document.getElementById('rem-submit-error');

      if (!prompt) return;
      btn.disabled = true;
      btn.innerText = 'Scheduling...';
      errEl.classList.add('hidden');

      try {
        const dueAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        const res = await fetch('/api/user/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ prompt, dueAt })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed scheduling reminder');
        closeCreateReminderModal();
        document.getElementById('rem-input-prompt').value = '';
        loadOverview();
        loadReminders();
      } catch (err) {
        errEl.innerText = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Schedule Reminder';
      }
    }

    // Tab Switching
    function switchTab(tabId, updateHash = true) {
      currentTab = tabId;
      if (updateHash) {
        try {
          history.replaceState(null, '', '#' + tabId);
        } catch(e) {}
      }
      const tabs = ['overview', 'chat', 'tasks', 'memory', 'reminders', 'settings'];
      tabs.forEach(t => {
        const view = document.getElementById('tab-view-' + t);
        const mobileBtn = document.getElementById('mobile-nav-btn-' + t);
        if (view) view.classList.toggle('hidden', t !== tabId);
        if (mobileBtn) {
          if (t === tabId) {
            mobileBtn.className = 'flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/30 dark:border-brand-500/40 text-[10px] sm:text-xs font-bold transition shadow-sm';
          } else {
            mobileBtn.className = 'flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-app-text/50 hover:text-app-text hover:bg-app-highlight border border-transparent text-[10px] sm:text-xs font-semibold transition';
          }
        }
      });

      if (tabId === 'chat') {
        const input = document.getElementById('chat-input');
        if (input) setTimeout(() => input.focus(), 80);
        const thread = document.getElementById('chat-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
      } else if (tabId === 'overview') {
        loadOverview();
      }
    }

    // Telegram Pairing
    async function generateTelegramLink() {
      const token = localStorage.getItem('wb_session_token');
      try {
        const res = await fetch('/api/auth/telegram/generate-link', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.linkUrl) {
          document.getElementById('pairing-link-input').value = data.linkUrl;
          document.getElementById('pairing-link-open').href = data.linkUrl;
          const botLink = document.getElementById('pairing-bot-link');
          if (botLink && data.botUsername) {
            botLink.href = 'https://t.me/' + data.botUsername;
            botLink.innerText = '@' + data.botUsername;
          }
          document.getElementById('settings-pairing-box').classList.remove('hidden');
        } else {
          alert(data.error || 'Telegram Bot is not configured in the server environment.');
        }
      } catch (err) {
        alert('Failed generating Telegram connection link');
      }
    }

    function copyPairingLink() {
      const input = document.getElementById('pairing-link-input');
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Link copied to clipboard!');
    }

    function openTelegramSettings() {
      switchTab('settings');
    }

    function openTelegramSyncModal() {
      switchTab('settings');
      generateTelegramLink();
    }

    async function updateNotifyPreference(pref) {
      const token = localStorage.getItem('wb_session_token');
      await fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ notificationPreference: pref })
      });
    }

    function handleLogout() {
      try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
          firebase.auth().signOut().catch(() => {});
        }
      } catch (e) {}
      localStorage.removeItem('wb_session_token');
      localStorage.removeItem('wb_user');
      document.cookie = 'wb_session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      window.location.replace('/?logout=1');
    }

    // Explicitly expose globals to window for reliable HTML event binding
    window.switchTab = switchTab;
    window.openTelegramSettings = openTelegramSettings;
    window.openTelegramSyncModal = openTelegramSyncModal;
    window.generateTelegramLink = generateTelegramLink;
    window.copyPairingLink = copyPairingLink;
    window.updateNotifyPreference = updateNotifyPreference;
    window.handleLogout = handleLogout;

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.addEventListener('DOMContentLoaded', initWorkspace);
  </script>
</body>
</html>`;
}
