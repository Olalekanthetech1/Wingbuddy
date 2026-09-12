export function renderDashboardAIRoutingControls(): string {
  return String.raw`
<style>
.wb-ai-routing-section { margin-top: 16px; }
.wb-ai-routing-summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 12px; }
.wb-ai-routing-providers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 14px; }
.wb-air-stat-card { padding: 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); transition: background-color .18s ease, border-color .18s ease; }
.wb-air-stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.wb-air-stat-val { margin-top: 4px; font-weight: 800; font-size: 18px; }
.wb-air-provider-card { padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); transition: background-color .18s ease, border-color .18s ease; }
@media(max-width:760px){
  .wb-ai-routing-summary-grid, .wb-ai-routing-providers-grid { grid-template-columns: 1fr; }
}
</style>
<script>
(() => {
  function mountAIRoutingControls() {
    const view = document.getElementById('view-models');
    if (!view || document.getElementById('ai-routing-control-plane')) return;

    const wrap = document.createElement('div');
    wrap.id = 'ai-routing-control-plane';
    wrap.className = 'card section wb-ai-routing-section';
    wrap.innerHTML = '<div class="section-head">' +
      '<div>' +
        '<div class="section-title">Adaptive AI Routing Control Plane</div>' +
        '<div class="section-note">Provider-neutral scoring, latency tracking, health evaluation, and autonomous failover.</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<label style="font-size:12px;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:4px">' +
          '<input id="air-auto" type="checkbox" checked style="vertical-align:middle" /> Auto refresh' +
        '</label>' +
        '<button id="air-refresh" class="btn">Refresh</button>' +
      '</div>' +
    '</div>' +
    '<div id="air-status" style="margin-top:10px;font-size:12px;color:var(--muted)"></div>' +
    '<div id="air-summary" class="wb-ai-routing-summary-grid"></div>' +
    '<div id="air-providers" class="wb-ai-routing-providers-grid"></div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:18px">' +
      '<div style="flex:1 1 600px;min-width:0">' +
        '<h3 style="font-size:14px;font-weight:700;margin:0 0 8px">Registered Models Routing Status</h3>' +
        '<div class="table-wrap">' +
          '<table class="table">' +
            '<thead>' +
              '<tr>' +
                '<th>Provider</th>' +
                '<th>Model</th>' +
                '<th style="text-align:center">Active</th>' +
                '<th style="text-align:center">Action</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="air-models"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div style="flex:0 1 320px;min-width:280px">' +
        '<h3 style="font-size:14px;font-weight:700;margin:0 0 8px">Register Model</h3>' +
        '<div class="stack">' +
          '<select id="air-provider" class="select">' +
            '<option value="gemini">Gemini</option>' +
            '<option value="groq">Groq</option>' +
            '<option value="mistral">Mistral</option>' +
          '</select>' +
          '<input id="air-model-id" class="input" placeholder="Provider model ID" />' +
          '<input id="air-model-name" class="input" placeholder="Display name (optional)" />' +
          '<input id="air-model-capabilities" class="input" placeholder="Capabilities (comma separated)" />' +
          '<button id="air-add-model" class="btn primary">Register Model</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:18px">' +
      '<h3 style="font-size:14px;font-weight:700;margin:0 0 8px">Adaptive Routing Policy Weights</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">' +
        '<div style="padding:9px 11px;border-radius:9px;background:var(--panel-3);border:1px solid var(--line);color:var(--green);font-size:12px;display:flex;align-items:center">' +
          '● Adaptive Strategy' +
        '</div>' +
        '<input id="air-cap" class="input" type="number" min="0" max="100" placeholder="Capability weight" title="Capability Weight" />' +
        '<input id="air-health-weight" class="input" type="number" min="0" max="100" placeholder="Health weight" title="Health Weight" />' +
        '<input id="air-latency" class="input" type="number" min="0" max="100" placeholder="Latency weight" title="Latency Weight" />' +
        '<input id="air-priority" class="input" type="number" min="0" max="100" placeholder="Priority weight" title="Priority Weight" />' +
        '<input id="air-attempts" class="input" type="number" min="1" max="6" placeholder="Max attempts" title="Max Attempts" />' +
        '<button id="air-save-policy" class="btn primary">Save Policy</button>' +
      '</div>' +
      '<div class="section-note" style="margin-top:8px">' +
        'Every enabled, compatible model participates on equal provider footing. Capability match, health, EWMA latency, and configured priority determine the score.' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:18px">' +
      '<div class="section-head" style="margin-bottom:8px">' +
        '<h3 style="font-size:14px;font-weight:700;margin:0">Health & Latency Telemetry Matrix</h3>' +
        '<button id="air-reset-health" class="btn danger" style="padding:6px 10px;font-size:12px">Reset All Health</button>' +
      '</div>' +
      '<div id="air-health" class="table-wrap"></div>' +
    '</div>';

    view.appendChild(wrap);
    wireAIRoutingEvents();
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url, options) { 
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options }); 
    const body = await r.json().catch(() => ({})); 
    if (!r.ok) throw new Error(body.error || 'Request failed'); 
    return body; 
  }
  const statCard = (label, value) => '<div class="wb-air-stat-card"><div class="wb-air-stat-label">'+esc(label)+'</div><div class="wb-air-stat-val">'+esc(value)+'</div></div>';

  async function loadAIRouting() {
    const statusEl = $('air-status');
    if (statusEl) statusEl.textContent = 'Refreshing AI routing telemetry…';
    try {
      const [providers, models, policy, health, obs] = await Promise.all([
        json('/api/providers'),
        json('/api/models'),
        json('/api/ai/routing/policy'),
        json('/api/ai/routing/health'),
        json('/api/ai/observability')
      ]);
      const totals = obs.observability?.totals || { requests: 0, successRate: 100, avgLatencyMs: 0 };
      
      const summary = $('air-summary');
      if (summary) {
        summary.innerHTML = [
          statCard('Strategy', 'Adaptive'),
          statCard('Total Requests', totals.requests),
          statCard('Success Rate', (totals.successRate || 0) + '%'),
          statCard('Avg Latency', (totals.avgLatencyMs || 0) + ' ms'),
          statCard('Active Models', models.models?.length || 0),
          statCard('Ready Providers', (providers.providers || []).filter(p => p.enabled && p.configured && p.adapterAvailable).length)
        ].join('');
      }

      const provsEl = $('air-providers');
      if (provsEl) {
        provsEl.innerHTML = (providers.providers || []).map(p => {
          const isReady = Boolean(p.enabled && p.configured);
          return '<div class="wb-air-provider-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center">' +
              '<strong>' + esc(p.name) + '</strong>' +
              '<span class="pill ' + (isReady ? 'good' : 'warn') + '">' + (isReady ? 'Ready' : 'Not Ready') + '</span>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:4px">' + esc(p.id) + ' · ' + (p.adapterAvailable ? 'adapter available' : 'adapter pending') + '</div>' +
            '<div style="margin-top:9px;display:flex;gap:6px">' +
              '<button data-provider="' + esc(p.id) + '" class="btn air-toggle" style="padding:5px 9px;font-size:12px">' + (p.enabled ? 'Disable' : 'Enable') + '</button>' +
              '<button data-test-provider="' + esc(p.id) + '" class="btn" style="padding:5px 9px;font-size:12px">Test</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      const modelsEl = $('air-models');
      if (modelsEl) {
        modelsEl.innerHTML = (models.models || []).length ? (models.models || []).map(m => 
          '<tr>' +
            '<td><span class="pill">' + esc(m.provider) + '</span></td>' +
            '<td><div><strong>' + esc(m.name) + '</strong></div><div class="mono" style="font-size:11px;color:var(--muted)">' + esc(m.modelId) + '</div></td>' +
            '<td style="text-align:center">' + (m.enabled ? '<span class="pill good">Enabled</span>' : '<span class="pill bad">Disabled</span>') + '</td>' +
            '<td style="text-align:center"><button class="btn air-model-toggle" data-id="' + esc(m.id) + '" data-enabled="' + String(m.enabled) + '" style="padding:4px 8px;font-size:11px">' + (m.enabled ? 'Disable' : 'Enable') + '</button></td>' +
          '</tr>'
        ).join('') : '<tr><td colspan="4" class="empty">No registered models yet.</td></tr>';
      }

      if ($('air-cap') && policy.policy) {
        $('air-cap').value = policy.policy.capabilityWeight ?? 40;
        $('air-health-weight').value = policy.policy.healthWeight ?? 30;
        $('air-latency').value = policy.policy.latencyWeight ?? 15;
        $('air-priority').value = policy.policy.priorityWeight ?? 15;
        $('air-attempts').value = policy.policy.maxAttempts ?? 3;
      }

      const healthList = health.health || [];
      const hm = new Map(healthList.map(h => [h.id, h]));
      const healthEl = $('air-health');
      if (healthEl) {
        healthEl.innerHTML = '<table class="table"><thead><tr><th>Model ID</th><th style="text-align:center">Health Score</th><th style="text-align:center">EWMA Latency</th><th style="text-align:center">Success / Fail</th><th>Last Error</th><th style="text-align:center">Action</th></tr></thead><tbody>' +
          (healthList.length ? healthList.map(h => 
            '<tr>' +
              '<td><div class="mono" style="font-weight:700">' + esc(h.provider + '/' + h.modelId) + '</div></td>' +
              '<td style="text-align:center"><span class="pill ' + (h.healthScore >= 80 ? 'good' : h.healthScore >= 50 ? 'warn' : 'bad') + '">' + esc(h.healthScore) + '</span></td>' +
              '<td style="text-align:center">' + esc(h.ewmaLatencyMs) + ' ms</td>' +
              '<td style="text-align:center">' + esc(h.successes) + ' / ' + esc(h.failures) + '</td>' +
              '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)">' + esc(h.lastError || '—') + '</td>' +
              '<td style="text-align:center"><button class="btn air-reset-model" data-id="' + esc(h.id) + '" style="padding:4px 8px;font-size:11px">Reset</button></td>' +
            '</tr>'
          ).join('') : '<tr><td colspan="6" class="empty">No health telemetry recorded.</td></tr>') +
        '</tbody></table>';
      }

      if (statusEl) {
        statusEl.textContent = 'Routing: Adaptive provider-neutral policy active · Last refreshed: ' + new Date().toLocaleTimeString();
      }

      document.querySelectorAll('.air-toggle').forEach(b => b.onclick = async () => { 
        const p = (providers.providers || []).find(x => x.id === b.dataset.provider); 
        if (!p) return;
        await json('/api/providers/' + encodeURIComponent(b.dataset.provider), { method: 'PATCH', body: JSON.stringify({ enabled: !p.enabled }) }); 
        loadAIRouting(); 
      });

      document.querySelectorAll('[data-test-provider]').forEach(b => b.onclick = async () => {
        const p = (providers.providers || []).find(x => x.id === b.dataset.testProvider);
        if (!p) return;
        const requiresChatModel = (p.capabilities || []).includes('chat');
        const m = (models.models || []).find(x => x.provider === p.id && x.enabled);
        if (requiresChatModel && !m) {
          if (window.toast) window.toast('Enable or register a model for this provider first.', true);
          else alert('Enable or register a model for this provider first.');
          return;
        }
        b.disabled = true;
        b.textContent = 'Testing…';
        try {
          const result = await json('/api/providers/' + encodeURIComponent(p.id) + '/test', {
            method: 'POST',
            body: JSON.stringify({ model: m ? m.modelId : '' })
          });
          if (window.toast) window.toast(result.ok ? '✓ Provider ' + p.name + ' responded in ' + result.latencyMs + 'ms' : '✕ Provider test failed: ' + result.error, !result.ok);
          else alert(result.ok ? 'Provider test passed in ' + result.latencyMs + 'ms' : ('Provider test failed: ' + result.error));
        } finally {
          b.disabled = false;
          b.textContent = 'Test';
        }
      });

      document.querySelectorAll('.air-model-toggle').forEach(b => b.onclick = async () => { 
        await json('/api/models/' + encodeURIComponent(b.dataset.id), { method: 'PATCH', body: JSON.stringify({ enabled: b.dataset.enabled !== 'true' }) }); 
        loadAIRouting(); 
      });

      document.querySelectorAll('.air-reset-model').forEach(b => b.onclick = async () => { 
        const entry = hm.get(b.dataset.id);
        await json('/api/ai/health/reset', { method: 'POST', body: JSON.stringify({ modelId: entry?.modelId, provider: entry?.provider }) }); 
        loadAIRouting(); 
      });
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Routing telemetry error: ' + (e?.message || String(e));
    }
  }

  function wireAIRoutingEvents() {
    const refreshBtn = $('air-refresh');
    if (refreshBtn) refreshBtn.onclick = loadAIRouting;

    const addModelBtn = $('air-add-model');
    if (addModelBtn) {
      addModelBtn.onclick = async () => {
        try {
          const provider = $('air-provider').value;
          const modelId = $('air-model-id').value.trim();
          const name = $('air-model-name').value.trim();
          const caps = $('air-model-capabilities').value.split(',').map(x => x.trim()).filter(Boolean);
          if (!modelId) {
            if (window.toast) window.toast('Model ID is required', true);
            else alert('Model ID is required');
            return;
          }
          await json('/api/models', { method: 'POST', body: JSON.stringify({ provider, modelId, name, capabilities: caps }) });
          $('air-model-id').value = '';
          $('air-model-name').value = '';
          $('air-model-capabilities').value = '';
          if (window.toast) window.toast('✓ Model registered in routing plane');
          loadAIRouting();
        } catch(e) {
          if (window.toast) window.toast('Registration error: ' + e.message, true);
          else alert(e.message);
        }
      };
    }

    const savePolicyBtn = $('air-save-policy');
    if (savePolicyBtn) {
      savePolicyBtn.onclick = async () => {
        try {
          await json('/api/ai/routing/policy', {
            method: 'PATCH',
            body: JSON.stringify({
              strategy: 'adaptive',
              capabilityWeight: Number($('air-cap').value),
              healthWeight: Number($('air-health-weight').value),
              latencyWeight: Number($('air-latency').value),
              priorityWeight: Number($('air-priority').value),
              maxAttempts: Number($('air-attempts').value)
            })
          });
          if (window.toast) window.toast('✓ Routing policy weights saved');
          loadAIRouting();
        } catch(e) {
          if (window.toast) window.toast('Policy save error: ' + e.message, true);
          else alert(e.message);
        }
      };
    }

    const resetHealthBtn = $('air-reset-health');
    if (resetHealthBtn) {
      resetHealthBtn.onclick = async () => {
        if (!confirm('Reset all adaptive health scores and error counters?')) return;
        try {
          await json('/api/ai/health/reset', { method: 'POST', body: '{}' });
          if (window.toast) window.toast('Health scores reset');
          loadAIRouting();
        } catch(e) {
          if (window.toast) window.toast('Reset error: ' + e.message, true);
          else alert(e.message);
        }
      };
    }

    loadAIRouting();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAIRoutingControls);
  } else {
    mountAIRoutingControls();
  }

  let timer = setInterval(() => {
    const auto = $('air-auto');
    const view = document.getElementById('view-models');
    if (auto?.checked && view?.classList.contains('active')) {
      loadAIRouting();
    }
  }, 15000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
})();
</script>`;
}
