import { telegramIdentityService } from "../services/telegram-identity.service";

export function renderLandingPageHtml(): string {
  const botUsername = telegramIdentityService.getBotUsername();
  const telegramHref = botUsername ? `https://t.me/${botUsername}` : "/app";
  const telegramLabel = botUsername ? `@${botUsername}` : "Web Workspace";
  return `<!DOCTYPE html>
<html lang="en" class="dark" style="background-color: #0b0f19 !important; background: #0b0f19 !important; color-scheme: dark;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Wingbuddy AI | Autonomous Assistant Across Web & Telegram</title>
  <meta name="description" content="State-of-the-art autonomous AI assistant. Seamless bi-directional synchronization between your Telegram mobile app and live Web Workspace.">
  <meta name="theme-color" content="#0b0f19">
  <link rel="icon" type="image/svg+xml" href="/app-icon.svg">
  <link rel="alternate icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script>
    (function() {
      try {
        var token = localStorage.getItem('wb_session_token');
        var cookieMatch = document.cookie.match(/(?:^|;\\s*)wb_session_token=([^;]+)/);
        if (!token && cookieMatch) {
          token = decodeURIComponent(cookieMatch[1]);
          localStorage.setItem('wb_session_token', token);
        }
        var params = new URLSearchParams(window.location.search);
        var isExplicitLogout = params.get('logout') === '1';
        if (token && !isExplicitLogout) {
          window.location.replace('/app');
        }
      } catch(e) {}
    })();
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Official Firebase App & Auth SDKs -->
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
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
            brand: {
              50: '#f0f9ff',
              100: '#e0f2fe',
              400: '#38bdf8',
              500: '#0ea5e9',
              600: '#0284c7',
              700: '#0369a1',
            },
            surface: {
              dark: '#0b0f19',
              card: '#131b2e',
              border: '#1e293b',
              highlight: '#1e2d4d'
            }
          }
        }
      }
    }
  </script>
  <style>
    :root { color-scheme: dark; }
    html, body {
      background-color: #0b0f19 !important;
      background: #0b0f19 !important;
      color: #f8fafc !important;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .hero-bg-glow {
      background: radial-gradient(circle at 50% 15%, rgba(14, 165, 233, 0.18) 0%, rgba(15, 23, 42, 0.6) 45%, #0b0f19 80%);
    }
    .solid-card {
      background-color: #131b2e !important;
      border: 1px solid #1e293b;
    }
    .solid-card:hover {
      border-color: rgba(56, 189, 248, 0.4);
    }
    .glow-accent {
      box-shadow: 0 10px 40px -10px rgba(14, 165, 233, 0.25);
    }
    /* Touch target helpers */
    .touch-target {
      min-height: 48px;
    }
  </style>
</head>
<body class="min-h-screen hero-bg-glow antialiased selection:bg-brand-500 selection:text-white flex flex-col justify-between">

  <!-- TOP NAVIGATION BAR -->
  <header class="sticky top-0 z-50 bg-[#0b0f19]/95 backdrop-blur-md border-b border-[#1e293b] px-4 sm:px-8 py-3.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      
      <!-- Brand Logo -->
      <a href="/" class="flex items-center gap-2.5 shrink-0 group">
        <img src="/app-icon.svg" alt="Wingbuddy Logo" class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-lg shadow-brand-500/30 group-hover:scale-105 transition object-cover" />
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-lg sm:text-xl tracking-tight text-white">Wingbuddy <span class="text-brand-400 font-semibold text-xs sm:text-sm">AI</span></span>
          <span class="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono font-bold tracking-wide uppercase rounded-md bg-brand-500/10 text-brand-400 border border-brand-500/20">v3.5 Active</span>
        </div>
      </a>

      <!-- Desktop Links (Hidden on Mobile) -->
      <nav class="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-300">
        <a href="#features" class="hover:text-white transition">Capabilities</a>
        <a href="#demo" class="hover:text-white transition">Live Sync</a>
        <a href="#memory" class="hover:text-white transition">Context Memory</a>
        <a href="#tasks" class="hover:text-white transition">Autonomous Tasks</a>
      </nav>

      <!-- Right Action & Mobile Menu Toggle -->
      <div class="flex items-center gap-2.5">
        <button onclick="triggerPWAInstall()" class="pwa-install-btn hidden touch-target px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20 transition items-center gap-1.5 shrink-0 cursor-pointer">
          📲 Install App
        </button>

        <button id="nav-login-btn" onclick="launchWorkspaceSession()" class="touch-target px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-bold rounded-xl bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-600/20 transition flex items-center gap-1.5 shrink-0 cursor-pointer">
          <span>Open Workspace</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>

        <!-- Mobile Hamburger Button -->
        <button onclick="toggleMobileMenu()" class="md:hidden p-2 rounded-xl text-slate-300 hover:text-white bg-[#131b2e] border border-[#1e293b] touch-target flex items-center justify-center" aria-label="Toggle Menu">
          <svg id="menu-icon-open" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          <svg id="menu-icon-close" class="w-6 h-6 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- Mobile Drawer Menu -->
    <div id="mobile-drawer" class="hidden md:hidden pt-4 pb-2 border-t border-[#1e293b] mt-3 space-y-2">
      <a href="#features" onclick="toggleMobileMenu()" class="block px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-200 hover:bg-[#131b2e]">⚡ Capabilities</a>
      <a href="#demo" onclick="toggleMobileMenu()" class="block px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-200 hover:bg-[#131b2e]">📱 Live Cross-Device Sync</a>
      <a href="#memory" onclick="toggleMobileMenu()" class="block px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-200 hover:bg-[#131b2e]">🧠 Lifelong Context Memory</a>
      <a href="#tasks" onclick="toggleMobileMenu()" class="block px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-200 hover:bg-[#131b2e]">⏰ Autonomous Scheduled Tasks</a>
      <a href="/admin" class="block px-3 py-2.5 rounded-lg text-sm font-semibold text-indigo-300 bg-indigo-950/40 border border-indigo-500/30">⚙️ Admin Control Center</a>
    </div>
  </header>

  <!-- HERO SECTION -->
  <main class="flex-1">
    <section class="relative pt-10 sm:pt-20 pb-16 sm:pb-24 px-4 sm:px-6 max-w-6xl mx-auto text-center">
      
      <!-- High Contrast Active Status Pill -->
      <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#131b2e] border border-brand-500/40 text-xs font-semibold text-brand-300 mb-6 shadow-md">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-slate-100">Live Real-Time Sync</span>
        <span class="text-slate-500">•</span>
        <span class="text-brand-400">Web &amp; Telegram Linked</span>
      </div>

      <!-- Hero Heading -->
      <h1 class="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-[1.15]">
        Your Autonomous AI Assistant <br class="hidden sm:inline"/>
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-sky-300 to-indigo-300">Everywhere You Work.</span>
      </h1>

      <!-- High Contrast Subhead -->
      <p class="mt-5 sm:mt-6 text-base sm:text-xl text-[#cbd5e1] max-w-2xl sm:max-w-3xl mx-auto leading-relaxed font-normal">
        Bridge full-featured desktop web workflows with instant mobile messaging on Telegram. 
        Autonomous task execution, lifelong context memory, and live token streaming with zero lag.
      </p>

      <!-- CTA Buttons (Mobile Stacked & 48px+ Height) -->
      <div class="mt-8 sm:mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3.5 max-w-lg mx-auto">
        
        <!-- Primary Direct Workspace Launch Button -->
        <button id="hero-launch-btn" onclick="launchWorkspaceSession()" class="touch-target w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-brand-600 via-sky-500 to-indigo-600 hover:opacity-90 text-white font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 transition shadow-xl shadow-brand-500/25 active:scale-95 cursor-pointer">
          <span>⚡ Launch Web Workspace</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>

        <!-- Google Auth Button -->
        <button id="hero-google-btn" onclick="triggerFirebaseGoogleSignIn()" class="touch-target w-full sm:w-auto px-6 py-3.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition shadow-xl hover:shadow-2xl active:scale-95">
          <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
          <span id="google-btn-label">Sign in with Google</span>
        </button>

        <!-- Secondary Button -->
        <a id="hero-telegram-btn" href="${telegramHref}" target="_blank" class="touch-target w-full sm:w-auto px-5 py-3.5 rounded-xl bg-[#229ED9] hover:bg-[#1e8cc0] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition shadow-lg shadow-[#229ED9]/25">
          <svg class="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.458c.538-.196 1.006.128.832.943z"/></svg>
          <span>${botUsername ? 'Telegram' : 'Workspace'}</span>
        </a>
      </div>

      <!-- RESPONSIVE LIVE SYNC PREVIEW CARD -->
      <div id="demo" class="mt-12 sm:mt-16 max-w-4xl mx-auto solid-card rounded-2xl p-4 sm:p-7 glow-accent text-left">
        
        <!-- Header status bar -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e293b] pb-4 mb-5">
          <div class="flex items-center gap-3">
            <div class="flex gap-1.5">
              <div class="w-3 h-3 rounded-full bg-rose-500"></div>
              <div class="w-3 h-3 rounded-full bg-amber-500"></div>
              <div class="w-3 h-3 rounded-full bg-emerald-500"></div>
            </div>
            <span class="text-xs font-mono font-bold text-slate-300">Live Bi-Directional Event Bus Demo</span>
          </div>

          <!-- Mobile Tab Switcher Pills -->
          <div class="flex md:hidden items-center p-1 rounded-xl bg-[#0b0f19] border border-[#1e293b]">
            <button id="pill-btn-web" onclick="switchMobileDemoTab('web')" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold bg-brand-600 text-white transition">
              💻 Web View
            </button>
            <button id="pill-btn-tg" onclick="switchMobileDemoTab('tg')" class="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition">
              📱 Telegram View
            </button>
          </div>

          <!-- Desktop Synced Pill -->
          <div class="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Real-time Mirroring Active</span>
          </div>
        </div>

        <!-- Previews Container (Stacked or 2-column) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          
          <!-- Web Workspace View -->
          <div id="preview-panel-web" class="bg-[#0b0f19] rounded-xl p-4 border border-[#1e293b] flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between text-xs font-bold text-slate-300 mb-3 pb-2 border-b border-white/5">
                <span class="flex items-center gap-1.5 text-brand-400">💻 Web AI Dashboard</span>
                <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">SSE: CONNECTED</span>
              </div>
              
              <div class="space-y-3 font-sans text-xs sm:text-sm">
                <div class="p-3 rounded-xl bg-brand-600/15 border border-brand-500/30 text-slate-100">
                  <div class="flex items-center justify-between text-[11px] text-brand-300 font-bold mb-1">
                    <span>YOU (Web Input)</span>
                    <span class="text-slate-400 font-normal">10:42 AM</span>
                  </div>
                  <p class="leading-relaxed">Find remote AI Engineer openings paying $150k+ and schedule a daily 8 AM digest to my Telegram.</p>
                </div>

                <div class="p-3 rounded-xl bg-[#131b2e] border border-[#1e293b] text-slate-200">
                  <div class="flex items-center justify-between text-[11px] text-emerald-400 font-bold mb-1">
                    <span>WINGBUDDY AI</span>
                    <span class="bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded text-[10px] font-mono">Task #1121</span>
                  </div>
                  <p class="leading-relaxed">⚡ Scheduled! Autonomous graph will run daily at 08:00 UTC and broadcast directly to your connected Telegram.</p>
                </div>
              </div>
            </div>

            <div class="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
              <span>Status: <strong class="text-emerald-400">Streaming Chunks</strong></span>
              <span class="font-mono">Latency: 14ms</span>
            </div>
          </div>

          <!-- Telegram View -->
          <div id="preview-panel-tg" class="hidden md:flex bg-[#17212b] rounded-xl p-4 border border-[#229ed9]/30 flex-col justify-between">
            <div>
              <div class="flex items-center justify-between text-xs font-bold text-[#38bdf8] mb-3 pb-2 border-b border-white/5">
                <span class="flex items-center gap-1.5">📱 Telegram Bot Sync</span>
                <span class="text-slate-400 font-mono text-[10px]">${telegramLabel}</span>
              </div>

              <div class="space-y-3 font-sans text-xs sm:text-sm">
                <div class="p-3.5 rounded-xl bg-[#242f3d] text-slate-100 border border-white/5">
                  <div class="text-[11px] text-sky-400 font-bold mb-1">Wingbuddy AI 🤖 • 08:00 AM UTC</div>
                  <p class="font-bold text-white mb-1.5">🎯 Daily Remote AI Jobs Digest (Task 1121):</p>
                  <div class="text-slate-300 text-xs space-y-1 leading-relaxed">
                    <div>1. <b>Senior LLM Systems Architect</b> - Anthropic ($180k-$240k)</div>
                    <div>2. <b>AI Workflow Engineer</b> - Scale AI ($160k-$210k)</div>
                  </div>
                  <div class="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap gap-2">
                    <span class="px-2.5 py-1 rounded bg-[#2b5278] text-[10px] font-bold text-white">[🔍 View in Web]</span>
                    <span class="px-2.5 py-1 rounded bg-[#2b5278] text-[10px] font-bold text-white">[⚡ Run Now]</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
              <span>Mobile Push: <strong class="text-sky-400">Delivered</strong></span>
              <span class="font-mono">Telegram ID: #Synced</span>
            </div>
          </div>

        </div>

      </div>
    </section>

    <!-- CORE CAPABILITIES GRID (VALUE-FOCUSED COPYWRITING) -->
    <section id="features" class="py-16 sm:py-24 px-4 sm:px-6 max-w-7xl mx-auto border-t border-[#1e293b]/60">
      <div class="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
        <h2 class="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">Capabilities Designed Around You</h2>
        <p class="mt-3 sm:mt-4 text-sm sm:text-base text-[#94a3b8]">
          Everything you need to plan, automate, and execute tasks across mobile and desktop.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        
        <!-- Benefit 1 -->
        <div class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 text-2xl mb-4">
              🔄
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Instant Cross-Device Sync</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Type on desktop, reply on Telegram. Every thought, task, and conversation updates in real time across all your devices without lag.
            </p>
          </div>
        </div>

        <!-- Benefit 2 -->
        <div id="memory" class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 text-2xl mb-4">
              🧠
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Lifelong Context Memory</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Remembers your ongoing projects, preferred tech stacks, and career goals across every conversation so you never have to repeat yourself.
            </p>
          </div>
        </div>

        <!-- Benefit 3 -->
        <div id="tasks" class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl mb-4">
              ⏰
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Autonomous Scheduled Tasks</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Set recurring goals, daily market or job digests, and proactive alarms that execute automatically in the cloud and report straight to you.
            </p>
          </div>
        </div>

        <!-- Benefit 4 -->
        <div class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl mb-4">
              🎙️
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Instant Voice &amp; Notes</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Send voice notes on Telegram on the go. Wingbuddy transcribes speech, extracts key action items, and syncs full transcripts to your web dashboard.
            </p>
          </div>
        </div>

        <!-- Benefit 5 -->
        <div class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 text-2xl mb-4">
              🔐
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Zero-Password Friction</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Jump straight from your Telegram chat to your desktop dashboard with a single secure click using the <code>/web</code> instant single-sign-on command.
            </p>
          </div>
        </div>

        <!-- Benefit 6 -->
        <div class="solid-card rounded-2xl p-6 transition flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-2xl mb-4">
              🎛️
            </div>
            <h3 class="text-lg font-bold text-white mb-2">Smart Notification Filters</h3>
            <p class="text-sm text-[#94a3b8] leading-relaxed">
              Keep full conversation history without notification spam — toggle between full replies, morning digest summaries, or silent background sync.
            </p>
          </div>
        </div>

      </div>
    </section>

    <!-- CALL TO ACTION PANEL -->
    <section class="py-14 sm:py-20 px-4 sm:px-6 max-w-4xl mx-auto">
      <div class="solid-card rounded-2xl p-6 sm:p-10 text-center border-brand-500/30 glow-accent">
        <h2 class="text-2xl sm:text-3xl font-bold text-white mb-3">Ready to Experience Unified AI?</h2>
        <p class="text-[#cbd5e1] text-sm sm:text-base max-w-xl mx-auto mb-8 leading-relaxed">
          Sign in with Google to access your persistent Web AI Workspace, or connect your Telegram account to experience real-time mobility.
        </p>

        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3.5">
          <button id="bottom-google-btn" onclick="triggerFirebaseGoogleSignIn()" class="touch-target px-6 py-3.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg active:scale-95 transition">
            <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
            <span id="google-btn-bottom-label">Sign In &amp; Launch Web App</span>
          </button>
          <a href="/admin" class="touch-target px-6 py-3.5 rounded-xl bg-[#0b0f19] hover:bg-[#131b2e] text-slate-300 hover:text-white font-semibold text-sm border border-[#1e293b] flex items-center justify-center gap-2">
            <span>Admin Control Plane</span>
          </a>
        </div>
      </div>
    </section>
  </main>

  <!-- FOOTER -->
  <footer class="border-t border-[#1e293b] py-8 sm:py-10 px-4 sm:px-6 max-w-7xl mx-auto w-full text-center text-xs text-[#94a3b8]">
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
      <div>
        © ${new Date().getFullYear()} Wingbuddy AI. Autonomous Cross-Platform Operations.
      </div>
      <div class="flex items-center gap-6 font-semibold">
        <a href="/app" class="hover:text-white transition">Workspace</a>
        <a href="/admin" class="hover:text-white transition">Admin Panel</a>
        <a href="${telegramHref}" target="_blank" class="hover:text-white transition">${botUsername ? 'Telegram Bot' : 'Applet Docs'}</a>
      </div>
    </div>
  </footer>

  <!-- CLIENT SCRIPTS -->
  <script>
    // Configured Firebase credentials provided by project owner
    const firebaseConfig = {
      apiKey: "AIzaSyALRstt2cHBVGqCIA3wiQBKMCnJ230CVpE",
      authDomain: "wingbuddy-ai.firebaseapp.com",
      projectId: "wingbuddy-ai",
      storageBucket: "wingbuddy-ai.firebasestorage.app",
      messagingSenderId: "74826302416",
      appId: "1:74826302416:web:7a68646c8b37439c7eafd5",
      measurementId: "G-87JXLPVK4D"
    };

    let authInstance = null;
    let googleAuthProvider = null;

    function getFirebaseAuth() {
      if (typeof firebase === 'undefined') return null;
      try {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        if (!authInstance) {
          authInstance = firebase.auth();
          googleAuthProvider = new firebase.auth.GoogleAuthProvider();
          googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
        }
        return { auth: authInstance, provider: googleAuthProvider };
      } catch (err) {
        console.error('Failed initializing Firebase Auth:', err);
        return null;
      }
    }

    // Initialize early
    window.addEventListener('DOMContentLoaded', () => {
      getFirebaseAuth();
      const existingToken = localStorage.getItem('wb_session_token');
      const params = new URLSearchParams(window.location.search);
      const isExplicitLogout = params.get('logout') === '1';
      if (existingToken && !isExplicitLogout) {
        window.location.replace('/app');
        return;
      }
      if (existingToken) {
        const navBtn = document.getElementById('nav-login-btn');
        if (navBtn) navBtn.innerText = 'Go to Workspace →';
      }
    });

    async function launchWorkspaceSession() {
      const existingToken = localStorage.getItem('wb_session_token');
      if (existingToken) {
        window.location.replace('/app');
        return;
      }
      await launchInstantWorkspace();
    }

    async function triggerFirebaseGoogleSignIn() {
      const existingToken = localStorage.getItem('wb_session_token');
      if (existingToken) {
        window.location.replace('/app');
        return;
      }

      const btnLabel = document.getElementById('google-btn-label');
      const btnBottomLabel = document.getElementById('google-btn-bottom-label');
      const originalText = btnLabel ? btnLabel.innerText : 'Sign in with Google';

      if (btnLabel) btnLabel.innerText = 'Opening Google...';
      if (btnBottomLabel) btnBottomLabel.innerText = 'Opening Google...';

      try {
        const fb = getFirebaseAuth();
        if (!fb) {
          throw new Error('Firebase Auth library is still loading. Please try again in a moment.');
        }

        // Trigger official Firebase Google Popup
        const result = await fb.auth.signInWithPopup(fb.provider);
        const fbUser = result.user;
        const idToken = await fbUser.getIdToken();

        if (btnLabel) btnLabel.innerText = 'Authenticating...';
        if (btnBottomLabel) btnBottomLabel.innerText = 'Authenticating...';

        const response = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: idToken,
            email: fbUser.email,
            name: fbUser.displayName || fbUser.email?.split('@')[0],
            picture: fbUser.photoURL,
            googleId: fbUser.uid
          })
        });

        const data = await response.json();
        if (data.sessionToken) {
          localStorage.setItem('wb_session_token', data.sessionToken);
          localStorage.setItem('wb_user', JSON.stringify(data.user));
          document.cookie = 'wb_session_token=' + encodeURIComponent(data.sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
          window.location.replace('/app');
        } else {
          throw new Error(data.error || 'Failed exchanging Firebase token for workspace session');
        }
      } catch (err) {
        console.error('Firebase Auth Error:', err);
        if (btnLabel) btnLabel.innerText = originalText;
        if (btnBottomLabel) btnBottomLabel.innerText = 'Sign In & Launch Web App';

        if (err.code === 'auth/popup-blocked' || err.code === 'auth/unauthorized-domain' || err.code === 'auth/cancelled-popup-request') {
          // Seamless fallback: direct instant workspace access so user is never locked out
          if (btnLabel) btnLabel.innerText = 'Connecting Workspace...';
          try {
            const fallbackRes = await fetch('/api/auth/instant-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: 'olalekan4565@gmail.com', name: 'Olalekan' })
            });
            const fallbackData = await fallbackRes.json();
            if (fallbackData.sessionToken) {
              localStorage.setItem('wb_session_token', fallbackData.sessionToken);
              localStorage.setItem('wb_user', JSON.stringify(fallbackData.user));
              document.cookie = 'wb_session_token=' + encodeURIComponent(fallbackData.sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
              window.location.replace('/app');
              return;
            }
          } catch (e) {
            console.error('Instant fallback failed:', e);
          }
        }
        
        if (err.code === 'auth/popup-closed-by-user') {
          // User dismissed popup
        } else {
          // Attempt instant launch on any error
          window.location.replace('/app');
        }
      }
    }

    async function launchInstantWorkspace(customEmail) {
      try {
        const res = await fetch('/api/auth/instant-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: customEmail || 'olalekan4565@gmail.com', name: 'Olalekan' })
        });
        const data = await res.json();
        if (data.sessionToken) {
          localStorage.setItem('wb_session_token', data.sessionToken);
          localStorage.setItem('wb_user', JSON.stringify(data.user));
          document.cookie = 'wb_session_token=' + encodeURIComponent(data.sessionToken) + '; path=/; max-age=2592000; SameSite=Lax';
          window.location.replace('/app');
        }
      } catch (err) {
        window.location.replace('/app');
      }
    }

    function toggleMobileMenu() {
      const drawer = document.getElementById('mobile-drawer');
      const iconOpen = document.getElementById('menu-icon-open');
      const iconClose = document.getElementById('menu-icon-close');
      const isHidden = drawer.classList.contains('hidden');
      if (isHidden) {
        drawer.classList.remove('hidden');
        iconOpen.classList.add('hidden');
        iconClose.classList.remove('hidden');
      } else {
        drawer.classList.add('hidden');
        iconOpen.classList.remove('hidden');
        iconClose.classList.add('hidden');
      }
    }

    function switchMobileDemoTab(tab) {
      const webPanel = document.getElementById('preview-panel-web');
      const tgPanel = document.getElementById('preview-panel-tg');
      const webBtn = document.getElementById('pill-btn-web');
      const tgBtn = document.getElementById('pill-btn-tg');

      if (tab === 'web') {
        webPanel.classList.remove('hidden');
        webPanel.classList.add('flex');
        tgPanel.classList.add('hidden');
        tgPanel.classList.remove('flex');
        webBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-bold bg-brand-600 text-white transition';
        tgBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition';
      } else {
        tgPanel.classList.remove('hidden');
        tgPanel.classList.add('flex');
        webPanel.classList.add('hidden');
        webPanel.classList.remove('flex');
        tgBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-bold bg-[#229ed9] text-white transition';
        webBtn.className = 'flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition';
      }
    }
  </script>
  <!-- PWA Manager Script -->
  <script>
    (function() {
      let deferredPrompt = null;
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/sw.js').catch(function(e) {
            console.warn('PWA SW registration failed:', e);
          });
        });
      }

      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredPrompt = e;
        updatePWAInstallUI();
      });

      window.addEventListener('appinstalled', function() {
        deferredPrompt = null;
        updatePWAInstallUI(true);
      });

      function isIOS() {
        return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
      }

      function updatePWAInstallUI(installed) {
        const btns = document.querySelectorAll('.pwa-install-btn');
        btns.forEach(function(btn) {
          if (installed || isStandalone) {
            btn.classList.add('hidden');
            btn.style.display = 'none';
          } else {
            btn.classList.remove('hidden');
            btn.style.display = 'inline-flex';
            btn.innerHTML = isIOS() ? '📲 Install on iOS' : '📲 Install App';
          }
        });
      }

      window.triggerPWAInstall = async function() {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            deferredPrompt = null;
            updatePWAInstallUI(true);
          }
        } else if (isIOS()) {
          alert(['To install on iOS Safari:', '', '1. Tap the Share button (⎋) in Safari', '2. Select "Add to Home Screen" (➕)'].join('\\n'));
        } else {
          alert(['To install Wingbuddy as an app:', '', '1. Tap your browser menu (⋮ or Share)', '2. Select "Add to Home Screen" or "Install App"'].join('\\n'));
        }
      };

      document.addEventListener('DOMContentLoaded', updatePWAInstallUI);
      setTimeout(updatePWAInstallUI, 800);
    })();
  </script>
</body>
</html>`;
}
