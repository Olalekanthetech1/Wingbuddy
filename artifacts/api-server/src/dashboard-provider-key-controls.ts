export function renderDashboardProviderKeyControls(): string {
  return String.raw`
<style>
.wb-provider-keys-section { margin-top: 16px; }
.wb-provider-keys-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 12px; margin-top: 14px; }
.wb-pk-card { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); transition: background-color .18s ease, border-color .18s ease; }
.wb-pk-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; font-size: 11px; }
.wb-pk-item { display: flex; justify-content: space-between; gap: 7px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-3); transition: background-color .18s ease, border-color .18s ease; }
@media(max-width:760px){
  .wb-provider-keys-grid { grid-template-columns: 1fr; }
}
</style>
<script>
(() => {
  function mountProviderKeyControls() {
    const view = document.getElementById('view-models');
    if (!view || document.getElementById('provider-key-control-plane')) return;

    const wrap = document.createElement('div');
    wrap.id = 'provider-key-control-plane';
    wrap.className = 'card section wb-provider-keys-section';
    wrap.innerHTML = '<div class="section-head">' +
      '<div>' +
        '<div class="section-title">Provider API Key Pools & Discovery</div>' +
        '<div class="section-note">Manage encrypted API keys per provider with rotation modes, health monitoring, and live model discovery.</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<select id="pk-mode" class="select" style="width:auto">' +
          '<option value="round_robin">Round robin</option>' +
          '<option value="failover">Failover</option>' +
        '</select>' +
        '<button id="pk-mode-save" class="btn">Save Rotation</button>' +
        '<button id="pk-refresh" class="btn">Refresh</button>' +
      '</div>' +
    '</div>' +
    '<div id="pk-status" style="margin-top:10px;font-size:12px;color:var(--muted)"></div>' +
    '<div id="pk-providers" class="wb-provider-keys-grid"></div>';

    view.appendChild(wrap);
    wireProviderKeyEvents();
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const previewCatalogs = new Map();

  async function json(url, options) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || 'Request failed');
    return b;
  }

  async function storedCatalogFor(provider) {
    try {
      const d = await json('/api/models/catalog/' + encodeURIComponent(provider));
      return d.models || [];
    } catch {
      return [];
    }
  }

  function populateModelOptions(id, models) {
    const select = $('pk-model-' + id);
    if (!select) return;
    select.innerHTML = models.length
      ? models.filter(m => !(m.capabilities || []).some(c => String(c).toLowerCase().includes('embedding'))).map(m => '<option value="' + esc(m.modelId) + '">' + esc(m.name || m.modelId) + ' · ' + esc(m.modelId) + '</option>').join('')
      : '<option value="">No model available</option>';
  }

  async function previewModels(provider) {
    const key = $('pk-key-' + provider).value.trim();
    if (!key) {
      if (window.toast) window.toast('Enter the API key first', true);
      else alert('Enter the API key first.');
      return;
    }
    const status = $('pk-catalog-status-' + provider);
    if (status) status.textContent = 'Fetching live models using the entered key…';
    try {
      const d = await json('/api/models/catalog/preview', { method: 'POST', body: JSON.stringify({ provider, apiKey: key }) });
      previewCatalogs.set(provider, d.models || []);
      populateModelOptions(provider, d.models || []);
      if (status) status.textContent = (d.models || []).length + ' live models discovered from this key.';
      if (window.toast) window.toast('✓ ' + (d.models || []).length + ' live models discovered');
    } catch(e) {
      if (status) status.textContent = 'Model discovery failed: ' + e.message;
      if (window.toast) window.toast('Model discovery failed: ' + e.message, true);
      else alert(e.message);
    }
  }

  async function loadProviderKeys() {
    const statusEl = $('pk-status');
    if (statusEl) statusEl.textContent = 'Refreshing provider key pools and live model catalogs…';
    try {
      const [providers, summaries, models] = await Promise.all([
        json('/api/providers'),
        json('/api/provider-keys/summary/all'),
        json('/api/models')
      ]);
      const registeredByProvider = new Map();
      (models.models || []).forEach(m => {
        if (!registeredByProvider.has(m.provider)) registeredByProvider.set(m.provider, []);
        registeredByProvider.get(m.provider).push(m);
      });
      const catalogs = await Promise.all((providers.providers || []).map(async p => [p.id, await storedCatalogFor(p.id)]));
      const catalogByProvider = new Map(catalogs);
      const entries = (providers.providers || []).map(p => {
        const pool = summaries.providers[p.id] || { provider: p.id, totalKeys: 0, healthyKeys: 0, inCooldownKeys: 0, disabledKeys: 0, invalidKeys: 0, keys: [] };
        const live = catalogByProvider.get(p.id) || [];
        const registered = registeredByProvider.get(p.id) || [];
        const combined = new Map();
        [...live, ...registered.map(m => ({ provider: p.id, modelId: m.modelId, name: m.name, capabilities: m.capabilities || [], status: 'registered' }))].forEach(m => {
          if (m.modelId && !combined.has(m.modelId)) combined.set(m.modelId, m);
        });
        const options = [...combined.values()]
          .filter(m => !((m.capabilities || []).some(c => String(c).toLowerCase().includes('embedding'))))
          .sort((a, b) => String(a.name || a.modelId).localeCompare(String(b.name || b.modelId)))
          .map(m => '<option value="' + esc(m.modelId) + '">' + esc(m.name || m.modelId) + ' · ' + esc(m.modelId) + '</option>')
          .join('');
        const requiresModel = (p.capabilities || []).includes('chat');
        const modelFields = requiresModel
          ? '<button data-pk-discover="' + esc(p.id) + '" class="btn" style="grid-column:1/-1">Load live models from this key</button><select id="pk-model-' + esc(p.id) + '" class="select" style="grid-column:1/-1">' + (options || '<option value="">Load live models first</option>') + '</select><div id="pk-catalog-status-' + esc(p.id) + '" style="grid-column:1/-1;color:var(--muted);font-size:11px">' + (live.length ? 'Live provider catalog available.' : 'Enter a key and load its live model catalog before adding the first key.') + '</div>'
          : '<div style="grid-column:1/-1;padding:7px 9px;border-radius:8px;background:var(--panel-3);border:1px solid var(--line);color:var(--muted);font-size:11px">Direct endpoint authentication (' + esc((p.capabilities || []).join(', ')) + '). Validates API key directly without model selection.</div>';
        
        const isReady = Boolean(p.enabled && p.configured);
        return '<div class="wb-pk-card">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">' +
            '<strong>' + esc(p.name) + '</strong>' +
            '<span class="pill ' + (isReady ? 'good' : 'warn') + '">' + (isReady ? 'READY' : 'NOT READY') + '</span>' +
          '</div>' +
          '<div class="wb-pk-stats-grid">' +
            '<div><span style="color:var(--muted)">Total</span><br><b>' + pool.totalKeys + '</b></div>' +
            '<div><span style="color:var(--muted)">Healthy</span><br><b>' + pool.healthyKeys + '</b></div>' +
            '<div><span style="color:var(--muted)">Cooldown</span><br><b>' + pool.inCooldownKeys + '</b></div>' +
            '<div><span style="color:var(--muted)">Invalid</span><br><b>' + pool.invalidKeys + '</b></div>' +
          '</div>' +
          '<div style="margin-top:10px;display:grid;gap:7px">' +
            (pool.keys.length ? pool.keys.map(k => {
              const statusPill = k.status === 'healthy' ? 'good' : (k.status === 'cooldown' ? 'warn' : 'bad');
              return '<div class="wb-pk-item">' +
                '<div><b>' + esc(k.name) + '</b><div class="mono" style="font-size:11px;color:var(--muted)">' + esc(k.maskedKey) + '</div></div>' +
                '<span class="pill ' + statusPill + '">' + esc(k.status) + '</span>' +
                '<span class="pill">' + esc(k.source || 'env') + '</span>' +
                '<div style="display:flex;gap:4px">' +
                  '<button data-pk-toggle="' + esc(k.id) + '" class="btn" style="padding:4px 8px;font-size:11px">' + (k.status === 'disabled' ? 'Enable' : 'Disable') + '</button>' +
                  '<button data-pk-delete="' + esc(k.id) + '" class="btn danger" style="padding:4px 8px;font-size:11px">Remove</button>' +
                '</div>' +
              '</div>';
            }).join('') : '<div style="color:var(--muted);font-size:12px">No managed keys yet.</div>') +
          '</div>' +
          '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:7px">' +
            '<input id="pk-name-' + esc(p.id) + '" class="input" placeholder="Key label" />' +
            '<input id="pk-key-' + esc(p.id) + '" class="input" placeholder="Paste API key" type="password" autocomplete="new-password" />' +
            modelFields +
            '<button data-pk-add="' + esc(p.id) + '" class="btn primary" style="grid-column:1/-1">Validate & Add Key</button>' +
          '</div>' +
        '</div>';
      }).join('');
      
      const provContainer = $('pk-providers');
      if (provContainer) provContainer.innerHTML = entries;
      if (statusEl) statusEl.textContent = 'Encrypted provider key pools and live model catalogs loaded.';

      document.querySelectorAll('[data-pk-discover]').forEach(b => b.onclick = () => previewModels(b.dataset.pkDiscover));
      
      document.querySelectorAll('[data-pk-add]').forEach(b => b.onclick = async () => {
        try {
          const id = b.dataset.pkAdd;
          const key = $('pk-key-' + id).value.trim();
          const name = $('pk-name-' + id).value.trim();
          const modelSelect = $('pk-model-' + id);
          const model = modelSelect ? modelSelect.value : '';
          if (modelSelect && !model) throw new Error('Load and select a current model for key validation');
          await json('/api/provider-keys', { method: 'POST', body: JSON.stringify({ provider: id, key, name, model }) });
          $('pk-key-' + id).value = '';
          $('pk-name-' + id).value = '';
          previewCatalogs.delete(id);
          if (window.toast) window.toast('✓ Provider API key validated and stored');
          await loadProviderKeys();
        } catch(e) {
          if (window.toast) window.toast('Key validation failed: ' + e.message, true);
          else alert(e.message);
        }
      });

      document.querySelectorAll('[data-pk-toggle]').forEach(b => b.onclick = async () => {
        try {
          await json('/api/provider-keys/' + encodeURIComponent(b.dataset.pkToggle) + '/toggle', { method: 'PATCH', body: '{}' });
          if (window.toast) window.toast('Key status toggled');
          loadProviderKeys();
        } catch(e) {
          if (window.toast) window.toast('Toggle error: ' + e.message, true);
          else alert(e.message);
        }
      });

      document.querySelectorAll('[data-pk-delete]').forEach(b => b.onclick = async () => {
        if (!confirm('Remove this provider API key?')) return;
        try {
          await json('/api/provider-keys/' + encodeURIComponent(b.dataset.pkDelete), { method: 'DELETE' });
          if (window.toast) window.toast('Key removed');
          loadProviderKeys();
        } catch(e) {
          if (window.toast) window.toast('Delete error: ' + e.message, true);
          else alert(e.message);
        }
      });

      const first = Object.values(summaries.providers || {})[0];
      if (first && $('pk-mode')) $('pk-mode').value = first.rotationMode || 'round_robin';
    } catch(e) {
      if (statusEl) statusEl.textContent = 'Error: ' + e.message;
    }
  }

  function wireProviderKeyEvents() {
    const refreshBtn = $('pk-refresh');
    if (refreshBtn) refreshBtn.onclick = loadProviderKeys;

    const modeSaveBtn = $('pk-mode-save');
    if (modeSaveBtn) {
      modeSaveBtn.onclick = async () => {
        try {
          await json('/api/provider-keys/mode', { method: 'POST', body: JSON.stringify({ mode: $('pk-mode').value }) });
          if (window.toast) window.toast('✓ Key rotation mode persisted');
          loadProviderKeys();
        } catch(e) {
          if (window.toast) window.toast('Mode save error: ' + e.message, true);
          else alert(e.message);
        }
      };
    }

    loadProviderKeys();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountProviderKeyControls);
  } else {
    mountProviderKeyControls();
  }
})();
</script>`;
}
