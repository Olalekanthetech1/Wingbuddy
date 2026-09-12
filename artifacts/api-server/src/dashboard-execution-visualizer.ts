export function renderDashboardExecutionVisualizer(): string {
  return String.raw`
<style>
.wb-dag-suite {
  margin-top: 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  padding: 18px;
  box-shadow: var(--shadow);
  color: var(--text);
  transition: background-color .18s ease, color .18s ease, border-color .18s ease;
}
.wb-dag-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.wb-dag-modes {
  display: inline-flex;
  background: var(--panel-3);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.wb-dag-mode-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 13px;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wb-dag-mode-btn:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}
.wb-dag-mode-btn.active {
  background: var(--primary, #145aa0);
  color: var(--on-primary, #ffffff);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* Launcher Box */
.wb-dag-launcher {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 16px;
}
.wb-dag-input-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.wb-dag-goal-input {
  flex: 1;
  background: var(--panel-3);
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--text);
  font-size: 13px;
  padding: 10px 14px;
  min-height: 44px;
  resize: vertical;
  font-family: inherit;
}
.wb-dag-goal-input:focus {
  outline: none;
  border-color: var(--line-strong);
}
.wb-dag-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.wb-dag-chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--panel-3);
  border: 1px solid var(--line);
  color: var(--text);
  cursor: pointer;
  transition: all 0.12s ease;
}
.wb-dag-chip:hover {
  background: var(--panel-2);
  border-color: var(--line-strong);
}

/* Stepper & Controls Toolbar */
.wb-stepper-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 14px;
}
.wb-stepper-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wb-stepper-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.wb-stepper-summary {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  gap: 10px;
  align-items: center;
}

/* Timeline Replay Bar */
.wb-replay-bar {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wb-replay-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wb-replay-scrubber {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 3px;
  background: var(--panel-3);
  outline: none;
  cursor: pointer;
}
.wb-replay-scrubber::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary, #2a78ca);
  border: 2px solid var(--panel);
  cursor: pointer;
  box-shadow: 0 0 6px rgba(42, 120, 202, 0.5);
}
.wb-replay-meta {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
}

/* Two-column layout: Visualizer on left, Inspectors on right */
.wb-dag-workspace {
  display: grid;
  grid-template-columns: 1.65fr 1.35fr;
  gap: 14px;
  min-height: 480px;
}
@media (max-width: 1024px) {
  .wb-dag-workspace {
    grid-template-columns: 1fr;
  }
}

/* Canvas Area */
.wb-dag-canvas-card {
  background: var(--panel-3);
  border: 1px solid var(--line);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 480px;
}
.wb-dag-canvas-head {
  padding: 10px 14px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.wb-dag-canvas-stage {
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 24px 20px;
  background-image: radial-gradient(color-mix(in srgb, var(--line-strong) 30%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
  min-height: 420px;
}

/* SVG Connection Lines */
.wb-dag-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}
.wb-dag-edge {
  fill: none;
  stroke: var(--line-strong);
  stroke-width: 2px;
  stroke-dasharray: 4 2;
  transition: all 0.25s ease;
}
.wb-dag-edge.active {
  stroke: var(--primary, #2a78ca);
  stroke-width: 2.5px;
  stroke-dasharray: none;
  filter: drop-shadow(0 0 3px rgba(42, 120, 202, 0.6));
}
.wb-dag-edge.completed {
  stroke: var(--green, #37d39a);
  stroke-width: 2px;
  stroke-dasharray: none;
}

/* Interactive Node Tier Layout */
.wb-dag-tiers {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 56px;
  align-items: flex-start;
  min-width: max-content;
  padding-bottom: 24px;
}
.wb-dag-tier-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 170px;
  max-width: 200px;
}
.wb-dag-tier-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  text-align: center;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 4px;
}

/* Visual Node Card */
.wb-node-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.wb-node-card:hover {
  transform: translateY(-2px);
  border-color: var(--line-strong);
  background: var(--panel-2);
}
.wb-node-card.selected {
  border-color: var(--primary, #2a78ca);
  background: var(--panel-2);
  box-shadow: 0 0 0 2px rgba(42, 120, 202, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
}
.wb-node-card.status-running {
  border-color: var(--primary, #2a78ca);
  animation: wbPulse 1.6s infinite ease-in-out;
}
.wb-node-card.status-completed {
  border-color: color-mix(in srgb, var(--green, #37d39a) 50%, transparent);
}
.wb-node-card.status-waiting_approval {
  border-color: color-mix(in srgb, #f5b74f 60%, transparent);
  background: color-mix(in srgb, #f5b74f 10%, var(--panel));
}
.wb-node-card.status-failed {
  border-color: color-mix(in srgb, #ff6675 60%, transparent);
  background: color-mix(in srgb, #ff6675 10%, var(--panel));
}

@keyframes wbPulse {
  0% { box-shadow: 0 0 0 0 rgba(42, 120, 202, 0.6); }
  70% { box-shadow: 0 0 0 8px rgba(42, 120, 202, 0); }
  100% { box-shadow: 0 0 0 0 rgba(42, 120, 202, 0); }
}

.wb-node-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.wb-node-type-icon {
  font-size: 14px;
}
.wb-node-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}
.wb-node-sub {
  font-size: 10.5px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.wb-node-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
}

/* Right Column: Tabbed Inspector Card */
.wb-inspector-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 480px;
}
.wb-inspector-tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}
.wb-inspector-tab {
  flex: 1;
  text-align: center;
  padding: 10px 8px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--muted);
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}
.wb-inspector-tab:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 5%, transparent);
}
.wb-inspector-tab.active {
  color: var(--primary, #2a78ca);
  border-bottom-color: var(--primary, #2a78ca);
  background: var(--panel);
}
.wb-inspector-content {
  flex: 1;
  padding: 14px;
  overflow-y: auto;
  font-size: 12px;
  max-height: 440px;
}

/* Explain Why Sections */
.wb-explain-item {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.wb-explain-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 12px;
  color: var(--primary, #2a78ca);
  margin-bottom: 4px;
}
.wb-explain-desc {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text);
}
.wb-explain-metric {
  display: inline-block;
  font-size: 10.5px;
  background: var(--panel-3);
  border: 1px solid var(--line);
  padding: 2px 7px;
  border-radius: 5px;
  color: var(--muted);
  margin-top: 5px;
  margin-right: 5px;
}

/* JSON Viewer Code Blocks */
.wb-code-block {
  background: var(--panel-3);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text);
  overflow-x: auto;
  max-height: 220px;
  white-space: pre-wrap;
  word-break: break-word;
  margin-top: 6px;
}
.wb-prop-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
}
.wb-prop-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.wb-prop-table td:first-child {
  color: var(--muted);
  width: 35%;
  font-weight: 600;
}
</style>

<div id="wbDagRoot" class="wb-dag-suite">
  <!-- Control Center Header -->
  <div class="wb-dag-header">
    <div>
      <div style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px">
        <span>⚡ Interactive Execution Control Center</span>
        <span id="wbDagActiveStatus" class="pill good">READY</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px" id="wbDagSubtitle">
        Real-time DAG visualization, state transitions, step-by-step execution, and structured explanations.
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <!-- Mode Tabs -->
      <div class="wb-dag-modes" id="wbDagModes">
        <button class="wb-dag-mode-btn" data-mode="PLAN_ONLY" onclick="window.__wbSetMode('PLAN_ONLY')">📋 Plan Only</button>
        <button class="wb-dag-mode-btn" data-mode="DRY_RUN" onclick="window.__wbSetMode('DRY_RUN')">🛡️ Dry Run</button>
        <button class="wb-dag-mode-btn active" data-mode="LIVE_RUN" onclick="window.__wbSetMode('LIVE_RUN')">🚀 Live Run</button>
      </div>
      <button class="btn small" onclick="window.__wbRefreshActiveGraph()">↻ Sync State</button>
    </div>
  </div>

  <!-- Execution Launcher Box -->
  <div class="wb-dag-launcher">
    <div class="wb-dag-input-row">
      <textarea id="wbDagGoal" class="wb-dag-goal-input" rows="2" placeholder="Specify multi-step objective or prompt (e.g. 'Research quantum computing developments, extract top 3 papers, and format telegram briefing')"></textarea>
      <div style="display:flex;flex-direction:column;gap:6px;justify-content:center">
        <button id="wbDagLaunchBtn" class="btn primary" onclick="window.__wbLaunchSelectedMode()">🚀 Execute Mode</button>
        <button class="btn small" onclick="window.__wbStepNextNode()">⏯️ Step Next</button>
      </div>
    </div>
    <div class="wb-dag-presets">
      <span style="font-size:11px;color:var(--muted);margin-right:4px">Presets:</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Research latest generative AI breakthroughs and format briefing')">🔬 AI Research & Briefing</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Fetch system stats, check disk and memory pressure, and alert admin')">📊 Ops Health Check</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Extract facts from conversation, store into long-term memory, and confirm')">💾 Memory Synthesis</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Calculate Fibonacci sequence 1..20 and output table')">🔢 Math Algorithm</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Generate a photo-realistic cyberpunk cityscape at sunset with neon reflections, 16:9 4k resolution')">🎨 Image Generation</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Generate a cinematic 5-second video of an astronaut floating in deep space near Jupiter')">🎬 Video Generation</span>
      <span class="wb-dag-chip" onclick="window.__wbFillPreset('Generate product banner image, then create 4-second motion trailer video from it, and compose marketing briefing')">🔗 Multimodal Chaining</span>
    </div>
  </div>

  <!-- Stepper & Execution Controls Bar -->
  <div class="wb-stepper-bar">
    <div class="wb-stepper-left">
      <button class="btn small primary" onclick="window.__wbStepNextNode()">⏯️ Step Next Node</button>
      <button class="btn small" id="wbRerunBtn" onclick="window.__wbRerunSelectedNode()" title="Re-run currently selected node">🔄 Re-run Node</button>
      <button class="btn small" id="wbPauseBtn" onclick="window.__wbPauseCurrentExecution()">⏸️ Pause</button>
      <button class="btn small" id="wbResumeBtn" onclick="window.__wbResumeCurrentExecution()">▶️ Resume</button>
      <button class="btn small danger" id="wbCancelBtn" onclick="window.__wbCancelCurrentExecution()">⏹️ Cancel</button>
    </div>
    <div class="wb-stepper-right">
      <div class="wb-stepper-summary" id="wbDagSessionMeta">
        <span>Graph: <strong id="wbMetaGraphId">—</strong></span>
        <span>Rev: <strong id="wbMetaRevision">—</strong></span>
        <span>Status: <strong id="wbMetaStatus">—</strong></span>
        <span>Progress: <strong id="wbMetaProgress">0/0</strong></span>
      </div>
    </div>
  </div>

  <!-- Timeline Event Stream Replay Bar -->
  <div class="wb-replay-bar" id="wbReplayBar">
    <div class="wb-replay-controls">
      <button class="btn small" onclick="window.__wbReplayStepFirst()" title="First event">⏮ First</button>
      <button class="btn small" onclick="window.__wbReplayStepBack()" title="Previous event">◀ Step Back</button>
      <button class="btn small primary" id="wbReplayPlayBtn" onclick="window.__wbToggleReplayPlayback()">▶ Play Replay</button>
      <button class="btn small" onclick="window.__wbReplayStepForward()" title="Next event">Step Fwd ▶</button>
      <button class="btn small" onclick="window.__wbReplayStepLast()" title="Latest event">Latest ⏭</button>
      <input type="range" id="wbReplayScrubber" class="wb-replay-scrubber" min="0" max="0" value="0" oninput="window.__wbOnScrubTimeline(this.value)"/>
    </div>
    <div class="wb-replay-meta">
      <span id="wbReplayEventDesc">Timeline replay inactive. Launch an execution or select a session to scrub event stream.</span>
      <span id="wbReplayEventIndex">0 / 0 Events</span>
    </div>
  </div>

  <!-- Workspace: DAG Canvas + Multi-Inspector -->
  <div class="wb-dag-workspace">
    <!-- Left Column: DAG Flow Canvas -->
    <div class="wb-dag-canvas-card">
      <div class="wb-dag-canvas-head">
        <div><strong>Topological Dependency Graph</strong> <span id="wbCanvasNodeCount" class="pill" style="margin-left:6px">0 Nodes</span></div>
        <div style="font-size:11px;color:var(--muted)">Click node to inspect bindings & output</div>
      </div>
      <div class="wb-dag-canvas-stage" id="wbDagStage">
        <svg id="wbDagSvg" class="wb-dag-svg"></svg>
        <div id="wbDagTiers" class="wb-dag-tiers">
          <div style="color:var(--muted);font-size:12px;padding:30px">No active graph compiled. Launch a mode or select an execution from the table below.</div>
        </div>
      </div>
    </div>

    <!-- Right Column: Inspector Panel -->
    <div class="wb-inspector-card">
      <div class="wb-inspector-tabs">
        <button class="wb-inspector-tab active" data-tab="inspector" onclick="window.__wbSetInspectorTab('inspector')">🔍 Node Inspector</button>
        <button class="wb-inspector-tab" data-tab="explain" onclick="window.__wbSetInspectorTab('explain')">🧠 Explain Why</button>
        <button class="wb-inspector-tab" data-tab="timeline" onclick="window.__wbSetInspectorTab('timeline')">📜 Event Log</button>
        <button class="wb-inspector-tab" data-tab="multimodal" onclick="window.__wbSetInspectorTab('multimodal')">🎨 Multimodal & Jobs</button>
        <button class="wb-inspector-tab" data-tab="diagnostics" onclick="window.__wbSetInspectorTab('diagnostics')">🛡️ Policies</button>
        <button class="wb-inspector-tab" data-tab="regression" onclick="window.__wbSetInspectorTab('regression')">🧪 Eval & Tests</button>
      </div>

      <!-- Tab 1: Node Inspector -->
      <div class="wb-inspector-content" id="wbTabInspector">
        <div id="wbNodeDetailEmpty" style="color:var(--muted);text-align:center;padding:40px 10px">
          Select a node in the DAG canvas to inspect its action specifications, bindings, parameters, and output results.
        </div>
        <div id="wbNodeDetailCard" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <h4 id="wbInspectNodeTitle" style="margin:0;font-size:14px;color:var(--text)">Node Name</h4>
              <div id="wbInspectNodeId" class="mono" style="color:var(--blue);font-size:11px;margin-top:2px">node_id</div>
            </div>
            <span id="wbInspectNodeStatus" class="pill good">completed</span>
          </div>

          <table class="wb-prop-table">
            <tr><td>Node Type</td><td id="wbInspectNodeType">—</td></tr>
            <tr><td>Action / Tool</td><td id="wbInspectNodeAction" class="mono">—</td></tr>
            <tr><td>Execution State</td><td id="wbInspectNodeState">—</td></tr>
            <tr><td>Attempts / Retries</td><td id="wbInspectNodeAttempts">1 / 3</td></tr>
            <tr><td>Execution Time</td><td id="wbInspectNodeDuration">—</td></tr>
          </table>

          <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin:10px 0 4px">Input Bindings & Parameters</div>
          <pre id="wbInspectNodeInputs" class="wb-code-block">{}</pre>

          <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin:12px 0 4px">Output / Execution Result</div>
          <pre id="wbInspectNodeOutputs" class="wb-code-block">{}</pre>

          <div id="wbInspectNodeArtifactWrap" style="display:none;margin-top:12px">
            <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Generated Multimodal Artifact Preview</div>
            <div id="wbInspectNodeArtifactPreview" style="background:var(--panel-3);border:1px solid var(--line);border-radius:8px;padding:10px;text-align:center"></div>
          </div>
        </div>
      </div>

      <!-- Tab 2: Explain Why Inspector -->
      <div class="wb-inspector-content" id="wbTabExplain" style="display:none">
        <div id="wbExplainReport">
          <div style="color:var(--muted);text-align:center;padding:40px 10px">
            No execution explanation generated yet. Compile or run a DAG to inspect human-readable model choices, retries, and fallbacks.
          </div>
        </div>
      </div>

      <!-- Tab 3: Timeline Event Stream Log -->
      <div class="wb-inspector-content" id="wbTabTimeline" style="display:none">
        <div id="wbTimelineList" style="display:flex;flex-direction:column;gap:8px">
          <div style="color:var(--muted);text-align:center;padding:40px 10px">
            No timeline events recorded yet.
          </div>
        </div>
      </div>

      <!-- Tab: Multimodal Artifacts & Async Jobs -->
      <div class="wb-inspector-content" id="wbTabMultimodal" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <h4 style="margin:0;font-size:14px;color:var(--text)">Universal Multimodal Artifacts & Async Jobs</h4>
            <div style="color:var(--muted);font-size:11px;margin-top:2px">DAG media artifacts, lifecycle states & async poller status</div>
          </div>
          <button class="btn small" onclick="window.__wbRefreshMultimodalTab()">↻ Refresh</button>
        </div>

        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin:10px 0 6px">Active Async Generation Jobs</div>
        <div id="wbAsyncJobsList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
          <div style="color:var(--muted);font-size:11px;padding:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;text-align:center">
            No active async jobs in progress.
          </div>
        </div>

        <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin:10px 0 6px">Registered DAG Media Artifacts</div>
        <div id="wbDagArtifactsList" style="display:flex;flex-direction:column;gap:8px">
          <div style="color:var(--muted);font-size:11px;padding:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;text-align:center">
            No media artifacts registered for current DAG run.
          </div>
        </div>
      </div>

      <!-- Tab 4: Diagnostics & Safety Policies -->
      <div class="wb-inspector-content" id="wbTabDiagnostics" style="display:none">
        <div id="wbDiagnosticsBody">
          <div class="wb-explain-item">
            <div class="wb-explain-head">Pre-Execution Policy Status</div>
            <div class="wb-explain-desc" id="wbPolicyStatusText">Every proposed node action is checked against domain whitelists, execution budgets, and destructive-action rules before execution authority is granted.</div>
          </div>
          <div class="wb-explain-item">
            <div class="wb-explain-head">Graph Validation</div>
            <div class="wb-explain-desc" id="wbValidationText">Awaiting DAG compilation.</div>
          </div>
        </div>
      </div>

      <!-- Tab 5: Evaluation & Regression Testing Suite -->
      <div class="wb-inspector-content" id="wbTabRegression" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <h4 style="margin:0;font-size:14px;color:var(--text)">Phase 5: Evaluation & Regression Testing</h4>
            <div style="color:var(--muted);font-size:11px;margin-top:2px">Configurable test fixtures for tool accuracy, budgets & verification rules</div>
          </div>
          <span id="wbEvalSuiteBadge" class="pill good">100% Passing</span>
        </div>

        <!-- Metrics Scorecard -->
        <div class="wb-eval-scorecard" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
          <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Tool Accuracy</div>
            <div id="wbScoreToolAcc" style="font-size:18px;font-weight:800;color:var(--green)">100%</div>
            <div style="font-size:10px;color:var(--muted)">JSON schema & params</div>
          </div>
          <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Budget Compliance</div>
            <div id="wbScoreBudget" style="font-size:18px;font-weight:800;color:var(--green)">100%</div>
            <div style="font-size:10px;color:var(--muted)">Token & latency budget</div>
          </div>
          <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Verification Rules</div>
            <div id="wbScoreVerif" style="font-size:18px;font-weight:800;color:var(--blue)">100%</div>
            <div style="font-size:10px;color:var(--muted)">Invariants & review pass</div>
          </div>
          <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Resilience Recovery</div>
            <div id="wbScoreRecovery" style="font-size:18px;font-weight:800;color:var(--blue)">100%</div>
            <div style="font-size:10px;color:var(--muted)">Retry & idempotency</div>
          </div>
        </div>

        <!-- Controls Toolbar -->
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn small primary" id="wbRunEvalSuiteBtn" onclick="window.__wbRunEvalSuite()">🚀 Run All Fixtures</button>
          <select id="wbEvalFixtureSelect" class="btn small" style="background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px 8px">
            <option value="">Select Fixture...</option>
            <option value="fix_tool_accuracy_web_search">Tool Accuracy (Web Search Schema)</option>
            <option value="fix_budget_compliance_dag">Budget Compliance (DAG Limits)</option>
            <option value="fix_verification_rules_checkpoint">Verification Rules (Invariants)</option>
            <option value="fix_resilience_bounded_retry">Resilience (Bounded Backoff & Leases)</option>
          </select>
          <button class="btn small" onclick="window.__wbRunSelectedFixture()">Run Fixture</button>
        </div>

        <!-- Fixtures & Assertions View -->
        <div id="wbEvalFixtureDetails">
          <div style="font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;margin:8px 0 4px">Active Regression Fixtures & Assertions</div>
          <div id="wbEvalAssertionsList" style="display:flex;flex-direction:column;gap:6px">
            <div style="color:var(--muted);font-size:12px;padding:20px 0;text-align:center">Loading evaluation fixtures...</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  const dagState = {
    mode: 'LIVE_RUN',
    currentGraph: null,
    currentSession: null,
    nodeResults: {},
    selectedNodeId: null,
    explainReport: null,
    timeline: [],
    replayIndex: 0,
    replayPlaying: false,
    replayTimer: null,
  };

  function esc(v) {
    return String(v == null ? '' : v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  function toast(msg, bad) {
    if (window.toast) {
      window.toast(msg, bad);
    } else {
      const t = document.getElementById('toast');
      if (t) {
        t.textContent = msg;
        t.style.display = 'block';
        t.style.borderColor = bad ? 'rgba(255,102,117,.4)' : '#2a4665';
        setTimeout(() => { t.style.display = 'none'; }, 3500);
      }
    }
  }

  async function api(path, options) {
    const r = await fetch(path, options);
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  window.__wbSetMode = function(mode) {
    dagState.mode = mode;
    document.querySelectorAll('#wbDagModes button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const launchBtn = document.getElementById('wbDagLaunchBtn');
    if (launchBtn) {
      if (mode === 'PLAN_ONLY') {
        launchBtn.textContent = '📋 Compile Plan Only';
      } else if (mode === 'DRY_RUN') {
        launchBtn.textContent = '🛡️ Simulate Dry Run';
      } else {
        launchBtn.textContent = '🚀 Live Run';
      }
    }
  };

  window.__wbFillPreset = function(text) {
    const input = document.getElementById('wbDagGoal');
    if (input) {
      input.value = text;
      input.focus();
    }
  };

  window.__wbSetInspectorTab = function(tabName) {
    document.querySelectorAll('.wb-inspector-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.getElementById('wbTabInspector').style.display = tabName === 'inspector' ? 'block' : 'none';
    document.getElementById('wbTabExplain').style.display = tabName === 'explain' ? 'block' : 'none';
    document.getElementById('wbTabTimeline').style.display = tabName === 'timeline' ? 'block' : 'none';
    document.getElementById('wbTabDiagnostics').style.display = tabName === 'diagnostics' ? 'block' : 'none';
    const mmTab = document.getElementById('wbTabMultimodal');
    if (mmTab) mmTab.style.display = tabName === 'multimodal' ? 'block' : 'none';
    if (tabName === 'multimodal' && typeof window.__wbRefreshMultimodalTab === 'function') {
      window.__wbRefreshMultimodalTab();
    }
    const regTab = document.getElementById('wbTabRegression');
    if (regTab) regTab.style.display = tabName === 'regression' ? 'block' : 'none';
    if (tabName === 'regression' && typeof window.__wbLoadEvaluationSummary === 'function') {
      window.__wbLoadEvaluationSummary();
    }
    if (tabName === 'explain' && dagState.currentGraph) {
      const exId = dagState.currentSession ? dagState.currentSession.executionId : undefined;
      loadExplanation(dagState.currentGraph.graphId, dagState.currentGraph.planRevision, exId);
    }
  };

  window.__wbLaunchSelectedMode = async function() {
    const goalInput = document.getElementById('wbDagGoal');
    const goal = goalInput ? goalInput.value.trim() : '';
    if (!goal) {
      toast('Please enter an objective or prompt', true);
      return;
    }

    const launchBtn = document.getElementById('wbDagLaunchBtn');
    if (launchBtn) launchBtn.disabled = true;

    try {
      if (dagState.mode === 'PLAN_ONLY') {
        toast('Compiling DAG plan without execution…');
        const res = await api('/api/execution/plan-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal, userTier: 'TIER_PRO' }),
        });
        dagState.currentGraph = res.graph;
        dagState.currentSession = null;
        dagState.nodeResults = {};
        renderDag(res.graph, null, {});
        renderValidationDiagnostics(res.validation, res.diagnostics);
        updateMetaBar(res.graph, null);
        toast('Plan compiled successfully! ' + Object.keys(res.graph.nodes || {}).length + ' nodes generated.');
        loadExplanation(res.graph.graphId, res.graph.planRevision);
      } else if (dagState.mode === 'DRY_RUN') {
        toast('Simulating tool boundaries & permissions in Dry Run mode…');
        const res = await api('/api/execution/dry-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal }),
        });
        dagState.currentGraph = res.graph;
        dagState.currentSession = {
          executionId: 'dry_run_sim',
          status: 'dry_run_completed',
          completedNodes: Object.keys(res.graph.nodes || {}),
        };
        dagState.nodeResults = {};
        renderDag(res.graph, dagState.currentSession, {});
        updateMetaBar(res.graph, dagState.currentSession);
        toast('Dry run simulation completed with zero mutations.');
        loadExplanation(res.graph.graphId, res.graph.planRevision);
      } else {
        toast('Launching live autonomous execution…');
        const res = await api('/api/execution/live-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal }),
        });
        dagState.currentGraph = res.graph;
        dagState.currentSession = res.session;
        dagState.nodeResults = {};
        renderDag(res.graph, res.session, {});
        updateMetaBar(res.graph, res.session);
        toast('Live execution initiated! ID: ' + res.session.executionId.slice(0, 16));
        loadExplanation(res.graph.graphId, res.graph.planRevision, res.session.executionId);
        loadTimeline(res.session.executionId);
        startPollingActiveSession(res.session.executionId);
      }
      if (window.loadExecutions) window.loadExecutions();
    } catch (err) {
      toast('Execution mode error: ' + err.message, true);
    } finally {
      if (launchBtn) launchBtn.disabled = false;
    }
  };

  window.__wbStepNextNode = async function() {
    const graphId = dagState.currentGraph ? dagState.currentGraph.graphId : null;
    const planRevision = dagState.currentGraph ? dagState.currentGraph.planRevision : 1;
    const goalInput = document.getElementById('wbDagGoal');
    const goal = goalInput ? goalInput.value.trim() : '';

    if (!graphId && !goal) {
      toast('Enter a goal or compile a graph first before stepping', true);
      return;
    }

    try {
      toast('Advancing execution by 1 topological node…');
      const res = await api('/api/execution/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId,
          planRevision,
          executionId: dagState.currentSession ? dagState.currentSession.executionId : undefined,
          goal: !graphId ? goal : undefined,
        }),
      });

      if (res.graph) dagState.currentGraph = res.graph;
      dagState.currentSession = res.session;
      if (res.executedNodeId && res.nodeResult) {
        dagState.nodeResults[res.executedNodeId] = res.nodeResult;
      }

      renderDag(dagState.currentGraph, dagState.currentSession, dagState.nodeResults);
      updateMetaBar(dagState.currentGraph, dagState.currentSession);
      if (res.executedNodeId) {
        selectNode(res.executedNodeId);
        toast('Executed node: ' + res.executedNodeId + (res.hasMoreSteps ? ' (next ready: ' + res.readyNext.join(', ') + ')' : ' (All steps completed!)'));
      } else {
        toast(res.hasMoreSteps ? 'Execution paused/waiting' : 'All steps completed!');
      }

      if (dagState.currentSession && dagState.currentSession.executionId) {
        loadTimeline(dagState.currentSession.executionId);
        loadExplanation(dagState.currentGraph.graphId, dagState.currentGraph.planRevision, dagState.currentSession.executionId);
      }
      if (window.loadExecutions) window.loadExecutions();
    } catch (err) {
      toast('Step execution failed: ' + err.message, true);
    }
  };

  window.__wbRerunSelectedNode = async function() {
    if (!dagState.selectedNodeId) {
      toast('Select a node in the DAG canvas to re-run', true);
      return;
    }
    if (!dagState.currentGraph) {
      toast('No active graph loaded', true);
      return;
    }

    try {
      toast('Re-running node "' + dagState.selectedNodeId + '"…');
      const res = await api('/api/execution/node-rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: dagState.currentGraph.graphId,
          planRevision: dagState.currentGraph.planRevision,
          nodeId: dagState.selectedNodeId,
        }),
      });

      dagState.currentSession = res.session;
      if (res.result) dagState.nodeResults[res.nodeId] = res.result;

      renderDag(dagState.currentGraph, dagState.currentSession, dagState.nodeResults);
      selectNode(res.nodeId);
      toast('Node ' + res.nodeId + ' re-run ' + (res.success ? 'succeeded!' : 'failed.'));

      if (dagState.currentSession && dagState.currentSession.executionId) {
        loadTimeline(dagState.currentSession.executionId);
      }
    } catch (err) {
      toast('Re-run failed: ' + err.message, true);
    }
  };

  window.__wbPauseCurrentExecution = async function() {
    if (!dagState.currentGraph) return;
    try {
      await api('/api/execution/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: dagState.currentGraph.graphId,
          planRevision: dagState.currentGraph.planRevision,
        }),
      });
      toast('Execution paused');
      window.__wbRefreshActiveGraph();
    } catch (e) {
      toast('Pause failed: ' + e.message, true);
    }
  };

  window.__wbResumeCurrentExecution = async function() {
    if (!dagState.currentGraph) return;
    try {
      await api('/api/execution/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: dagState.currentGraph.graphId,
          planRevision: dagState.currentGraph.planRevision,
        }),
      });
      toast('Execution resumed');
      window.__wbRefreshActiveGraph();
    } catch (e) {
      toast('Resume failed: ' + e.message, true);
    }
  };

  window.__wbCancelCurrentExecution = async function() {
    if (!dagState.currentGraph) return;
    if (!confirm('Cancel this active execution session?')) return;
    try {
      await api('/api/execution/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: dagState.currentGraph.graphId,
          planRevision: dagState.currentGraph.planRevision,
        }),
      });
      toast('Execution cancelled');
      window.__wbRefreshActiveGraph();
    } catch (e) {
      toast('Cancel failed: ' + e.message, true);
    }
  };

  window.__wbRefreshActiveGraph = async function() {
    if (!dagState.currentGraph) return;
    try {
      const res = await api('/api/execution/graph/' + encodeURIComponent(dagState.currentGraph.graphId) + '/' + dagState.currentGraph.planRevision);
      dagState.currentGraph = res.graph;
      dagState.currentSession = res.session;
      dagState.nodeResults = res.nodeResults || {};
      renderDag(dagState.currentGraph, dagState.currentSession, dagState.nodeResults);
      updateMetaBar(dagState.currentGraph, dagState.currentSession);
      if (dagState.currentSession && dagState.currentSession.executionId) {
        loadTimeline(dagState.currentSession.executionId);
      }
    } catch (err) {
      console.warn('Sync failed:', err);
    }
  };

  window.__wbInspectSession = async function(graphId, planRevision, executionId) {
    try {
      toast('Loading session into Control Center…');
      const res = await api('/api/execution/graph/' + encodeURIComponent(graphId) + '/' + (planRevision || 1));
      dagState.currentGraph = res.graph;
      dagState.currentSession = res.session;
      dagState.nodeResults = res.nodeResults || {};
      renderDag(dagState.currentGraph, dagState.currentSession, dagState.nodeResults);
      updateMetaBar(dagState.currentGraph, dagState.currentSession);
      if (executionId || (res.session && res.session.executionId)) {
        const id = executionId || res.session.executionId;
        loadTimeline(id);
        loadExplanation(graphId, planRevision, id);
      }
      const root = document.getElementById('wbDagRoot');
      if (root) root.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      toast('Failed to load session: ' + err.message, true);
    }
  };

  // --- Topological Tier Layout & SVG Rendering ---
  function computeTopologicalTiers(graph) {
    const nodes = graph.nodes || {};
    const inDegree = {};
    const adj = {};
    const tierMap = {};

    for (const id in nodes) {
      inDegree[id] = 0;
      adj[id] = [];
    }

    const edges = graph.edges || [];
    for (const e of edges) {
      if (nodes[e.fromNodeId] && nodes[e.toNodeId]) {
        adj[e.fromNodeId].push(e.toNodeId);
        inDegree[e.toNodeId] = (inDegree[e.toNodeId] || 0) + 1;
      }
    }

    const queue = [];
    for (const id in nodes) {
      if (inDegree[id] === 0) {
        queue.push({ id, tier: 1 });
        tierMap[id] = 1;
      }
    }

    let maxTier = 1;
    while (queue.length > 0) {
      const curr = queue.shift();
      for (const neighbor of adj[curr.id]) {
        inDegree[neighbor]--;
        const nextTier = Math.max(tierMap[neighbor] || 0, curr.tier + 1);
        tierMap[neighbor] = nextTier;
        if (nextTier > maxTier) maxTier = nextTier;
        if (inDegree[neighbor] === 0) {
          queue.push({ id: neighbor, tier: nextTier });
        }
      }
    }

    // Bucket into tier arrays
    const tiers = [];
    for (let t = 1; t <= maxTier; t++) tiers.push([]);
    for (const id in nodes) {
      const t = tierMap[id] || 1;
      if (!tiers[t - 1]) tiers[t - 1] = [];
      tiers[t - 1].push(nodes[id]);
    }
    return tiers.filter(t => t.length > 0);
  }

  function getNodeStatus(nodeId, session, results) {
    if (!session) return 'pending';
    if ((session.completedNodes || []).includes(nodeId) || results[nodeId]) return 'completed';
    if ((session.failedNodes || []).includes(nodeId)) return 'failed';
    if ((session.waitingApprovalNodes || []).includes(nodeId)) return 'waiting_approval';
    if ((session.currentNodes || []).includes(nodeId)) return 'running';
    if ((session.skippedNodes || []).includes(nodeId)) return 'skipped';
    return 'pending';
  }

  function getNodeIcon(node) {
    if (node.type === 'tool' || node.action) return '🛠️';
    if (node.type === 'checkpoint') return '✋';
    if (node.type === 'llm' || node.type === 'reasoning') return '🧠';
    if (node.type === 'memory') return '💾';
    return '⚡';
  }

  function renderDag(graph, session, results) {
    const stage = document.getElementById('wbDagTiers');
    const svg = document.getElementById('wbDagSvg');
    if (!stage || !graph) return;

    const countEl = document.getElementById('wbCanvasNodeCount');
    if (countEl) countEl.textContent = Object.keys(graph.nodes || {}).length + ' Nodes';

    const tiers = computeTopologicalTiers(graph);
    if (tiers.length === 0) {
      stage.innerHTML = '<div style="color:var(--muted);padding:30px">Graph contains no nodes.</div>';
      if (svg) svg.innerHTML = '';
      return;
    }

    let html = '';
    tiers.forEach((tierNodes, tIdx) => {
      html += '<div class="wb-dag-tier-col"><div class="wb-dag-tier-label">Tier ' + (tIdx + 1) + '</div>';
      tierNodes.forEach(node => {
        const status = getNodeStatus(node.id, session, results);
        const icon = getNodeIcon(node);
        const actionLabel = node.action ? node.action.toolName : (node.reasoning ? 'llm_reasoning' : node.type);
        const isSelected = dagState.selectedNodeId === node.id;
        const statusPill = status === 'completed' ? '<span class="pill good" style="font-size:9.5px;padding:1px 6px">done</span>' :
                           status === 'running' ? '<span class="pill" style="font-size:9.5px;padding:1px 6px;color:#8ac0f5">running</span>' :
                           status === 'waiting_approval' ? '<span class="pill warn" style="font-size:9.5px;padding:1px 6px">approval</span>' :
                           status === 'failed' ? '<span class="pill bad" style="font-size:9.5px;padding:1px 6px">failed</span>' :
                           '<span class="pill" style="font-size:9.5px;padding:1px 6px">pending</span>';

        html += '<div class="wb-node-card status-' + status + (isSelected ? ' selected' : '') + '" id="wb_node_' + esc(node.id) + '" onclick="window.__wbSelectNode(\'' + esc(node.id) + '\')">';
        html += '  <div class="wb-node-top">';
        html += '    <span class="wb-node-type-icon">' + icon + '</span>';
        html += '    ' + statusPill;
        html += '  </div>';
        html += '  <div class="wb-node-title" title="' + esc(node.title || node.id) + '">' + esc(node.title || node.id) + '</div>';
        html += '  <div class="wb-node-sub">' + esc(actionLabel) + '</div>';
        html += '  <div class="wb-node-bottom">';
        html += '    <span class="mono" style="color:var(--muted)">' + esc(node.id) + '</span>';
        if (node.requiresApproval) html += '<span title="Human In The Loop Gate">🔒</span>';
        html += '  </div>';
        html += '</div>';
      });
      html += '</div>';
    });

    stage.innerHTML = html;

    // Draw SVG connector lines after DOM elements render
    setTimeout(() => drawEdges(graph, session), 20);

    // If a node is selected, keep it active; otherwise select the first ready or running node
    if (dagState.selectedNodeId && graph.nodes[dagState.selectedNodeId]) {
      selectNode(dagState.selectedNodeId);
    } else {
      const firstId = Object.keys(graph.nodes || {})[0];
      if (firstId) selectNode(firstId);
    }
  }

  function drawEdges(graph, session) {
    const svg = document.getElementById('wbDagSvg');
    const stage = document.getElementById('wbDagStage');
    if (!svg || !stage || !graph) return;

    const stageRect = stage.getBoundingClientRect();
    svg.setAttribute('width', stage.scrollWidth);
    svg.setAttribute('height', stage.scrollHeight);
    svg.innerHTML = '';

    const edges = graph.edges || [];
    edges.forEach(e => {
      const fromEl = document.getElementById('wb_node_' + e.fromNodeId);
      const toEl = document.getElementById('wb_node_' + e.toNodeId);
      if (!fromEl || !toEl) return;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      const x1 = (fromRect.right - stageRect.left) + stage.scrollLeft;
      const y1 = (fromRect.top + fromRect.height / 2 - stageRect.top) + stage.scrollTop;
      const x2 = (toRect.left - stageRect.left) + stage.scrollLeft;
      const y2 = (toRect.top + toRect.height / 2 - stageRect.top) + stage.scrollTop;

      const dx = Math.max(20, (x2 - x1) / 2);
      const d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;

      const isCompleted = session && (session.completedNodes || []).includes(e.fromNodeId);
      const isActive = session && (session.currentNodes || []).includes(e.toNodeId);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'wb-dag-edge' + (isActive ? ' active' : (isCompleted ? ' completed' : '')));
      svg.appendChild(path);
    });
  }

  function selectNode(nodeId) {
    dagState.selectedNodeId = nodeId;
    document.querySelectorAll('.wb-node-card').forEach(c => {
      c.classList.toggle('selected', c.id === 'wb_node_' + nodeId);
    });

    const graph = dagState.currentGraph;
    if (!graph || !graph.nodes || !graph.nodes[nodeId]) return;
    const node = graph.nodes[nodeId];
    const session = dagState.currentSession;
    const result = dagState.nodeResults[nodeId];

    document.getElementById('wbNodeDetailEmpty').style.display = 'none';
    document.getElementById('wbNodeDetailCard').style.display = 'block';

    document.getElementById('wbInspectNodeTitle').textContent = node.title || node.id;
    document.getElementById('wbInspectNodeId').textContent = node.id;

    const status = getNodeStatus(nodeId, session, dagState.nodeResults);
    const statusBadge = document.getElementById('wbInspectNodeStatus');
    statusBadge.textContent = status;
    statusBadge.className = 'pill ' + (status === 'completed' ? 'good' : status === 'failed' ? 'bad' : status === 'waiting_approval' ? 'warn' : '');

    document.getElementById('wbInspectNodeType').textContent = node.type;
    document.getElementById('wbInspectNodeAction').textContent = node.action ? node.action.toolName : (node.reasoning ? 'llm_reasoning' : 'none');
    document.getElementById('wbInspectNodeState').textContent = status.toUpperCase();
    document.getElementById('wbInspectNodeAttempts').textContent = (result && result.metrics ? (result.metrics.attempts || 1) : 1) + ' / 3';
    document.getElementById('wbInspectNodeDuration').textContent = result && result.metrics && result.metrics.executionTimeMs ? result.metrics.executionTimeMs + ' ms' : (status === 'completed' ? 'Executed' : 'Pending');

    const inputs = {
      parameters: node.action ? node.action.parameters : (node.reasoning ? node.reasoning.instructions : {}),
      inputBindings: node.inputBindings || {},
    };
    document.getElementById('wbInspectNodeInputs').textContent = JSON.stringify(inputs, null, 2);
    document.getElementById('wbInspectNodeOutputs').textContent = result ? JSON.stringify(result, null, 2) : (status === 'completed' ? '{"status":"completed"}' : '{"status":"not_executed"}');

    // Multimodal Artifact Rendering
    const previewWrap = document.getElementById('wbInspectNodeArtifactWrap');
    const previewEl = document.getElementById('wbInspectNodeArtifactPreview');
    if (previewWrap && previewEl) {
      const art = result && result.output && (result.output.artifact || (result.output.artifacts && result.output.artifacts[0]) || (result.output.type === 'image' || result.output.type === 'video' ? result.output : null));
      if (art && (art.storageUri || art.url || art.mimeType)) {
        previewWrap.style.display = 'block';
        const uri = art.storageUri || art.url || '';
        const isVideo = (art.type === 'video' || (art.mimeType && art.mimeType.includes('video')));
        if (isVideo) {
          previewEl.innerHTML = '<video src="' + esc(uri) + '" controls autoplay loop muted style="max-width:100%;max-height:240px;border-radius:6px;border:1px solid var(--line)"></video>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:6px">ID: <span class="mono">' + esc(art.id || 'artifact') + '</span> • ' + esc(art.mimeType || 'video/mp4') + '</div>';
        } else {
          previewEl.innerHTML = '<img src="' + esc(uri) + '" alt="' + esc(art.prompt || 'Generated media') + '" style="max-width:100%;max-height:240px;border-radius:6px;border:1px solid var(--line)"/>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:6px">ID: <span class="mono">' + esc(art.id || 'artifact') + '</span> • ' + esc(art.mimeType || 'image/png') + (art.aspectRatio ? ' (' + art.aspectRatio + ')' : '') + '</div>';
        }
      } else {
        previewWrap.style.display = 'none';
        previewEl.innerHTML = '';
      }
    }
  }
  window.__wbSelectNode = selectNode;

  function updateMetaBar(graph, session) {
    document.getElementById('wbMetaGraphId').textContent = graph ? graph.graphId.slice(0, 16) : '—';
    document.getElementById('wbMetaRevision').textContent = graph ? 'r' + graph.planRevision : '—';
    const status = session ? session.status : (graph ? 'compiled' : 'idle');
    document.getElementById('wbMetaStatus').textContent = status;
    const total = graph ? Object.keys(graph.nodes || {}).length : 0;
    const done = session ? (session.completedNodes || []).length : 0;
    document.getElementById('wbMetaProgress').textContent = done + ' / ' + total;

    const activeBadge = document.getElementById('wbDagActiveStatus');
    if (activeBadge) {
      activeBadge.textContent = status.toUpperCase();
      activeBadge.className = 'pill ' + (status === 'completed' || status === 'dry_run_completed' ? 'good' : (status === 'failed' ? 'bad' : (status === 'executing' ? 'good' : 'warn')));
    }
  }

  function renderValidationDiagnostics(validation, diagnostics) {
    const el = document.getElementById('wbValidationText');
    if (!el) return;
    if (!validation) {
      el.textContent = 'Validation clean.';
      return;
    }
    el.innerHTML = 'Valid: <strong>' + (validation.isValid ? 'YES' : 'NO') + '</strong> • Errors: ' + (validation.errors || []).length + ' • Warnings: ' + (validation.warnings || []).length;
  }

  // --- Explain Why Report Loading ---
  async function loadExplanation(graphId, planRevision, executionId) {
    try {
      const res = await api('/api/execution/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphId, planRevision, executionId }),
      });
      dagState.explainReport = res.report;
      renderExplainReport(res.report);
    } catch (err) {
      console.warn('Explain failed:', err);
    }
  }

  function renderExplainReport(report) {
    const el = document.getElementById('wbExplainReport');
    if (!el || !report) return;

    const goal = report.goal || 'Autonomous Goal Execution';
    const strategy = report.overallStrategy || report.strategy || 'Topological multi-tiered execution';
    const nodeCount = report.safetyPolicySummary?.enforcedBudgets?.actualNodes || (report.summary ? report.summary.totalNodes : (dagState.currentGraph ? Object.keys(dagState.currentGraph.nodes || {}).length : 0));
    const requiresApproval = report.safetyPolicySummary?.approvalsRequiredCount > 0 || (report.summary?.requiresApproval);

    let html = '';
    html += '<div class="wb-explain-item">';
    html += '  <div class="wb-explain-head">📋 Strategy & Goal</div>';
    html += '  <div class="wb-explain-desc">' + esc(goal) + '</div>';
    html += '  <div class="wb-explain-metric">Strategy: ' + esc(strategy) + '</div>';
    html += '  <div class="wb-explain-metric">Nodes: ' + esc(nodeCount) + '</div>';
    html += '  <div class="wb-explain-metric">Requires Approval: ' + (requiresApproval ? 'Yes' : 'No') + '</div>';
    html += '</div>';

    // Model decisions summary
    if (report.modelDecisions) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:var(--text)">🧠 Model Choices & Role Allocation</div>';
      if (typeof report.modelDecisions.summary === 'string') {
        html += '<div class="wb-explain-item">';
        html += '  <div class="wb-explain-head"><span>Router Strategy</span><span class="mono" style="font-size:10px">' + esc(report.modelDecisions.primaryModel || 'Adaptive') + '</span></div>';
        html += '  <div class="wb-explain-desc">' + esc(report.modelDecisions.summary) + '</div>';
        if (report.modelDecisions.reasoningModel) html += '  <div class="wb-explain-metric">Reasoning: ' + esc(report.modelDecisions.reasoningModel) + '</div>';
        if (report.modelDecisions.fastModel) html += '  <div class="wb-explain-metric">Fast: ' + esc(report.modelDecisions.fastModel) + '</div>';
        html += '</div>';
      } else if (Array.isArray(report.modelDecisions)) {
        report.modelDecisions.forEach(m => {
          html += '<div class="wb-explain-item">';
          html += '  <div class="wb-explain-head"><span>' + esc(m.nodeTitle || m.nodeId) + '</span><span class="mono" style="font-size:10px">' + esc(m.assignedModel) + '</span></div>';
          html += '  <div class="wb-explain-desc">' + esc(m.reason) + '</div>';
          html += '  <div class="wb-explain-metric">Role: ' + esc(m.role) + '</div>';
          html += '  <div class="wb-explain-metric">Tier: ' + esc(m.tierGating) + '</div>';
          html += '</div>';
        });
      }
    }

    // Node-level model choices & explanations if present
    if (report.nodeExplanations && Object.keys(report.nodeExplanations).length > 0) {
      Object.values(report.nodeExplanations).forEach(n => {
        if (n.modelChoice) {
          html += '<div class="wb-explain-item">';
          html += '  <div class="wb-explain-head"><span>Node: ' + esc(n.nodeName || n.nodeId) + '</span><span class="mono" style="font-size:10px">' + esc(n.modelChoice.model) + '</span></div>';
          html += '  <div class="wb-explain-desc">' + esc(n.modelChoice.rationale) + '</div>';
          html += '  <div class="wb-explain-metric">Role: ' + esc(n.modelChoice.role) + ' • Tier: ' + esc(n.modelChoice.tier) + '</div>';
          html += '</div>';
        }
      });
    }

    // Retries
    if (report.retrySummary && report.retrySummary.explanations && report.retrySummary.explanations.length) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:#ffd38c">🔁 Retries & Backoff Enforcements</div>';
      report.retrySummary.explanations.forEach(exp => {
        html += '<div class="wb-explain-item" style="border-color:rgba(245,183,79,0.5)">';
        html += '  <div class="wb-explain-desc">' + esc(exp) + '</div>';
        html += '</div>';
      });
    } else if (Array.isArray(report.retryAnalysis) && report.retryAnalysis.length) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:#ffd38c">🔁 Retries & Backoff Enforcements</div>';
      report.retryAnalysis.forEach(r => {
        html += '<div class="wb-explain-item" style="border-color:rgba(245,183,79,0.5)">';
        html += '  <div class="wb-explain-head"><span>Node ' + esc(r.nodeId) + '</span><span>' + esc(r.attempts) + ' attempts</span></div>';
        html += '  <div class="wb-explain-desc">' + esc(r.explanation) + '</div>';
        html += '  <div class="wb-explain-metric">Policy: ' + esc(r.backoffPolicy) + '</div>';
        html += '</div>';
      });
    }

    // Fallbacks
    if (report.fallbackSummary && report.fallbackSummary.explanations && report.fallbackSummary.explanations.length) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:#8ac0f5">🛡️ Recovery Fallback Failovers</div>';
      report.fallbackSummary.explanations.forEach(f => {
        html += '<div class="wb-explain-item">';
        html += '  <div class="wb-explain-desc">' + esc(f) + '</div>';
        html += '</div>';
      });
    } else if (Array.isArray(report.fallbackAnalysis) && report.fallbackAnalysis.length) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:#8ac0f5">🛡️ Recovery Fallback Failovers</div>';
      report.fallbackAnalysis.forEach(f => {
        html += '<div class="wb-explain-item">';
        html += '  <div class="wb-explain-head"><span>' + esc(f.primaryTarget) + ' ➔ ' + esc(f.fallbackTarget) + '</span></div>';
        html += '  <div class="wb-explain-desc">' + esc(f.reason) + '</div>';
        html += '</div>';
      });
    }

    // Replanning Triggers
    const replanList = report.replanningSummary?.replanTriggers || report.replanningTriggers;
    if (Array.isArray(replanList) && replanList.length) {
      html += '<div style="font-weight:700;font-size:12px;margin:12px 0 6px;color:#ff9aa4">🔀 Dynamic Replanning History</div>';
      replanList.forEach(rp => {
        html += '<div class="wb-explain-item" style="border-color:rgba(255,102,117,0.4)">';
        html += '  <div class="wb-explain-head"><span>r' + esc(rp.fromRevision) + ' ➔ r' + esc(rp.toRevision) + '</span></div>';
        html += '  <div class="wb-explain-desc">' + esc(rp.triggerReason) + '</div>';
        html += '</div>';
      });
    }

    // Safety Policies
    if (report.safetyPolicySummary) {
      const s = report.safetyPolicySummary;
      const destructiveCount = Array.isArray(s.destructiveNodes) ? s.destructiveNodes.length : (s.destructiveActionsGated || 0);
      html += '<div class="wb-explain-item">';
      html += '  <div class="wb-explain-head">🔒 Enforced Policies</div>';
      html += '  <div class="wb-explain-desc">Destructive actions gated: ' + destructiveCount + ' • Approvals required: ' + (s.approvalsRequiredCount || 0) + ' • Whitelist domains: ' + (s.domainWhitelistsEnforced || s.domainWhitelistChecked || []).join(', ') + '</div>';
      html += '</div>';
    }

    el.innerHTML = html;
  }

  // --- Timeline Event Stream Replay ---
  async function loadTimeline(executionId) {
    try {
      const res = await api('/api/execution/' + encodeURIComponent(executionId) + '/timeline');
      dagState.timeline = res.timeline || [];
      const scrubber = document.getElementById('wbReplayScrubber');
      if (scrubber) {
        scrubber.max = Math.max(0, dagState.timeline.length - 1);
        scrubber.value = Math.max(0, dagState.timeline.length - 1);
        dagState.replayIndex = Math.max(0, dagState.timeline.length - 1);
      }
      renderTimelineLog(dagState.timeline);
      updateReplayStatus();
    } catch (err) {
      console.warn('Timeline fetch failed:', err);
    }
  }

  function renderTimelineLog(events) {
    const el = document.getElementById('wbTimelineList');
    if (!el) return;
    if (!events || events.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:30px">No timeline events recorded.</div>';
      return;
    }
    el.innerHTML = events.map((ev, i) => {
      const isSelected = i === dagState.replayIndex;
      return '<div class="wb-explain-item" style="' + (isSelected ? 'border-color:#2a78ca;background:#0d233c;' : '') + 'cursor:pointer" onclick="window.__wbOnScrubTimeline(' + i + ')">' +
             '  <div class="wb-explain-head"><span>#' + (i + 1) + ' ' + esc(ev.eventType) + '</span><span style="font-size:10px;color:var(--muted)">' + esc(new Date(ev.timestamp).toLocaleTimeString()) + '</span></div>' +
             '  <div class="wb-explain-desc mono" style="font-size:11px">' + esc(ev.nodeId ? 'node: ' + ev.nodeId : 'session-level') + ' • ' + esc(JSON.stringify(ev.payload || {}).slice(0, 90)) + '</div>' +
             '</div>';
    }).join('');
  }

  function updateReplayStatus() {
    const total = dagState.timeline.length;
    const idx = dagState.replayIndex;
    const descEl = document.getElementById('wbReplayEventDesc');
    const indexEl = document.getElementById('wbReplayEventIndex');
    if (indexEl) indexEl.textContent = (total > 0 ? (idx + 1) : 0) + ' / ' + total + ' Events';

    if (total === 0) {
      if (descEl) descEl.textContent = 'No events recorded in this session.';
      return;
    }

    const curr = dagState.timeline[idx];
    if (descEl && curr) {
      descEl.innerHTML = 'Event <strong>' + esc(curr.eventType) + '</strong>' + (curr.nodeId ? ' on node <code>' + esc(curr.nodeId) + '</code>' : '') + ' at ' + esc(new Date(curr.timestamp).toLocaleTimeString());
    }

    // Reconstruct state up to index for replay
    if (dagState.currentGraph) {
      const simulatedSession = {
        executionId: dagState.currentSession ? dagState.currentSession.executionId : 'replay',
        completedNodes: [],
        currentNodes: [],
        failedNodes: [],
        waitingApprovalNodes: [],
      };
      for (let i = 0; i <= idx; i++) {
        const e = dagState.timeline[i];
        if (!e) continue;
        if (e.eventType === 'NODE_EXECUTION_STARTED' && e.nodeId) {
          simulatedSession.currentNodes = [e.nodeId];
        } else if (e.eventType === 'NODE_EXECUTION_COMPLETED' && e.nodeId) {
          simulatedSession.currentNodes = [];
          if (!simulatedSession.completedNodes.includes(e.nodeId)) simulatedSession.completedNodes.push(e.nodeId);
        } else if (e.eventType === 'NODE_EXECUTION_FAILED' && e.nodeId) {
          simulatedSession.currentNodes = [];
          if (!simulatedSession.failedNodes.includes(e.nodeId)) simulatedSession.failedNodes.push(e.nodeId);
        } else if (e.eventType === 'APPROVAL_REQUESTED' && e.nodeId) {
          simulatedSession.currentNodes = [];
          if (!simulatedSession.waitingApprovalNodes.includes(e.nodeId)) simulatedSession.waitingApprovalNodes.push(e.nodeId);
        }
      }
      renderDag(dagState.currentGraph, simulatedSession, dagState.nodeResults);
    }
  }

  window.__wbOnScrubTimeline = function(val) {
    dagState.replayIndex = Number(val);
    const scrubber = document.getElementById('wbReplayScrubber');
    if (scrubber) scrubber.value = val;
    updateReplayStatus();
    renderTimelineLog(dagState.timeline);
  };

  window.__wbReplayStepFirst = function() {
    window.__wbOnScrubTimeline(0);
  };
  window.__wbReplayStepBack = function() {
    window.__wbOnScrubTimeline(Math.max(0, dagState.replayIndex - 1));
  };
  window.__wbReplayStepForward = function() {
    window.__wbOnScrubTimeline(Math.min(dagState.timeline.length - 1, dagState.replayIndex + 1));
  };
  window.__wbReplayStepLast = function() {
    window.__wbOnScrubTimeline(Math.max(0, dagState.timeline.length - 1));
  };

  window.__wbToggleReplayPlayback = function() {
    dagState.replayPlaying = !dagState.replayPlaying;
    const btn = document.getElementById('wbReplayPlayBtn');
    if (btn) btn.textContent = dagState.replayPlaying ? '⏸ Pause' : '▶ Play Replay';

    if (dagState.replayPlaying) {
      if (dagState.replayIndex >= dagState.timeline.length - 1) dagState.replayIndex = 0;
      dagState.replayTimer = setInterval(() => {
        if (dagState.replayIndex < dagState.timeline.length - 1) {
          window.__wbOnScrubTimeline(dagState.replayIndex + 1);
        } else {
          window.__wbToggleReplayPlayback();
        }
      }, 900);
    } else {
      clearInterval(dagState.replayTimer);
    }
  };

  let pollingTimer = null;
  function startPollingActiveSession(executionId) {
    clearInterval(pollingTimer);
    pollingTimer = setInterval(async () => {
      try {
        const res = await api('/api/execution/' + encodeURIComponent(executionId) + '/status');
        if (res && res.status) {
          dagState.currentSession = res.status;
          dagState.nodeResults = res.status.nodeResults || {};
          renderDag(dagState.currentGraph, dagState.currentSession, dagState.nodeResults);
          updateMetaBar(dagState.currentGraph, dagState.currentSession);
          if (['completed', 'failed', 'cancelled'].includes(res.status.status)) {
            clearInterval(pollingTimer);
            loadTimeline(executionId);
            loadExplanation(dagState.currentGraph.graphId, dagState.currentGraph.planRevision, executionId);
            toast('Execution ' + res.status.status + '!');
          }
        }
      } catch (err) {
        clearInterval(pollingTimer);
      }
    }, 2000);
  }

  window.__wbLoadEvaluationSummary = async function() {
    try {
      const [sumRes, fixRes] = await Promise.all([
        api('/api/execution/evaluation/summary').catch(() => null),
        api('/api/execution/evaluation/fixtures').catch(() => null),
      ]);

      const summary = sumRes && sumRes.summary ? sumRes.summary : null;
      const fixtures = fixRes && fixRes.fixtures ? fixRes.fixtures : [];

      if (summary) {
        const rate = typeof summary.passRatePercent === 'number' ? summary.passRatePercent : typeof summary.passRate === 'number' ? summary.passRate : 100;
        const badge = document.getElementById('wbEvalSuiteBadge');
        if (badge) {
          badge.textContent = Math.round(rate) + '% Passing';
          badge.className = rate === 100 ? 'pill good' : rate >= 75 ? 'pill warn' : 'pill bad';
        }
        const scoreTool = document.getElementById('wbScoreToolAcc');
        if (scoreTool) scoreTool.textContent = Math.round(summary.toolInvocationAccuracyPercent ?? summary.categoryPassRates?.tool_accuracy ?? 100) + '%';
        const scoreBudget = document.getElementById('wbScoreBudget');
        if (scoreBudget) scoreBudget.textContent = Math.round(summary.budgetCompliancePercent ?? summary.categoryPassRates?.budget_compliance ?? 100) + '%';
        const scoreVerif = document.getElementById('wbScoreVerif');
        if (scoreVerif) scoreVerif.textContent = Math.round(summary.verificationRulesPercent ?? summary.categoryPassRates?.verification_rules ?? 100) + '%';
        const scoreRec = document.getElementById('wbScoreRecovery');
        if (scoreRec) scoreRec.textContent = Math.round(summary.resilienceRecoveryPercent ?? summary.categoryPassRates?.resilience_recovery ?? 100) + '%';
      } else {
        const badge = document.getElementById('wbEvalSuiteBadge');
        if (badge) {
          badge.textContent = 'Ready (Idle)';
          badge.className = 'pill good';
        }
      }

      const list = document.getElementById('wbEvalAssertionsList');
      if (list && fixtures.length > 0) {
        list.innerHTML = fixtures.map(f => {
          const catPill = f.category === 'tool_accuracy' ? '<span class="pill good">tool_accuracy</span>' :
                          f.category === 'budget_compliance' ? '<span class="pill warn">budget_compliance</span>' :
                          f.category === 'verification_rules' ? '<span class="pill">verification_rules</span>' :
                          '<span class="pill">resilience_recovery</span>';
          return '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
              '<strong style="font-size:12px;color:var(--text)">' + esc(f.name) + '</strong>' +
              catPill +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + esc(f.description) + '</div>' +
            '<div style="font-size:11px;color:var(--muted)">' +
              'Target: <span class="mono">' + esc(f.targetNodeAction) + '</span> • ' + f.assertionCount + ' Assertions • Budget: ' + f.budgetMs + 'ms' +
            '</div>' +
          '</div>';
        }).join('');
      }
    } catch (err) {
      console.warn('Failed to load evaluation fixtures', err);
    }
  };

  window.__wbRunEvalSuite = async function() {
    const btn = document.getElementById('wbRunEvalSuiteBtn');
    if (btn) btn.disabled = true;
    toast('Running Phase 5 evaluation regression suite…');
    try {
      const res = await api('/api/execution/evaluation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBudgetMs: 45000 }),
      });
      if (res && res.summary) {
        const s = res.summary;
        toast('Evaluation finished: ' + s.passedAssertions + '/' + s.totalAssertions + ' assertions passed (' + Math.round(s.passRate) + '%)');
        window.__wbLoadEvaluationSummary();
        const list = document.getElementById('wbEvalAssertionsList');
        if (list && s.reports) {
          list.innerHTML = s.reports.map(r => '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
              '<strong style="font-size:12px;color:var(--text)">' + esc(r.fixtureName) + '</strong>' +
              '<span class="pill ' + (r.status === 'PASSED' ? 'good' : 'bad') + '">' + esc(r.status) + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Latency: ' + r.durationMs + 'ms • Budget: ' + (r.budgetCompliant ? 'Compliant' : 'Exceeded') + '</div>' +
            '<div style="display:flex;flex-direction:column;gap:3px">' +
              r.assertionResults.map(a => '<div style="font-size:11px;display:flex;justify-content:space-between;background:var(--panel-3);border:1px solid var(--line);padding:4px 6px;border-radius:4px">' +
                '<span>' + esc(a.description) + '</span>' +
                '<span style="color:' + (a.passed ? 'var(--green)' : 'var(--red)') + ';font-weight:700">' + (a.passed ? '✓ PASS' : '✗ FAIL') + '</span>' +
              '</div>').join('') +
            '</div>' +
          '</div>').join('');
        }
      }
    } catch (err) {
      toast('Evaluation run failed: ' + err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.__wbRunSelectedFixture = async function() {
    const sel = document.getElementById('wbEvalFixtureSelect');
    const fixtureId = sel ? sel.value : null;
    if (!fixtureId) {
      toast('Please select a fixture to evaluate', true);
      return;
    }
    toast('Running fixture: ' + fixtureId + '…');
    try {
      const res = await api('/api/execution/evaluation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixtureId }),
      });
      if (res && res.report) {
        const r = res.report;
        toast('Fixture ' + r.status + ': ' + r.assertionResults.filter(a => a.passed).length + '/' + r.assertionResults.length + ' passed');
        window.__wbLoadEvaluationSummary();
      }
    } catch (err) {
      toast('Fixture run failed: ' + err.message, true);
    }
  };

  window.__wbRefreshMultimodalTab = async function() {
    const jobsList = document.getElementById('wbAsyncJobsList');
    const artList = document.getElementById('wbDagArtifactsList');
    try {
      const exId = dagState.currentSession ? dagState.currentSession.executionId : (dagState.currentGraph ? dagState.currentGraph.graphId : undefined);
      const url = exId ? '/api/execution/artifacts?executionId=' + encodeURIComponent(exId) : '/api/execution/artifacts';
      const res = await api(url);
      if (res) {
        if (jobsList) {
          const jobs = res.activeJobs || [];
          if (jobs.length === 0) {
            jobsList.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;text-align:center">No active async jobs in progress.</div>';
          } else {
            jobsList.innerHTML = jobs.map(j => '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:11px">' +
              '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><strong>Job ' + esc(j.jobId) + '</strong> <span class="pill ' + (j.status === 'completed' ? 'good' : (j.status === 'failed' ? 'bad' : '')) + '">' + esc(j.status) + ' (' + (j.progress || 0) + '%)</span></div>' +
              '<div style="color:var(--muted)">Provider: ' + esc(j.provider) + ' • Node: ' + esc(j.nodeId) + '</div>' +
            '</div>').join('');
          }
        }
        if (artList) {
          const arts = res.artifacts || [];
          if (arts.length === 0) {
            artList.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px;text-align:center">No media artifacts registered for current DAG run.</div>';
          } else {
            arts.forEach(a => {});
            artList.innerHTML = arts.map(a => {
              const isVid = a.type === 'video' || (a.mimeType && a.mimeType.includes('video'));
              const uri = a.storageUri || a.url || '';
              return '<div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
                  '<div><strong style="color:var(--text)">' + esc(a.name || a.id) + '</strong> <span class="pill" style="font-size:9.5px">' + esc(a.type) + '</span></div>' +
                  '<span class="mono" style="font-size:10px;color:var(--muted)">' + esc(a.mimeType || '') + '</span>' +
                '</div>' +
                (uri ? (isVid ? '<video src="' + esc(uri) + '" controls style="max-width:100%;max-height:180px;border-radius:4px;border:1px solid var(--line)"></video>' : '<img src="' + esc(uri) + '" style="max-width:100%;max-height:180px;border-radius:4px;border:1px solid var(--line)"/>') : '<div style="color:var(--muted);font-size:10.5px">URI: ' + esc(a.storageUri || 'Pending generation') + '</div>') +
                '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">Created by node: <span class="mono">' + esc(a.originatingNodeId || 'planner') + '</span></div>' +
              '</div>';
            }).join('');
          }
        }
      }
    } catch (err) {
      console.warn('Failed to refresh multimodal tab', err);
    }
  };

  // Hook into executions table to add "Inspect DAG" action button
  document.addEventListener('DOMContentLoaded', () => {
    const executionsView = document.getElementById('view-executions');
    if (executionsView) {
      const existingSuite = document.getElementById('wbDagRoot');
      if (existingSuite && existingSuite.parentNode !== executionsView) {
        executionsView.insertBefore(existingSuite, executionsView.children[1] || null);
      }
    }

    // Enhance renderExecRow to include an "Inspect DAG" button
    const origRenderExecRow = window.renderExecRow;
    if (typeof origRenderExecRow === 'function') {
      window.renderExecRow = function(s) {
        let rowHtml = origRenderExecRow(s);
        const btnInspect = '<button class="btn small primary" style="margin-left:4px" onclick="window.__wbInspectSession(\'' + esc(s.graphId) + '\',' + Number(s.planRevision) + ',\'' + esc(s.executionId) + '\')">Inspect DAG</button>';
        return rowHtml.replace('</td></tr>', btnInspect + '</td></tr>');
      };
    }
  });
})();
</script>
`;
}
