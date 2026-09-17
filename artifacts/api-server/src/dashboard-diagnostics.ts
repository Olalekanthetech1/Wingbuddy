export function renderDashboardDiagnostics(): string {
  return String.raw`
<style>
.wb-diag-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(16, 31, 51, 0.98), rgba(9, 21, 36, 0.98));
  margin-bottom: 16px;
}
.wb-diag-overall {
  display: flex;
  align-items: center;
  gap: 12px;
}
.wb-diag-status-pill {
  font-size: 12.5px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.wb-diag-status-pill.healthy {
  background: rgba(55, 211, 154, 0.14);
  color: #37d39a;
  border: 1px solid rgba(55, 211, 154, 0.35);
}
.wb-diag-status-pill.degraded {
  background: rgba(245, 183, 79, 0.14);
  color: #f5b74f;
  border: 1px solid rgba(245, 183, 79, 0.35);
}
.wb-diag-status-pill.critical {
  background: rgba(255, 102, 117, 0.16);
  color: #ff6675;
  border: 1px solid rgba(255, 102, 117, 0.4);
}
.wb-diag-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.wb-diag-alert-box {
  background: rgba(245, 183, 79, 0.08);
  border: 1px solid rgba(245, 183, 79, 0.3);
  border-radius: 12px;
  padding: 14px 18px;
  margin-bottom: 16px;
  display: none;
}
.wb-diag-alert-box.active {
  display: block;
}
.wb-diag-alert-title {
  font-weight: 700;
  color: #ffd38c;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  margin-bottom: 4px;
}
.wb-diag-alert-body {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
}
.wb-diag-alert-action {
  margin-top: 8px;
  display: inline-flex;
}
.wb-diag-matrix-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.wb-diag-card {
  background: linear-gradient(180deg, rgba(16, 31, 51, 0.95), rgba(10, 22, 38, 0.95));
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.wb-diag-card:hover {
  border-color: var(--line-strong);
}
.wb-diag-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.wb-diag-provider-name {
  font-size: 15px;
  font-weight: 700;
}
.wb-diag-provider-meta {
  font-size: 11.5px;
  color: var(--muted);
  margin-top: 3px;
  word-break: break-all;
}
.wb-diag-stat-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  background: var(--panel-3);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(27, 48, 73, 0.5);
  font-size: 12px;
}
.wb-diag-stat-label {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wb-diag-stat-val {
  font-weight: 600;
  margin-top: 2px;
}
.wb-diag-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
.wb-diag-latency-badge {
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--blue);
  background: rgba(90, 167, 255, 0.1);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(90, 167, 255, 0.2);
}
.wb-diag-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
  padding-bottom: 4px;
}
.wb-diag-tab-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted);
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s ease;
}
.wb-diag-tab-btn.active {
  background: var(--panel-2);
  border-color: var(--line-strong);
  color: var(--text);
}
.wb-diag-error-card {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 102, 117, 0.3);
  background: rgba(255, 102, 117, 0.08);
  margin-top: 8px;
  font-size: 12px;
}
.wb-diag-error-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 102, 117, 0.2);
  color: #ff9aa4;
  margin-bottom: 6px;
}
.wb-diag-sim-step {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.wb-diag-sim-step.passed {
  border-left: 4px solid var(--green);
}
.wb-diag-sim-step.warning {
  border-left: 4px solid var(--amber);
}
.wb-diag-sim-step.failed {
  border-left: 4px solid var(--red);
}
.wb-diag-trends-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
@media (max-width: 1100px) {
  .wb-diag-matrix-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wb-diag-trends-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .wb-diag-matrix-grid { grid-template-columns: 1fr; }
  .wb-diag-trends-grid { grid-template-columns: 1fr; }
  .wb-diag-topbar { flex-direction: column; align-items: stretch; }
}
</style>

<script>
(function(){
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.style.display='block';clearTimeout(window.__wbDiagToast);window.__wbDiagToast=setTimeout(()=>el.style.display='none',4500)}
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}

  let currentSubTab = 'matrix';
  let isProbingAll = false;

  function showDiagnosticsView(){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav button,.mobile-nav button').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-diagnostics')?.classList.add('active');
    document.querySelectorAll('[data-diag-nav]').forEach(b=>b.classList.add('active'));
    loadAllDiagnostics();
  }

  function installNav(){
    ['nav','mobileNav'].forEach(id=>{
      const root=document.getElementById(id);
      if(root&&!root.querySelector('[data-diag-nav]')){
        const b=document.createElement('button');
        b.type='button';
        b.dataset.diagNav='';
        b.textContent='🩺 Diagnostics';
        b.addEventListener('click',showDiagnosticsView);
        root.appendChild(b);
      }
    });
  }

  async function loadStatus(){
    try {
      const data = await api('/api/dashboard/diagnostics/status');
      renderTopBar(data);
      renderHealthMatrix(data.providers || {});
      renderActiveAlerts(data.activeAlerts || []);
      renderSummaryCards(data.summary || {});
    } catch (err) {
      toast('Failed to load diagnostics status: ' + err.message);
    }
  }

  function renderTopBar(data){
    const pill = document.getElementById('wbDiagOverallPill');
    const note = document.getElementById('wbDiagOverallNote');
    if (!pill || !note) return;

    const status = data.overallStatus || 'HEALTHY';
    pill.className = 'wb-diag-status-pill ' + status.toLowerCase();
    pill.textContent = (status === 'HEALTHY' ? '🟢 System Operational' : status === 'DEGRADED' ? '🟡 System Degraded' : '🔴 Attention Required');
    note.textContent = 'Uptime: ' + Math.floor((data.uptimeSeconds||0)/3600) + 'h ' + Math.floor(((data.uptimeSeconds||0)%3600)/60) + 'm · ' + (data.summary?.healthyCount||0) + '/' + (data.summary?.totalProviders||0) + ' services normal';
  }

  function renderActiveAlerts(alerts){
    const box = document.getElementById('wbDiagAlertBox');
    const content = document.getElementById('wbDiagAlertContent');
    if (!box || !content) return;

    if (!alerts || alerts.length === 0) {
      box.classList.remove('active');
      content.innerHTML = '';
      return;
    }

    box.classList.add('active');
    content.innerHTML = alerts.map(a => {
      const icon = a.severity === 'high' ? '🚨' : a.severity === 'medium' ? '⚠️' : 'ℹ️';
      return '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(245,183,79,0.2)">' +
        '<div class="wb-diag-alert-title">' + icon + ' ' + esc(a.title) + '</div>' +
        '<div class="wb-diag-alert-body">' + esc(a.message) + '</div>' +
        '<div style="font-size:12px;color:#8de6c0;margin-top:4px">💡 <b>Recommendation:</b> ' + esc(a.recommendation) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderSummaryCards(summary){
    const h = document.getElementById('wbDiagStatHealthy');
    const w = document.getElementById('wbDiagStatWarn');
    const d = document.getElementById('wbDiagStatDown');
    const u = document.getElementById('wbDiagStatUnconfigured');
    if (h) h.textContent = summary.healthyCount ?? '—';
    if (w) w.textContent = summary.warningCount ?? '—';
    if (d) d.textContent = summary.downCount ?? '—';
    if (u) u.textContent = summary.unconfiguredCount ?? '—';
  }

  function renderHealthMatrix(providers){
    const grid = document.getElementById('wbDiagMatrixGrid');
    if (!grid) return;

    const list = Object.values(providers);
    if (!list.length) {
      grid.innerHTML = '<div class="empty">No provider diagnostics records found.</div>';
      return;
    }

    grid.innerHTML = list.map(p => {
      const isHealthy = p.status === 'healthy';
      const isWarn = p.status === 'warning';
      const isDown = p.status === 'down';
      const statusClass = isHealthy ? 'good' : isWarn ? 'warn' : isDown ? 'bad' : '';
      const statusLabel = isHealthy ? 'Operational' : isWarn ? 'Degraded' : isDown ? 'Down' : 'Unconfigured';
      const latencyBadge = p.latencyMs !== undefined ? '<span class="wb-diag-latency-badge">⚡ ' + p.latencyMs + 'ms</span>' : '<span class="wb-diag-latency-badge" style="color:var(--muted)">Idle</span>';

      let errorBlock = '';
      if (p.lastError) {
        const rawErrPre = p.lastError.rawError
          ? '<details style="margin-top:8px;cursor:pointer">' +
              '<summary style="font-size:11px;color:var(--blue);font-weight:600;user-select:none">▶ View Raw Technical Log / Stack</summary>' +
              '<pre style="margin-top:5px;padding:8px 10px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,102,117,0.25);border-radius:6px;font-size:10.5px;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;color:#ff9aa4;max-height:160px;overflow-y:auto">' + esc(p.lastError.rawError) + '</pre>' +
            '</details>'
          : '';
        errorBlock = '<div class="wb-diag-error-card">' +
          '<div class="wb-diag-error-badge">' + esc(p.lastError.badge) + '</div>' +
          '<div><b>' + esc(p.lastError.title) + '</b></div>' +
          '<div style="margin-top:3px;color:var(--muted)">' + esc(p.lastError.description) + '</div>' +
          '<div style="margin-top:4px;color:#8de6c0">💡 ' + esc(p.lastError.recommendation) + '</div>' +
          rawErrPre +
          '</div>';
      }

      return '<div class="wb-diag-card" id="wb-diag-card-' + esc(p.providerId) + '">' +
        '<div>' +
          '<div class="wb-diag-card-head">' +
            '<div>' +
              '<div class="wb-diag-provider-name">' + esc(p.name) + '</div>' +
              '<div class="wb-diag-provider-meta">' + esc(p.activeModel || 'Standard') + '</div>' +
            '</div>' +
            '<span class="pill ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>' +
          '<div class="wb-diag-stat-row" style="margin-top:12px">' +
            '<div>' +
              '<div class="wb-diag-stat-label">Active Keys / Quota</div>' +
              '<div class="wb-diag-stat-val">' + esc(p.quotaStatus || (p.activeKeys + '/' + p.totalKeys + ' active')) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="wb-diag-stat-label">Rate Limit Status</div>' +
              '<div class="wb-diag-stat-val">' + esc(p.rateLimitStatus || 'Normal') + '</div>' +
            '</div>' +
          '</div>' +
          errorBlock +
        '</div>' +
        '<div class="wb-diag-card-footer">' +
          latencyBadge +
          '<button class="btn small" onclick="window.__wbDiagRunProbe(\'' + esc(p.providerId) + '\')">Test Probe</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function runProbe(probeId){
    toast('Running diagnostic probe for ' + probeId + '…');
    try {
      const data = await api('/api/dashboard/diagnostics/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probeId })
      });

      const res = data.result;
      if (res) {
        if (res.status === 'PASSED') {
          toast('✓ Probe Passed (' + res.latencyMs + 'ms): ' + (res.outputSnippet || 'Operational'));
        } else {
          toast('✕ Probe Failed: ' + (res.error?.title || 'Unknown error'));
        }
      }
      await loadStatus();
      if (currentSubTab === 'trends') await loadTrends();
    } catch (err) {
      toast('Probe execution error: ' + err.message);
    }
  }

  async function runAllProbes(){
    if (isProbingAll) return;
    isProbingAll = true;
    const btn = document.getElementById('wbDiagBtnRunAll');
    if (btn) { btn.disabled = true; btn.textContent = 'Probing All Services…'; }
    toast('Executing full suite diagnostic probes across all providers…');

    try {
      await api('/api/dashboard/diagnostics/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probeId: 'all' })
      });
      toast('✓ Full diagnostic probe cycle complete');
      await loadStatus();
      if (currentSubTab === 'trends') await loadTrends();
    } catch (err) {
      toast('Probe cycle failed: ' + err.message);
    } finally {
      isProbingAll = false;
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Run All Probes'; }
    }
  }

  async function simulatePipeline(){
    const promptInput = document.getElementById('wbDiagSimPrompt');
    const modalitySelect = document.getElementById('wbDiagSimModality');
    const resultBox = document.getElementById('wbDiagSimResults');
    const btn = document.getElementById('wbDiagSimRunBtn');

    const prompt = (promptInput?.value || '').trim();
    const modality = modalitySelect?.value || 'video';

    if (!prompt) {
      toast('Please enter a test prompt for simulation');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Simulating Pipeline…'; }
    if (resultBox) {
      resultBox.innerHTML = '<div class="notice">Executing end-to-end dry run: prompt refinement, AI routing, quota evaluation, provider pre-flight, and CDN readiness…</div>';
    }

    try {
      const sim = await api('/api/dashboard/diagnostics/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, modality })
      });

      const statusPill = sim.overallStatus === 'SUCCESS' ? '<span class="pill good">Sim Passed</span>' : sim.overallStatus === 'DEGRADED' ? '<span class="pill warn">Sim Degraded</span>' : '<span class="pill bad">Sim Blocked</span>';

      let html = '<div style="margin-bottom:14px;padding:12px 16px;background:var(--panel-2);border-radius:12px;border:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<div><strong>Simulation Summary:</strong> ' + esc(sim.modality.toUpperCase()) + ' Pipeline (' + sim.totalDurationMs + 'ms total)</div>' +
        '<div>' + statusPill + '</div>' +
        '</div>';

      html += '<div style="margin-bottom:12px;font-size:12.5px;color:var(--muted)">' +
        '<b>Refined Director Prompt:</b> <span class="mono" style="color:var(--text)">' + esc(sim.enhancedPrompt) + '</span>' +
        '</div>';

      html += sim.steps.map(step => {
        const stepClass = step.status === 'passed' ? 'passed' : step.status === 'warning' ? 'warning' : 'failed';
        const badge = step.status === 'passed' ? '<span class="pill good">Pass</span>' : step.status === 'warning' ? '<span class="pill warn">Warn</span>' : '<span class="pill bad">Fail</span>';

        let errHtml = '';
        if (step.error) {
          const rawDetails = step.error.rawError
            ? '<details style="margin-top:8px;cursor:pointer">' +
                '<summary style="font-size:11.5px;color:var(--blue);font-weight:600;user-select:none">▶ View Raw Technical Log / Stack Trace</summary>' +
                '<pre style="margin-top:6px;padding:8px 10px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,102,117,0.25);border-radius:6px;font-size:11px;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;color:#ff9aa4;max-height:180px;overflow-y:auto">' + esc(step.error.rawError) + '</pre>' +
              '</details>'
            : '';
          errHtml = '<div class="wb-diag-error-card">' +
            '<div class="wb-diag-error-badge">' + esc(step.error.badge) + '</div>' +
            '<div><b>' + esc(step.error.title) + '</b></div>' +
            '<div style="color:var(--muted);margin-top:2px">' + esc(step.error.description) + '</div>' +
            '<div style="color:#8de6c0;margin-top:3px">💡 ' + esc(step.error.recommendation) + '</div>' +
            rawDetails +
            '</div>';
        }

        return '<div class="wb-diag-sim-step ' + stepClass + '">' +
          '<div style="flex:1">' +
            '<div style="font-weight:700;font-size:13px">' + esc(step.phase) + ' — ' + esc(step.name) + '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px">' + esc(step.summary) + '</div>' +
            errHtml +
          '</div>' +
          '<div style="text-align:right">' +
            badge +
            '<div class="mono" style="font-size:11px;color:var(--muted);margin-top:4px">' + step.durationMs + 'ms</div>' +
          '</div>' +
        '</div>';
      }).join('');

      if (resultBox) resultBox.innerHTML = html;
      toast('Pipeline simulation finished in ' + sim.totalDurationMs + 'ms');
    } catch (err) {
      if (resultBox) resultBox.innerHTML = '<div class="notice" style="color:var(--red)">Simulation error: ' + esc(err.message) + '</div>';
      toast('Simulation failed: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Simulate Pipeline'; }
    }
  }

  async function loadTrends(){
    try {
      const data = await api('/api/dashboard/diagnostics/trends');
      const rateEl = document.getElementById('wbDiagTrendRate');
      const latEl = document.getElementById('wbDiagTrendLat');
      const totalEl = document.getElementById('wbDiagTrendTotal');
      const failoverEl = document.getElementById('wbDiagTrendFailover');

      if (rateEl) rateEl.textContent = (data.successRatePercent ?? 100) + '%';
      if (latEl) latEl.textContent = (data.averageLatencyMs ?? 0) + 'ms';
      if (totalEl) totalEl.textContent = data.totalJobs ?? 0;
      if (failoverEl) failoverEl.textContent = data.failoversRecorded ?? 0;

      // Error categorization chips
      const errBox = document.getElementById('wbDiagErrorChips');
      if (errBox) {
        const catMap = data.byErrorCategory || {};
        const chips = [
          { label: '🔑 Credential Missing', count: catMap.credential_missing || 0 },
          { label: '💳 Quota Exhausted', count: catMap.billing_quota_exhausted || 0 },
          { label: '⚙️ Capability Not Enabled', count: catMap.capability_not_enabled || 0 },
          { label: '⏳ Cluster Busy', count: catMap.cluster_busy || 0 },
          { label: '🌐 Endpoint Unreachable', count: catMap.endpoint_unreachable || 0 }
        ];

        errBox.innerHTML = chips.map(c => {
          const cls = c.count > 0 ? 'pill warn' : 'pill';
          return '<span class="' + cls + '" style="font-size:12px;padding:6px 11px">' + esc(c.label) + ': <b>' + c.count + '</b></span>';
        }).join('');
      }

      await loadJobsTable();
    } catch (err) {
      toast('Failed to load telemetry trends: ' + err.message);
    }
  }

  async function loadJobsTable(){
    const tbody = document.getElementById('wbDiagJobsTbody');
    const modalityFilter = document.getElementById('wbDiagJobModalityFilter')?.value || '';
    const statusFilter = document.getElementById('wbDiagJobStatusFilter')?.value || '';
    if (!tbody) return;

    try {
      let q = '/api/dashboard/diagnostics/jobs?limit=30';
      if (modalityFilter) q += '&modality=' + encodeURIComponent(modalityFilter);
      if (statusFilter) q += '&status=' + encodeURIComponent(statusFilter);

      const data = await api(q);
      const jobs = data.jobs || [];

      if (!jobs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No recent execution logs matching filter criteria.</td></tr>';
        return;
      }

      tbody.innerHTML = jobs.map(j => {
        const isComp = j.state === 'completed';
        const isFail = j.state === 'failed' || j.state === 'timed_out';
        const statusBadge = isComp ? '<span class="pill good">Completed</span>' : isFail ? '<span class="pill bad">Failed</span>' : '<span class="pill warn">' + esc(j.state) + '</span>';

        let errDisplay = '—';
        if (j.categorizedError) {
          const rawTech = j.categorizedError.rawError || j.errorMessage;
          errDisplay = '<span class="wb-diag-error-badge">' + esc(j.categorizedError.badge) + '</span><br/><span style="font-size:11px;color:var(--muted)">' + esc(j.categorizedError.title) + '</span>' +
            (rawTech ? '<details style="margin-top:4px;cursor:pointer"><summary style="font-size:10.5px;color:var(--blue)">▶ Raw Log</summary><pre style="margin-top:3px;padding:4px 6px;background:rgba(0,0,0,0.5);border-radius:4px;font-size:10px;color:#ff9aa4;max-width:240px;overflow-x:auto;white-space:pre-wrap">' + esc(rawTech) + '</pre></details>' : '');
        } else if (j.errorMessage) {
          errDisplay = '<details style="cursor:pointer"><summary style="color:#ff9aa4;font-size:11px">⚠️ ' + esc(j.errorMessage.slice(0, 40)) + '…</summary><pre style="margin-top:3px;padding:4px 6px;background:rgba(0,0,0,0.5);border-radius:4px;font-size:10px;color:#ff9aa4;max-width:240px;overflow-x:auto;white-space:pre-wrap">' + esc(j.errorMessage) + '</pre></details>';
        }

        const dateStr = new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const latencyStr = j.latencyMs ? j.latencyMs + 'ms' : '—';
        const modelStr = j.actualModel || j.plannedModel || '—';

        return '<tr>' +
          '<td class="mono" style="font-size:11.5px">' + esc(dateStr) + '</td>' +
          '<td><span class="pill">' + esc(j.modality || 'image') + '</span></td>' +
          '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(j.prompt) + '">' + esc(j.prompt) + '</td>' +
          '<td>' + esc(j.actualProvider || j.plannedProvider) + '<br/><span class="mono" style="font-size:11px;color:var(--muted)">' + esc(modelStr) + '</span></td>' +
          '<td class="mono">' + latencyStr + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + errDisplay + '</td>' +
        '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Error loading jobs: ' + esc(err.message) + '</td></tr>';
    }
  }

  async function sendTelegramAlert(){
    toast('Dispatching diagnostics snapshot to Telegram…');
    try {
      const data = await api('/api/dashboard/diagnostics/alert-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      toast('✓ ' + (data.message || 'Dispatched snapshot to Telegram'));
    } catch (err) {
      toast('✕ Failed to send Telegram alert: ' + err.message);
    }
  }

  function switchSubTab(tab){
    currentSubTab = tab;
    document.querySelectorAll('.wb-diag-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.subtab === tab);
    });
    const matrixView = document.getElementById('wbDiagSubViewMatrix');
    const simView = document.getElementById('wbDiagSubViewSim');
    const trendsView = document.getElementById('wbDiagSubViewTrends');

    if (matrixView) matrixView.style.display = tab === 'matrix' ? 'block' : 'none';
    if (simView) simView.style.display = tab === 'sim' ? 'block' : 'none';
    if (trendsView) trendsView.style.display = tab === 'trends' ? 'block' : 'none';

    if (tab === 'trends') loadTrends();
  }

  async function loadAllDiagnostics(){
    await Promise.all([loadStatus(), loadTrends()]);
  }

  function initDiagnostics(){
    installNav();
    if (!document.getElementById('view-diagnostics')) {
      const section = document.createElement('section');
      section.className = 'view';
      section.id = 'view-diagnostics';
      section.innerHTML = 
        '<!-- Top Status & Actions Banner -->' +
        '<div class="wb-diag-topbar">' +
          '<div class="wb-diag-overall">' +
            '<span id="wbDiagOverallPill" class="wb-diag-status-pill healthy">🟢 Checking Status…</span>' +
            '<span id="wbDiagOverallNote" style="color:var(--muted);font-size:12.5px">Loading diagnostics telemetry…</span>' +
          '</div>' +
          '<div class="wb-diag-actions">' +
            '<button id="wbDiagBtnRunAll" class="btn primary" onclick="window.__wbDiagRunAll()">⚡ Run All Probes</button>' +
            '<button class="btn" onclick="window.__wbDiagSendTelegram()">📲 Send to Telegram</button>' +
            '<button class="btn" onclick="window.__wbDiagRefresh()">🔄 Refresh</button>' +
          '</div>' +
        '</div>' +

        '<!-- Proactive Alert Banner (Displays when issues are detected) -->' +
        '<div id="wbDiagAlertBox" class="wb-diag-alert-box">' +
          '<div id="wbDiagAlertContent"></div>' +
        '</div>' +

        '<!-- Sub-navigation Tabs -->' +
        '<div class="wb-diag-tabs">' +
          '<button class="wb-diag-tab-btn active" data-subtab="matrix" onclick="window.__wbDiagSwitchTab(\'matrix\')">📊 Provider Health Matrix</button>' +
          '<button class="wb-diag-tab-btn" data-subtab="sim" onclick="window.__wbDiagSwitchTab(\'sim\')">🔬 Pipeline Simulator (Dry-Run)</button>' +
          '<button class="wb-diag-tab-btn" data-subtab="trends" onclick="window.__wbDiagSwitchTab(\'trends\')">📈 Telemetry & Error Stream</button>' +
        '</div>' +

        '<!-- Sub-View 1: Health Matrix & Summary Cards -->' +
        '<div id="wbDiagSubViewMatrix">' +
          '<div class="grid wb-diag-trends-grid">' +
            '<div class="card mini">' +
              '<span class="label">Operational Services</span>' +
              '<strong id="wbDiagStatHealthy" class="value" style="color:var(--green)">—</strong>' +
              '<div class="sub">Passing live ping probes</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Degraded Services</span>' +
              '<strong id="wbDiagStatWarn" class="value" style="color:var(--amber)">—</strong>' +
              '<div class="sub">Key in cooldown or warning</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Offline Services</span>' +
              '<strong id="wbDiagStatDown" class="value" style="color:var(--red)">—</strong>' +
              '<div class="sub">Probes failing authentication</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Unconfigured</span>' +
              '<strong id="wbDiagStatUnconfigured" class="value">—</strong>' +
              '<div class="sub">Tokens not yet provided</div>' +
            '</div>' +
          '</div>' +

          '<div id="wbDiagMatrixGrid" class="wb-diag-matrix-grid">' +
            '<div class="empty">Inspecting connected AI providers…</div>' +
          '</div>' +
        '</div>' +

        '<!-- Sub-View 2: End-to-End Pipeline Simulator -->' +
        '<div id="wbDiagSubViewSim" style="display:none">' +
          '<div class="card section">' +
            '<div class="section-head">' +
              '<div>' +
                '<div class="section-title">End-to-End Pipeline Simulator (Dry-Run)</div>' +
                '<div class="section-note">Traces prompt expansion, dynamic model selection, user tier quota check, provider credential readiness, and Cloudinary storage ingestion without consuming live generation budget.</div>' +
              '</div>' +
            '</div>' +
            '<div class="stack" style="gap:10px">' +
              '<div class="form-grid">' +
                '<input id="wbDiagSimPrompt" class="input" placeholder="Enter prompt to test (e.g., A cinematic drone shot of a futuristic neon cyber-city)" value="A cinematic drone shot of a futuristic neon cyber-city at dusk"/>' +
                '<select id="wbDiagSimModality" class="select" style="width:140px">' +
                  '<option value="video">Video (🎬)</option>' +
                  '<option value="image">Image (🖼️)</option>' +
                '</select>' +
                '<button id="wbDiagSimRunBtn" class="btn primary" onclick="window.__wbDiagRunSim()">🚀 Simulate Pipeline</button>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<span style="font-size:12px;color:var(--muted);align-self:center">Sample Prompts:</span>' +
                '<button class="btn small" onclick="document.getElementById(\'wbDiagSimPrompt\').value=\'Cinematic hyper-lapse through rainy Tokyo backstreets at midnight\'">Tokyo Night</button>' +
                '<button class="btn small" onclick="document.getElementById(\'wbDiagSimPrompt\').value=\'Majestic golden eagle soaring over snow-capped alpine mountains\'">Golden Eagle</button>' +
                '<button class="btn small" onclick="document.getElementById(\'wbDiagSimPrompt\').value=\'Retro 1980s synthwave sports car speeding on digital highway\'">80s Synthwave</button>' +
              '</div>' +
            '</div>' +
            '<div id="wbDiagSimResults" style="margin-top:16px"></div>' +
          '</div>' +
        '</div>' +

        '<!-- Sub-View 3: Telemetry & Error Stream -->' +
        '<div id="wbDiagSubViewTrends" style="display:none">' +
          '<div class="grid wb-diag-trends-grid">' +
            '<div class="card mini">' +
              '<span class="label">24h Success Rate</span>' +
              '<strong id="wbDiagTrendRate" class="value" style="color:var(--green)">100%</strong>' +
              '<div class="sub">Completed media requests</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Avg End-to-End Latency</span>' +
              '<strong id="wbDiagTrendLat" class="value">0ms</strong>' +
              '<div class="sub">Across all modalities</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Total 24h Requests</span>' +
              '<strong id="wbDiagTrendTotal" class="value">0</strong>' +
              '<div class="sub">Tracked in job manager</div>' +
            '</div>' +
            '<div class="card mini">' +
              '<span class="label">Adaptive Failovers</span>' +
              '<strong id="wbDiagTrendFailover" class="value">0</strong>' +
              '<div class="sub">Automatic model fallbacks</div>' +
            '</div>' +
          '</div>' +

          '<!-- Error Categorization Breakdown -->' +
          '<div class="card section">' +
            '<div class="section-head">' +
              '<div>' +
                '<div class="section-title">Classified Failure Taxonomy (24h)</div>' +
                '<div class="section-note">Errors are automatically categorized to prevent raw stack-trace dumps and provide immediate remediation paths.</div>' +
              '</div>' +
            '</div>' +
            '<div id="wbDiagErrorChips" style="display:flex;gap:8px;flex-wrap:wrap"></div>' +
          '</div>' +

          '<!-- Live Execution Logs Table -->' +
          '<div class="card section">' +
            '<div class="section-head">' +
              '<div>' +
                '<div class="section-title">Recent Media Generation Jobs</div>' +
                '<div class="section-note">Inspect actual status, duration, and error diagnostics for live bot requests.</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px">' +
                '<select id="wbDiagJobModalityFilter" class="select" style="width:auto" onchange="window.__wbDiagReloadJobs()">' +
                  '<option value="">All Modalities</option>' +
                  '<option value="image">Images</option>' +
                  '<option value="video">Videos</option>' +
                  '<option value="audio">Audio</option>' +
                '</select>' +
                '<select id="wbDiagJobStatusFilter" class="select" style="width:auto" onchange="window.__wbDiagReloadJobs()">' +
                  '<option value="">All Statuses</option>' +
                  '<option value="completed">Completed</option>' +
                  '<option value="failed">Failed</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="table-wrap">' +
              '<table class="table">' +
                '<thead>' +
                  '<tr>' +
                    '<th>Time</th>' +
                    '<th>Modality</th>' +
                    '<th>Prompt</th>' +
                    '<th>Provider / Model</th>' +
                    '<th>Latency</th>' +
                    '<th>Status</th>' +
                    '<th>Diagnostic Classification</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody id="wbDiagJobsTbody">' +
                  '<tr><td colspan="7" class="empty">Loading recent execution logs…</td></tr>' +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +
        '</div>';

      const mainEl = document.querySelector('main');
      if (mainEl) mainEl.appendChild(section);

      window.__wbDiagRefresh = loadAllDiagnostics;
      window.__wbDiagRunAll = runAllProbes;
      window.__wbDiagRunProbe = runProbe;
      window.__wbDiagRunSim = simulatePipeline;
      window.__wbDiagSendTelegram = sendTelegramAlert;
      window.__wbDiagSwitchTab = switchSubTab;
      window.__wbDiagReloadJobs = loadJobsTable;

      setTimeout(loadAllDiagnostics, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDiagnostics, { once: true });
  } else {
    initDiagnostics();
  }

  const observer = new MutationObserver(installNav);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>
`;
}
