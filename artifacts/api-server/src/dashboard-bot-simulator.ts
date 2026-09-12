import { MODE_KEYS } from "./config/mode";
import { PERSONALITIES } from "./config/personality";

export function renderDashboardBotSimulator(): string {
  const modeOptions = [
    `<option value="auto">Auto / Turn Resolution</option>`,
    ...MODE_KEYS.map((mode) => `<option value="${mode}">${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</option>`),
  ].join("");

  const personalityOptions = Object.entries(PERSONALITIES).map(
    ([key, p]) => `<option value="${key}">${p.label} (${key})</option>`
  ).join("");

  return String.raw`
<style>
#simulatorShell{display:none;width:100%}
.sim2-container{display:grid;grid-template-columns:1fr 1.25fr;gap:14px;margin-top:12px;align-items:start}
.sim2-sidebar{display:flex;flex-direction:column;gap:12px}
.sim2-panel{background:linear-gradient(180deg,color-mix(in srgb,var(--panel) 96%,transparent),color-mix(in srgb,var(--panel-2) 96%,transparent));border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow);min-width:0}
.sim2-header-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px}
.sim2-control-group{display:flex;flex-direction:column;gap:5px;min-width:0}
.sim2-control-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.sim2-input,.sim2-select{width:100%;min-height:42px;border:1px solid var(--line);background:var(--panel-3);color:var(--text);padding:8px 12px;border-radius:9px;font-size:13.5px;outline:none}
.sim2-input:focus,.sim2-select:focus{border-color:var(--line-strong)}
.sim2-chat-thread{border:1px solid var(--line);border-radius:12px;background:var(--panel-3);padding:14px;min-height:360px;max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.sim2-bubble{padding:12px 14px;border-radius:12px;max-width:90%;font-size:13.5px;line-height:1.55;position:relative;word-break:break-word}
.sim2-bubble.user{align-self:flex-end;background:color-mix(in srgb,var(--accent, #3b82f6) 18%, var(--panel));border:1px solid color-mix(in srgb,var(--accent, #3b82f6) 40%, transparent);color:var(--text)}
.sim2-bubble.assistant{align-self:flex-start;background:var(--panel);border:1px solid var(--line);color:var(--text)}
.sim2-bubble-meta{font-size:11px;color:var(--muted);margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sim2-bubble-badge{background:var(--panel-3);padding:3px 7px;border-radius:5px;border:1px solid var(--line);font-size:10.5px}
.sim2-bubble-badge.winner{border-color:color-mix(in srgb,#10b981 40%, transparent);color:#10b981}
.sim2-bubble-badge.override{border-color:color-mix(in srgb,#f59e0b 50%, transparent);color:#f59e0b}
.sim2-composer{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.sim2-textarea{width:100%;min-height:90px;resize:vertical;border:1px solid var(--line);background:var(--panel-3);color:var(--text);padding:12px;border-radius:10px;outline:none;font:inherit;font-size:14px;line-height:1.5}
.sim2-composer-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.sim2-tabs{display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:6px;border-bottom:1px solid var(--line)}
.sim2-tabs::-webkit-scrollbar{display:none}
.sim2-tab{border:1px solid transparent;background:transparent;color:var(--muted);min-height:38px;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center}
.sim2-tab.active{color:var(--text);border-color:var(--line);background:var(--panel-3)}
.sim2-tab-content{display:none}
.sim2-tab-content.active{display:block}
.sim2-timeline{display:flex;flex-direction:column;gap:10px}
.sim2-timeline-step{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px}
.sim2-timeline-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.sim2-timeline-phase{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent,#3b82f6)}
.sim2-timeline-label{font-size:13px;margin-top:4px;color:var(--text)}
.sim2-timeline-details{margin-top:8px;background:var(--panel-3);border:1px solid var(--line);border-radius:7px;padding:9px;font-size:11.5px;font-family:monospace;white-space:pre-wrap;max-height:200px;overflow:auto;-webkit-overflow-scrolling:touch;word-break:break-all}
.sim2-matrix-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
.sim2-matrix-table{width:100%;border-collapse:collapse;font-size:12px;min-width:480px}
.sim2-matrix-table th{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px;text-transform:uppercase;background:var(--panel-3);position:sticky;top:0}
.sim2-matrix-table td{padding:9px 10px;border-bottom:1px solid var(--line);color:var(--text)}
.sim2-matrix-table tr.winner{background:color-mix(in srgb,#10b981 8%,transparent)}
.sim2-matrix-table tr.unhealthy{opacity:0.5}
.sim2-tag{display:inline-block;padding:2px 7px;border-radius:5px;font-size:11px;font-weight:600}
.sim2-tag.win{background:#10b981;color:#fff}
.sim2-tag.eligible{background:var(--panel-3);color:var(--muted);border:1px solid var(--line)}
.sim2-tag.unhealthy{background:#ef4444;color:#fff}
.sim2-callout{padding:12px 14px;border-radius:9px;font-size:12.5px;margin-bottom:10px;line-height:1.5}
.sim2-callout.warning{background:color-mix(in srgb,#f59e0b 12%, transparent);border:1px solid color-mix(in srgb,#f59e0b 35%, transparent);color:#f59e0b}
.sim2-callout.info{background:color-mix(in srgb,var(--accent,#3b82f6) 10%, transparent);border:1px solid color-mix(in srgb,var(--accent,#3b82f6) 30%, transparent);color:var(--text)}
.sim2-meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px}
.sim2-meta-card{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:10px;min-width:0}
.sim2-meta-card b{display:block;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.sim2-meta-card span{font-size:15px;font-weight:700;color:var(--text);margin-top:3px;display:block;word-break:break-all}
.sim2-context-item{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--panel);margin-bottom:8px}
.sim2-context-item-head{display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;color:var(--muted);margin-bottom:4px}
.sim2-runs-list{display:flex;flex-direction:column;gap:7px;max-height:220px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.sim2-run-item{padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);cursor:pointer;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;min-height:44px}
.sim2-run-item:hover{border-color:var(--line-strong);background:var(--panel-2)}

/* Mobile Segmented View Switcher (<768px) */
.sim2-mobile-switcher{display:none;margin-bottom:12px;grid-template-columns:repeat(3,1fr);background:var(--panel-3);padding:4px;border-radius:10px;border:1px solid var(--line)}
.sim2-mobile-btn{border:none;background:transparent;color:var(--muted);padding:9px 4px;font-size:13px;font-weight:700;border-radius:7px;cursor:pointer;text-align:center;min-height:40px}
.sim2-mobile-btn.active{background:var(--panel);color:var(--text);border:1px solid var(--line);box-shadow:0 2px 6px rgba(0,0,0,.2)}

.sim2-preset-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.sim2-chip{background:var(--panel-3);border:1px solid var(--line);border-radius:6px;padding:4px 9px;font-size:11.5px;color:var(--text);cursor:pointer;transition:all .15s}
.sim2-chip:hover{border-color:var(--line-strong);background:var(--panel-2)}

@media(max-width:1050px){
  .sim2-container{grid-template-columns:1fr;gap:14px}
}

@media(max-width:768px){
  .sim2-mobile-switcher{display:grid}
  .sim2-header-grid{grid-template-columns:1fr}
  .sim2-container{display:block}
  /* Mobile segment toggling preserves DOM state completely */
  .sim2-panel-config{display:block}
  .sim2-panel-chat{display:none}
  .sim2-panel-trace{display:none}
  
  .sim2-mode-config .sim2-panel-config{display:block}
  .sim2-mode-config .sim2-panel-chat{display:none}
  .sim2-mode-config .sim2-panel-trace{display:none}

  .sim2-mode-chat .sim2-panel-config{display:none}
  .sim2-mode-chat .sim2-panel-chat{display:block}
  .sim2-mode-chat .sim2-panel-trace{display:none}

  .sim2-mode-trace .sim2-panel-config{display:none}
  .sim2-mode-trace .sim2-panel-chat{display:none}
  .sim2-mode-trace .sim2-panel-trace{display:block}
  
  .sim2-composer-actions{flex-direction:column;align-items:stretch}
  .sim2-composer-actions>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .sim2-chat-thread{min-height:280px;max-height:380px}
}
</style>

<section class="view" id="view-simulator">
  <div class="top">
    <div>
      <div class="eyebrow">Agent Evaluation & Observability Console</div>
      <div class="title">Bot Simulator 2.0</div>
      <p class="subtitle">Production debugging sandbox: Multi-turn verification, discrete execution timeline, honest routing matrix, RAG assembly, and telemetry replay.</p>
    </div>
    <div class="toolbar">
      <span class="pill good" id="simLiveBadge">● Engine Active</span>
      <button class="btn small" onclick="simExportCurrentTrace()">📥 Export Trace</button>
      <button class="btn small" onclick="simClearConversation()">🧹 Reset</button>
    </div>
  </div>

  <!-- Mobile Segment Switcher: Config · Chat · Trace (Preserves all state) -->
  <div class="sim2-mobile-switcher" id="simMobileSwitcher">
    <button class="sim2-mobile-btn active" data-sim-section="chat" onclick="simSetMobileSection('chat')">💬 Chat</button>
    <button class="sim2-mobile-btn" data-sim-section="config" onclick="simSetMobileSection('config')">⚙️ Config</button>
    <button class="sim2-mobile-btn" data-sim-section="trace" onclick="simSetMobileSection('trace')">⚡ Trace & Matrix</button>
  </div>

  <div class="sim2-container sim2-mode-chat" id="sim2Container">
    <!-- SECTION 1: Parameter Configuration Bar & Diagnostic Runs -->
    <div class="sim2-panel sim2-panel-config" style="margin-bottom:14px">
      <div class="section-head" style="margin-bottom:8px">
        <div class="section-title" style="font-size:14px">Simulator Persona & Router Setup</div>
      </div>
      <div class="sim2-header-grid">
        <div class="sim2-control-group">
          <label class="sim2-control-label">Simulated User & Tier</label>
          <div style="display:flex;gap:6px">
            <input id="simUserId" class="sim2-input" placeholder="User ID" inputmode="numeric" style="width:100px;flex-shrink:0" />
            <select id="simUserTier" class="sim2-select">
              <option value="free">Free (8 msgs)</option>
              <option value="pro">Pro (20 msgs)</option>
              <option value="vip">VIP (40 msgs)</option>
            </select>
          </div>
        </div>

        <div class="sim2-control-group">
          <label class="sim2-control-label">Execution Mode</label>
          <select id="simMode" class="sim2-select">${modeOptions}</select>
        </div>

        <div class="sim2-control-group">
          <label class="sim2-control-label">Persona / Personality</label>
          <select id="simPersonality" class="sim2-select">${personalityOptions}</select>
        </div>

        <div class="sim2-control-group">
          <label class="sim2-control-label">Routing Control (Force Test)</label>
          <select id="simProviderOverride" class="sim2-select" onchange="simUpdateOverrideBanner()">
            <option value="auto">Automatic (Adaptive Router)</option>
            <option value="gemini">Force Gemini (Primary)</option>
            <option value="groq">Force Groq (Llama 3.3 / 3.1)</option>
            <option value="mistral">Force Mistral (Large / Small)</option>
            <option value="huggingface">Force HuggingFace</option>
          </select>
        </div>
      </div>

      <div id="simOverrideWarning" class="sim2-callout warning" style="display:none">
        ⚠️ <b>TEST OVERRIDE ACTIVE:</b> Production adaptive routing policy is bypassed. Forcing provider: <span id="simOverrideTarget">—</span>.
      </div>

      <!-- Recent Simulation Runs -->
      <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)">Persisted Diagnostic Runs</div>
          <button class="btn small" onclick="simFetchRunHistory()">↻ Refresh</button>
        </div>
        <div id="simRunsList" class="sim2-runs-list">
          <div class="empty" style="font-size:12px">Loading runs…</div>
        </div>
      </div>
    </div>

    <!-- SECTION 2: Multi-Turn Conversation Thread -->
    <div class="sim2-sidebar sim2-panel-chat">
      <div class="sim2-panel" style="flex:1;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Conversation Thread</div>
          <span class="pill" id="simThreadCount">0 turns</span>
        </div>

        <div id="simChatThread" class="sim2-chat-thread">
          <div class="empty" style="margin:auto;text-align:center;color:var(--muted)">
            No simulation messages yet.<br><span style="font-size:12px">Type below to begin testing multi-turn conversation and state retention.</span>
          </div>
        </div>

        <div class="sim2-composer">
          <div class="sim2-preset-chips">
            <span style="font-size:11px;color:var(--muted);align-self:center">Try Prompts:</span>
            <span class="sim2-chip" onclick="simFillPrompt('Generate a photo-realistic futuristic city at night, 16:9')">🎨 Generate Image</span>
            <span class="sim2-chip" onclick="simFillPrompt('Create a 4-second motion video of ocean waves crashing on rocks')">🎬 Generate Video</span>
            <span class="sim2-chip" onclick="simFillPrompt('Research latest advancements in artificial intelligence this week')">🔍 Live Search</span>
            <span class="sim2-chip" onclick="simFillPrompt('Remember that my favorite programming language is TypeScript and favorite color is teal')">💾 Test Memory</span>
          </div>
          <textarea id="simMessageInput" class="sim2-textarea" placeholder="Type a message to simulate (Press Enter to send, Shift+Enter for newline)…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();runSimTurn();}"></textarea>
          <div class="sim2-composer-actions">
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              <label class="sim-check" style="font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-height:36px">
                <input id="simLiveSearch" type="checkbox" checked style="width:16px;height:16px" /> Permit Live Web Search
              </label>
              <label class="sim-check" style="font-size:12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-height:36px;font-weight:600;color:var(--accent,#3b82f6)">
                <input id="simLiveMedia" type="checkbox" style="width:16px;height:16px" /> ⚡ Live Media Generation
              </label>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn" onclick="simClearConversation()">Clear</button>
              <button class="btn primary" id="simSubmitBtn" onclick="runSimTurn()">▶ Send Message</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SECTION 3: Production Observability & Inspection Console -->
    <div class="sim2-panel sim2-panel-trace">
      <!-- High Level Telemetry Stats Bar -->
      <div class="sim2-meta-grid">
        <div class="sim2-meta-card">
          <b>Effective Model</b>
          <span id="simStatModel">—</span>
        </div>
        <div class="sim2-meta-card">
          <b>Latency (ms)</b>
          <span id="simStatLatency">—</span>
        </div>
        <div class="sim2-meta-card">
          <b>Total Tokens</b>
          <span id="simStatTokens">—</span>
        </div>
        <div class="sim2-meta-card">
          <b>Est. Cost</b>
          <span id="simStatCost" style="color:#10b981">—</span>
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="sim2-tabs">
        <button class="sim2-tab active" data-sim-tab="timeline" onclick="simSwitchTab('timeline')">⚡ Timeline</button>
        <button class="sim2-tab" data-sim-tab="multimodal" onclick="simSwitchTab('multimodal')">🖼️ Multimodal & Media</button>
        <button class="sim2-tab" data-sim-tab="routing" onclick="simSwitchTab('routing')">🎯 Routing Matrix</button>
        <button class="sim2-tab" data-sim-tab="context" onclick="simSwitchTab('context')">🧠 Context & RAG</button>
        <button class="sim2-tab" data-sim-tab="telegram" onclick="simSwitchTab('telegram')">📱 Telegram</button>
        <button class="sim2-tab" data-sim-tab="raw" onclick="simSwitchTab('raw')">📄 Raw Output</button>
        <button class="sim2-tab" data-sim-tab="replay" onclick="simSwitchTab('replay')">🔄 Replay</button>
      </div>

      <!-- TAB 1: Execution Timeline -->
      <div id="simTabTimeline" class="sim2-tab-content active">
        <div id="simTimelineContainer" class="sim2-timeline">
          <div class="empty">Run a simulation turn to inspect the discrete step-by-step execution timeline.</div>
        </div>
      </div>

      <!-- TAB MULTIMODAL: Multimodal Transparency & Media Artifacts -->
      <div id="simTabMultimodal" class="sim2-tab-content">
        <div id="simMultimodalContainer">
          <div class="empty">Multimodal transparency, dynamic model discovery, video generation technique, and artifact preview will appear here when testing image/video requests.</div>
        </div>
      </div>

      <!-- TAB 2: Routing Decision & Candidate Matrix -->
      <div id="simTabRouting" class="sim2-tab-content">
        <div id="simRoutingContainer" class="sim2-matrix-wrap">
          <div class="empty">No routing decision data available yet.</div>
        </div>
      </div>

      <!-- TAB 3: Context & Memory / RAG Assembly -->
      <div id="simTabContext" class="sim2-tab-content">
        <div id="simContextContainer">
          <div class="empty">Context assembly details will appear after running a simulation turn.</div>
        </div>
      </div>

      <!-- TAB 4: Telegram Formatted Preview -->
      <div id="simTabTelegram" class="sim2-tab-content">
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Visual preview of chunked Telegram message delivery with HTML tags:</div>
        <div id="simTelegramPreview" class="sim-result" style="min-height:220px;padding:12px;background:var(--panel-3);border:1px solid var(--line);border-radius:10px;word-break:break-word">Telegram-formatted preview will appear here.</div>
      </div>

      <!-- TAB 5: Raw Output -->
      <div id="simTabRaw" class="sim2-tab-content">
        <div id="simRawResponse" class="sim-result" style="min-height:220px;padding:12px;background:var(--panel-3);border:1px solid var(--line);border-radius:10px;font-family:monospace;white-space:pre-wrap;font-size:12px;word-break:break-all">Raw model output text will appear here.</div>
      </div>

      <!-- TAB 6: Replay / Compare -->
      <div id="simTabReplay" class="sim2-tab-content">
        <div class="sim2-callout info">
          <b>Evaluation & Replay Mode:</b> Re-run this exact conversational context with alternative models, memory settings, or overrides to benchmark changes side-by-side.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn small" onclick="simReplayWithVariation('groq')">⚡ Replay on Groq</button>
          <button class="btn small" onclick="simReplayWithVariation('mistral')">🌪 Replay on Mistral</button>
          <button class="btn small" onclick="simReplayWithVariation('gemini')">✨ Replay on Gemini</button>
        </div>
        <div id="simReplayDiffContainer">
          <div class="empty">Replay a turn to compare latency, tokens, and response side-by-side.</div>
        </div>
      </div>
    </div>
  </div>
</section>

<script>
(function(){
  const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
  const fmtTime=(v)=>{try{return new Date(v).toLocaleTimeString()}catch{return String(v||'')}};

  let thread = [];
  let currentActiveTrace = null;
  let previousReplayRun = null;

  function activate(){
    const main=document.querySelector('main');
    const section=document.getElementById('view-simulator');
    if(!main||!section)return;
    const navs=[document.getElementById('nav'),document.getElementById('mobileNav')].filter(Boolean);
    navs.forEach(nav=>{
      if(nav.querySelector('[data-simulator-nav]'))return;
      const b=document.createElement('button');
      b.type='button'; b.textContent='🧪 Bot Simulator'; b.dataset.simulatorNav='1';
      b.onclick=()=>showSimulator(); nav.appendChild(b);
    });
    if(!document.getElementById('simulatorShell')){
      const marker=document.createElement('div'); marker.id='simulatorShell';
      marker.appendChild(section); main.appendChild(marker);
    }
    simFetchRunHistory();
  }

  window.showSimulator=function(){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('[data-simulator-nav]').forEach(b=>b.classList.add('active'));
    const section=document.getElementById('view-simulator'); if(section) section.classList.add('active');
    const shell=document.getElementById('simulatorShell'); if(shell) shell.style.display='block';
  };

  window.simUpdateOverrideBanner=function(){
    const val = document.getElementById('simProviderOverride').value;
    const banner = document.getElementById('simOverrideWarning');
    const target = document.getElementById('simOverrideTarget');
    if(val && val !== 'auto'){
      banner.style.display = 'block';
      target.textContent = val.toUpperCase();
    } else {
      banner.style.display = 'none';
    }
  };

  window.simSetMobileSection=function(sectionKey){
    const container = document.getElementById('sim2Container');
    if(container){
      container.classList.remove('sim2-mode-chat', 'sim2-mode-config', 'sim2-mode-trace');
      container.classList.add('sim2-mode-' + sectionKey);
    }
    document.querySelectorAll('.sim2-mobile-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.simSection === sectionKey);
    });
  };

  window.simSwitchTab=function(tabKey){
    document.querySelectorAll('.sim2-tab').forEach(t=>t.classList.toggle('active', t.dataset.simTab === tabKey));
    document.querySelectorAll('.sim2-tab-content').forEach(c=>c.classList.remove('active'));
    const target = document.getElementById('simTab' + tabKey.charAt(0).toUpperCase() + tabKey.slice(1));
    if(target) target.classList.add('active');
  };

  window.simClearConversation=function(){
    thread = [];
    currentActiveTrace = null;
    document.getElementById('simChatThread').innerHTML = '<div class="empty" style="margin:auto;text-align:center;color:var(--muted)">No simulation messages yet.<br><span style="font-size:12px">Type below to begin testing multi-turn conversation and state retention.</span></div>';
    document.getElementById('simThreadCount').textContent = '0 turns';
    document.getElementById('simStatModel').textContent = '—';
    document.getElementById('simStatLatency').textContent = '—';
    document.getElementById('simStatTokens').textContent = '—';
    document.getElementById('simStatCost').textContent = '—';
    document.getElementById('simTimelineContainer').innerHTML = '<div class="empty">Run a simulation turn to inspect the discrete step-by-step execution timeline.</div>';
    document.getElementById('simMultimodalContainer').innerHTML = '<div class="empty">Multimodal transparency, dynamic model discovery, video generation technique, and artifact preview will appear here when testing image/video requests.</div>';
    document.getElementById('simRoutingContainer').innerHTML = '<div class="empty">No routing decision data available yet.</div>';
    document.getElementById('simContextContainer').innerHTML = '<div class="empty">Context assembly details will appear after running a simulation turn.</div>';
    document.getElementById('simTelegramPreview').textContent = 'Telegram-formatted preview will appear here.';
    document.getElementById('simRawResponse').textContent = 'Raw model output text will appear here.';
  };

  window.runSimTurn=async function(){
    const input = document.getElementById('simMessageInput');
    const msg = input.value.trim();
    if(!msg) return;

    const btn = document.getElementById('simSubmitBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Thinking…';

    // Add user turn to UI immediately
    const userTurn = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    thread.push(userTurn);
    renderThread();
    input.value = '';

    try {
      const liveMedia = document.getElementById('simLiveMedia') ? document.getElementById('simLiveMedia').checked : false;
      const body = {
        message: msg,
        modeOverride: document.getElementById('simMode').value,
        personalityOverride: document.getElementById('simPersonality').value,
        userTier: document.getElementById('simUserTier').value,
        providerOverride: document.getElementById('simProviderOverride').value,
        includeHistory: true,
        enableLiveSearch: document.getElementById('simLiveSearch').checked,
        liveMediaGeneration: liveMedia,
        customHistory: thread.slice(0, -1).map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', content: t.content })),
      };

      const uid = document.getElementById('simUserId').value.trim();
      if(uid) body.telegramUserId = Number(uid);

      const r = await fetch('/api/simulator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if(!r.ok || !data.success) throw new Error(data.error || data.result?.error || 'Simulation turn failed');

      const res = data.result;
      currentActiveTrace = res.trace;

      // Add assistant turn to thread
      const assistantTurn = {
        role: 'assistant',
        content: res.response || '',
        preview: res.telegramPreview,
        trace: res.trace,
        mediaArtifact: res.mediaArtifact || res.trace?.multimodal?.artifact || (res.trace?.multimodal?.artifactUrl ? { url: res.trace.multimodal.artifactUrl, mimeType: res.trace.multimodal.mimeType, filename: res.trace.multimodal.modality } : undefined),
        timestamp: new Date().toISOString(),
      };
      thread.push(assistantTurn);
      renderThread();
      renderObservability(res.trace, res.response, res.telegramPreview);
      simFetchRunHistory();

      // If this was an image/video turn, switch to multimodal tab automatically
      if(res.trace?.multimodal){
        simSwitchTab('multimodal');
      }
    } catch(err) {
      const errTurn = {
        role: 'assistant',
        content: '⚠️ Simulation Execution Failed: ' + (err.message || String(err)),
        timestamp: new Date().toISOString(),
      };
      thread.push(errTurn);
      renderThread();
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Send Message';
    }
  };

  function renderThread(){
    const container = document.getElementById('simChatThread');
    if(!thread.length){
      container.innerHTML = '<div class="empty" style="margin:auto;text-align:center;color:var(--muted)">No simulation messages yet.</div>';
      document.getElementById('simThreadCount').textContent = '0 turns';
      return;
    }
    document.getElementById('simThreadCount').textContent = thread.length + ' turn' + (thread.length===1?'':'s');
    
    container.innerHTML = thread.map((turn, i) => {
      const isUser = turn.role === 'user';
      let meta = '';
      let mediaPreviewHtml = '';

      // Render media artifact if present
      if(turn.mediaArtifact?.url){
        const isVideo = turn.trace?.multimodal?.modality === 'video' || turn.mediaArtifact.mimeType?.includes('video');
        if(isVideo){
          mediaPreviewHtml = '<div style="margin-top:8px;border-radius:8px;overflow:hidden;background:#000;border:1px solid var(--line)">' +
            '<video controls playsinline preload="metadata" style="width:100%;max-height:260px;display:block">' +
              '<source src="' + esc(turn.mediaArtifact.url) + '" type="video/mp4">' +
            '</video>' +
          '</div>';
        } else {
          mediaPreviewHtml = '<div style="margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">' +
            '<img src="' + esc(turn.mediaArtifact.url) + '" alt="Generated artifact" style="width:100%;max-height:260px;object-fit:cover;display:block" />' +
          '</div>';
        }
      }

      if(turn.trace){
        const isMm = !!turn.trace.multimodal;
        const badgeClass = turn.trace.isTestOverride ? 'override' : (isMm ? 'winner' : 'winner');
        const modelLabel = esc((turn.trace.selectedProvider||'router') + ':' + (turn.trace.selectedModel||''));
        const lat = turn.trace.telemetry?.latencyMs || turn.trace.latencyMs || 0;
        const toks = turn.trace.telemetry?.totalTokens || 0;
        meta = '<div class="sim2-bubble-meta">' +
          '<span class="sim2-bubble-badge ' + badgeClass + '">' + modelLabel + '</span>' +
          (isMm ? '<span class="sim2-bubble-badge winner">' + (turn.trace.multimodal.isDryRun ? 'DRY-RUN' : 'LIVE MEDIA') + '</span>' : '') +
          '<span class="sim2-bubble-badge">' + lat + 'ms</span>' +
          (toks ? '<span class="sim2-bubble-badge">' + toks + ' tokens</span>' : '') +
          '<button class="btn small" style="padding:1px 6px;font-size:10px" onclick="simInspectTurnTrace(' + i + ')">🔍 Inspect</button>' +
        '</div>';
      }

      return '<div class="sim2-bubble ' + (isUser ? 'user' : 'assistant') + '">' +
        '<div>' + esc(turn.content) + '</div>' +
        mediaPreviewHtml +
        meta +
      '</div>';
    }).join('');

    container.scrollTop = container.scrollHeight;
  }

  window.simInspectTurnTrace=function(index){
    const turn = thread[index];
    if(turn && turn.trace){
      currentActiveTrace = turn.trace;
      renderObservability(turn.trace, turn.content, turn.preview);
    }
  };

  function renderObservability(trace, rawText, telegramPreview){
    if(!trace) return;

    // 1. Stats Bar
    document.getElementById('simStatModel').textContent = (trace.selectedProvider||'') + ':' + (trace.selectedModel||'adaptive');
    document.getElementById('simStatLatency').textContent = (trace.telemetry?.latencyMs || trace.latencyMs || 0) + ' ms';
    document.getElementById('simStatTokens').textContent = (trace.telemetry?.totalTokens || 0) + ' (est)';
    document.getElementById('simStatCost').textContent = '$' + (trace.telemetry?.estimatedCostUsd || 0).toFixed(6);

    // 2. Timeline Tab
    const timeline = trace.executionTimeline || [];
    const timelineContainer = document.getElementById('simTimelineContainer');
    if(!timeline.length){
      timelineContainer.innerHTML = '<div class="empty">No timeline steps recorded.</div>';
    } else {
      timelineContainer.innerHTML = timeline.map(step => {
        const pillClass = step.status === 'completed' ? 'good' : (step.status === 'failed' ? 'bad' : '');
        const durationText = step.durationMs ? ' • ' + step.durationMs + 'ms' : '';
        return '<div class="sim2-timeline-step">' +
          '<div class="sim2-timeline-head">' +
            '<span class="sim2-timeline-phase">Step ' + step.stepNumber + ': ' + esc(step.phase) + '</span>' +
            '<span class="pill ' + pillClass + '">' + esc(step.status) + durationText + '</span>' +
          '</div>' +
          '<div class="sim2-timeline-label">' + esc(step.label) + '</div>' +
          '<div class="sim2-timeline-details">' + esc(JSON.stringify(step.details, null, 2)) + '</div>' +
        '</div>';
      }).join('');
    }

    // MULTIMODAL TAB RENDERING
    const mm = trace.multimodal;
    const mmContainer = document.getElementById('simMultimodalContainer');
    if(!mm){
      mmContainer.innerHTML = '<div class="empty">This simulation turn did not trigger multimodal (image or video) generation. Send an image/video prompt to inspect media transparency.</div>';
    } else {
      const isDry = mm.isDryRun !== false && !mm.artifactUrl;
      const badge = isDry
        ? '<span class="pill" style="background:#3b82f622;color:#3b82f6;border:1px solid #3b82f644;font-size:12px;font-weight:700">🔬 SAFE DRY-RUN PREDICTION</span>'
        : '<span class="pill good" style="font-size:12px;font-weight:700">🚀 LIVE RUNTIME ARTIFACT</span>';

      let artifactHtml = '';
      if(mm.artifactUrl){
        if(mm.modality === 'video' || mm.mimeType?.includes('video')){
          artifactHtml = '<div style="margin:12px 0;background:#000;border-radius:10px;overflow:hidden;border:1px solid var(--line);max-width:540px">' +
            '<video controls playsinline preload="metadata" style="width:100%;max-height:320px;display:block">' +
              '<source src="' + esc(mm.artifactUrl) + '" type="video/mp4">' +
            '</video>' +
          '</div>';
        } else {
          artifactHtml = '<div style="margin:12px 0;border-radius:10px;overflow:hidden;border:1px solid var(--line);max-width:540px">' +
            '<img src="' + esc(mm.artifactUrl) + '" alt="Generated visual" style="width:100%;max-height:340px;object-fit:cover;display:block" />' +
          '</div>';
        }
      }

      let failoversHtml = '';
      if(mm.failovers && mm.failovers.length > 0){
        failoversHtml = '<div style="margin-top:12px;background:var(--panel);border:1px solid color-mix(in srgb,#f59e0b 40%,transparent);border-radius:10px;padding:12px">' +
          '<div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:6px">⚠️ Provider Failover History (' + mm.failovers.length + ')</div>' +
          '<table class="sim2-matrix-table" style="font-size:11.5px">' +
            '<thead><tr><th>Failed Provider</th><th>Model</th><th>HTTP/Error</th><th>Fallback To</th></tr></thead>' +
            '<tbody>' + mm.failovers.map(f => '<tr><td><b>' + esc(f.provider) + '</b></td><td>' + esc(f.modelId) + '</td><td><span style="color:#ef4444">' + esc(f.errorCategory || f.errorMessage) + '</span></td><td>' + esc(f.fallbackProvider || 'next') + '</td></tr>').join('') + '</tbody>' +
          '</table>' +
        '</div>';
      }

      mmContainer.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;font-weight:700;text-transform:uppercase;color:var(--text)">' + esc(mm.modality) + ' GENERATION ENGINE</span>' + badge + '</div>' +
        '<span style="font-size:12px;color:var(--muted)">Latency: <b>' + (mm.latencyMs || trace.latencyMs || 0) + 'ms</b></span>' +
      '</div>' +
      artifactHtml +
      '<div class="sim2-meta-grid" style="margin-bottom:12px">' +
        '<div class="sim2-meta-card"><b>Selected Provider</b><span>' + esc(mm.selectedProvider || trace.selectedProvider) + '</span></div>' +
        '<div class="sim2-meta-card"><b>Model ID</b><span>' + esc(mm.selectedModel || trace.selectedModel) + '</span></div>' +
        (mm.modality === 'video' ? '<div class="sim2-meta-card"><b>Video Technique</b><span style="color:var(--accent,#3b82f6)">' + esc(mm.videoTechnique || 'video_diffusion') + '</span></div>' : '') +
        '<div class="sim2-meta-card"><b>Quota Status</b><span>' + (mm.quotaDeducted ? '1 deducted' : 'Dry-run safe') + '</span></div>' +
        (mm.deliveryUrl ? '<div class="sim2-meta-card"><b>Delivery Storage</b><span>' + esc(mm.storageBackend || 'Local/Cloud') + '</span></div>' : '') +
      '</div>' +
      '<div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px">' +
        '<div style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px">Enhanced Multimodal Prompt</div>' +
        '<div style="font-size:12.5px;color:var(--text);line-height:1.5">' + esc(mm.enhancedPrompt || trace.routingReasons?.join(', ') || 'Direct prompt') + '</div>' +
      '</div>' +
      (mm.deliveryUrl ? '<div style="background:var(--panel-3);border:1px solid var(--line);border-radius:8px;padding:9px;font-size:11px;font-family:monospace;word-break:break-all;color:var(--muted);margin-bottom:10px">🔗 Delivery URL: ' + esc(mm.deliveryUrl) + '</div>' : '') +
      failoversHtml;
    }

    // 3. Routing Matrix Tab
    const routingContainer = document.getElementById('simRoutingContainer');
    const matrix = trace.candidateMatrix || [];
    const winnerReasons = trace.routingReasons || [];
    const overrideBanner = trace.isTestOverride ? '<div class="sim2-callout warning">⚠️ <b>TEST OVERRIDE ACTIVE:</b> Production routing was bypassed. Forced model was selected directly.</div>' : '';

    const matrixRows = matrix.map(c => {
      const rowClass = c.status === 'WINNER' ? 'winner' : (c.status === 'unhealthy' ? 'unhealthy' : '');
      const tagClass = c.status === 'WINNER' ? 'win' : (c.status === 'unhealthy' ? 'unhealthy' : 'eligible');
      return '<tr class="' + rowClass + '">' +
        '<td><b>' + esc(c.name || c.modelId) + '</b><br><span style="font-size:10px;color:var(--muted)">' + esc(c.modelId) + '</span></td>' +
        '<td>' + esc(c.provider) + '</td>' +
        '<td><span class="sim2-tag ' + tagClass + '">' + esc(c.status) + '</span></td>' +
        '<td><b>' + c.totalScore + '</b></td>' +
        '<td>' + c.healthScore + '%</td>' +
        '<td>' + c.latencyMs + 'ms</td>' +
      '</tr>';
    }).join('');

    const reasonsList = winnerReasons.map(r => '<li>' + esc(r) + '</li>').join('') || '<li>Standard default candidate priority selection.</li>';

    routingContainer.innerHTML = overrideBanner +
      '<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Evaluated Routing Candidates</div>' +
      '<table class="sim2-matrix-table">' +
        '<thead>' +
          '<tr>' +
            '<th>Model Candidate</th>' +
            '<th>Provider</th>' +
            '<th>Status</th>' +
            '<th>Total Score</th>' +
            '<th>Health</th>' +
            '<th>Latency</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + matrixRows + '</tbody>' +
      '</table>' +
      '<div style="margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px">Why ' + esc(trace.selectedModel || 'winner') + ' was chosen:</div>' +
        '<ul style="margin:0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.6">' + reasonsList + '</ul>' +
      '</div>';

    // 4. Context & Memory Tab
    const ctx = trace.contextAssembly || {};
    const contextContainer = document.getElementById('simContextContainer');
    const memories = ctx.longTermMemories || [];
    const knowledge = ctx.retrievedKnowledge || [];

    const memoryHtml = memories.length
      ? memories.map(m => '<div style="font-size:12px;margin-top:4px">• <b>' + esc(m.key) + ':</b> ' + esc(m.content) + ' <span style="font-size:10px;color:var(--muted)">(' + esc(m.category) + ')</span></div>').join('')
      : '<div style="font-size:12px;color:var(--muted)">No active user memory facts injected for this user ID.</div>';

    const knowledgeHtml = knowledge.length
      ? knowledge.map(k => '<div style="font-size:12px;margin-top:4px">• <b>' + esc(k.title) + '</b> (Relevance: ' + k.score + '): <span style="color:var(--muted)">' + esc(k.snippet) + '</span></div>').join('')
      : '<div style="font-size:12px;color:var(--muted)">No external knowledge chunks retrieved for this query.</div>';

    contextContainer.innerHTML = '' +
      '<div class="sim2-context-item">' +
        '<div class="sim2-context-item-head"><span>USER PROFILE & TIER POLICY</span><span class="pill">' + esc(ctx.userPreferences?.tier || 'FREE') + '</span></div>' +
        '<div style="font-size:12px;color:var(--text)">Personality: <b>' + esc(ctx.userPreferences?.personality || 'playful') + '</b> • Persistent Mode: <b>' + esc(ctx.userPreferences?.mode || 'general') + '</b></div>' +
      '</div>' +
      '<div class="sim2-context-item">' +
        '<div class="sim2-context-item-head"><span>CONVERSATION HISTORY ASSEMBLED</span><span>' + (ctx.historyMessagesCount || 0) + ' messages</span></div>' +
        '<div style="font-size:11.5px;color:var(--muted)">Injected ' + (ctx.historySnippets?.length || 0) + ' recent turns into runtime memory window.</div>' +
      '</div>' +
      '<div class="sim2-context-item">' +
        '<div class="sim2-context-item-head"><span>LONG-TERM MEMORIES (PGVECTOR / USER STORE)</span><span>' + memories.length + ' facts</span></div>' +
        memoryHtml +
      '</div>' +
      '<div class="sim2-context-item">' +
        '<div class="sim2-context-item-head"><span>KNOWLEDGE VAULT RAG CHUNKS</span><span>' + knowledge.length + ' chunks</span></div>' +
        knowledgeHtml +
      '</div>';

    // 5. Telegram & Raw
    document.getElementById('simTelegramPreview').textContent = telegramPreview || rawText || '';
    document.getElementById('simRawResponse').textContent = rawText || '';
  }

  window.simReplayWithVariation=async function(providerKey){
    if(!thread.length){ alert('Please run a simulation turn first before replaying.'); return; }
    const lastUserTurn = [...thread].reverse().find(t => t.role === 'user');
    if(!lastUserTurn) return;

    document.getElementById('simProviderOverride').value = providerKey;
    simUpdateOverrideBanner();
    simSwitchTab('replay');

    const diffContainer = document.getElementById('simReplayDiffContainer');
    diffContainer.innerHTML = '<div class="empty">Replaying with forced provider: <b>' + esc(providerKey.toUpperCase()) + '</b>…</div>';

    try {
      const body = {
        message: lastUserTurn.content,
        modeOverride: document.getElementById('simMode').value,
        personalityOverride: document.getElementById('simPersonality').value,
        userTier: document.getElementById('simUserTier').value,
        providerOverride: providerKey,
        includeHistory: true,
        enableLiveSearch: document.getElementById('simLiveSearch').checked,
        customHistory: thread.filter(t => t !== lastUserTurn).map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', content: t.content })),
      };

      const uid = document.getElementById('simUserId').value.trim();
      if(uid) body.telegramUserId = Number(uid);

      const r = await fetch('/api/simulator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if(!r.ok || !data.success) throw new Error(data.error || 'Replay failed');

      const res = data.result;
      const t = res.trace;
      const origLat = currentActiveTrace?.telemetry?.latencyMs || 0;
      const origToks = currentActiveTrace?.telemetry?.totalTokens || 0;
      const origProv = currentActiveTrace?.selectedProvider || 'orig';
      const repLat = t.telemetry?.latencyMs || t.latencyMs || 0;
      const repToks = t.telemetry?.totalTokens || 0;
      const repCost = (t.telemetry?.estimatedCostUsd || 0).toFixed(6);

      diffContainer.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">' +
        '<div style="background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px">' +
          '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase">Previous Turn (' + esc(origProv) + ')</div>' +
          '<div style="font-size:12px;margin:6px 0">Latency: <b>' + origLat + 'ms</b> • Tokens: <b>' + origToks + '</b></div>' +
          '<div style="font-size:12px;color:var(--muted);max-height:180px;overflow:auto">' + esc(document.getElementById('simRawResponse').textContent) + '</div>' +
        '</div>' +
        '<div style="background:var(--panel);border:1px solid color-mix(in srgb,var(--accent,#3b82f6) 40%,transparent);border-radius:10px;padding:12px">' +
          '<div style="font-size:11px;font-weight:700;color:var(--accent,#3b82f6);text-transform:uppercase">Replayed Turn (' + esc(t.selectedProvider) + ')</div>' +
          '<div style="font-size:12px;margin:6px 0">Latency: <b>' + repLat + 'ms</b> • Tokens: <b>' + repToks + '</b> • Cost: <b>$' + repCost + '</b></div>' +
          '<div style="font-size:12px;color:var(--text);max-height:180px;overflow:auto">' + esc(res.response) + '</div>' +
        '</div>' +
      '</div>';
    } catch(e){
      diffContainer.innerHTML = '<div class="sim2-callout warning">Replay failed: ' + esc(e.message || String(e)) + '</div>';
    }
  };

  window.simExportCurrentTrace=function(){
    if(!currentActiveTrace){ alert('No simulation trace available to export. Run a simulation turn first.'); return; }
    const blob = new Blob([JSON.stringify({ thread, activeTrace: currentActiveTrace, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wingbuddy_simulation_trace_' + (currentActiveTrace.simulationId || Date.now()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  window.simFetchRunHistory=async function(){
    const list = document.getElementById('simRunsList');
    if(!list) return;
    try {
      const r = await fetch('/api/simulator/runs?limit=15');
      const data = await r.json();
      if(!r.ok || !data.success) throw new Error(data.error || 'History failed');
      if(!data.runs.length){
        list.innerHTML = '<div class="empty" style="font-size:12px">No persisted runs found.</div>';
        return;
      }
      list.innerHTML = data.runs.map(run => {
        const pillClass = run.status === 'completed' ? 'good' : 'bad';
        return '<div class="sim2-run-item" onclick="simLoadPersistedRun(\'' + run.id + '\')">' +
          '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">' +
            '<b>' + esc(run.message) + '</b>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="pill ' + pillClass + '">' + esc(run.status) + '</span>' +
            '<span style="font-size:10.5px;color:var(--muted)">' + esc(fmtTime(run.created_at)) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    } catch(e){
      list.innerHTML = '<div class="empty" style="font-size:12px">' + esc(e.message || String(e)) + '</div>';
    }
  };

  window.simLoadPersistedRun=async function(id){
    try {
      const r = await fetch('/api/simulator/runs/' + encodeURIComponent(id));
      const data = await r.json();
      if(!r.ok || !data.success) throw new Error(data.error || 'Run not found');
      const run = data.run;
      const trace = run.trace_json || {};
      currentActiveTrace = trace;
      
      thread = [
        { role: 'user', content: run.message, timestamp: run.created_at },
        { role: 'assistant', content: run.response || '', preview: run.telegram_preview, trace, timestamp: run.created_at }
      ];
      renderThread();
      renderObservability(trace, run.response, run.telegram_preview);
    } catch(e){
      alert(e.message || String(e));
    }
  };

  window.simFillPrompt=function(text){
    const input = document.getElementById('simMessageInput');
    if(input){
      input.value = text;
      input.focus();
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',activate);else setTimeout(activate,0);
})();
</script>`;
}

