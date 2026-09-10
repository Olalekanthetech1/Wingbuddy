export function renderDashboardControlPlane(): string {
  return String.raw`
<style>
.wb-cp{margin-top:16px}.wb-cp-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.wb-cp-stat{padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.wb-cp-stat strong{display:block;font-size:18px}.wb-cp-stat span{display:block;color:var(--muted);font-size:11px;margin-top:2px}.wb-key-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wb-key-form{display:grid;grid-template-columns:1fr 1.2fr auto;gap:8px;margin-top:10px}.wb-key-card{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--panel)}.wb-key-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.wb-key-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.wb-cp-note{font-size:12px;color:var(--muted);margin-top:8px}@media(max-width:760px){.wb-cp-grid,.wb-key-form,.wb-key-card{grid-template-columns:1fr}}
</style>
<script>
(function(){
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.style.display='block';clearTimeout(window.__wbCpToast);window.__wbCpToast=setTimeout(()=>el.style.display='none',4200)}
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}

  async function loadControlPlane(){
    try{
      const d=await api('/api/stats');
      const pool=d.keyPool||{}; const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v};
      set('wbCpKeys',pool.totalKeys??0);set('wbCpHealthy',pool.healthyKeys??0);set('wbCpModel',d.geminiModel||'—');set('wbCpExec',d.executionEngine?.enabled?'Enabled':'Disabled');
    }catch(e){const el=document.getElementById('wbCpNote');if(el)el.textContent='Control-plane telemetry unavailable: '+e.message}
  }

  async function loadKeys(){
    const root=document.getElementById('wbKeyManager');if(!root)return;
    root.querySelector('[data-key-loading]').textContent='Refreshing encrypted key registry…';
    try{
      const d=await api('/api/keys'); const keys=d.keys||[];
      document.getElementById('wbKeyCount').textContent=keys.length; document.getElementById('wbKeyMode').value=d.rotationMode||'round_robin';
      document.getElementById('wbKeyList').innerHTML=keys.length?keys.map(k=>{
        const enabled=k.status!=='disabled'; const statusClass=k.status==='healthy'?'good':(k.status==='cooldown'?'warn':'bad');
        return '<div class="wb-key-card"><div><strong>'+esc(k.name)+'</strong><div class="mono" style="font-size:12px;color:var(--blue);margin-top:3px">'+esc(k.maskedKey)+'</div><div class="wb-key-meta"><span class="pill '+statusClass+'">'+esc(k.status)+'</span><span class="pill">'+esc(k.source)+'</span><span class="pill">Success '+esc(k.totalSuccess)+'</span><span class="pill">Errors '+esc(k.totalErrors)+'</span><span class="pill">Latency '+esc(k.avgLatencyMs??'—')+'ms</span>'+(k.cooldownSecondsLeft?'<span class="pill warn">Cooldown '+esc(k.cooldownSecondsLeft)+'s</span>':'')+'</div></div><div class="wb-key-actions"><button class="btn" data-key-test="'+esc(k.id)+'">Test</button><button class="btn" data-key-toggle="'+esc(k.id)+'">'+(enabled?'Disable':'Enable')+'</button><button class="btn danger" data-key-delete="'+esc(k.id)+'">Delete</button></div></div>';
      }).join(''):'<div class="empty">No managed Gemini API keys are registered.</div>';
      root.querySelector('[data-key-loading]').textContent='PostgreSQL is authoritative. Secrets are encrypted at rest and never returned to the browser.';
      await loadControlPlane();
    }catch(e){root.querySelector('[data-key-loading]').textContent='Unable to load key registry: '+e.message}
  }

  async function addKey(){
    const key=document.getElementById('wbNewApiKey').value.trim(); const name=document.getElementById('wbNewApiKeyName').value.trim();
    if(!key){toast('Enter a Gemini API key');return}
    try{const d=await api('/api/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,name})});document.getElementById('wbNewApiKey').value='';document.getElementById('wbNewApiKeyName').value='';toast('✓ '+(d.message||'Key saved'));await loadKeys()}catch(e){toast('Key save failed: '+e.message)}
  }
  async function setMode(mode){try{await api('/api/keys/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});toast('Rotation mode persisted');await loadKeys()}catch(e){toast('Rotation mode update failed: '+e.message)}}

  document.addEventListener('click',async e=>{
    const t=e.target;
    if(t.matches('[data-key-toggle]')){try{await api('/api/keys/'+encodeURIComponent(t.dataset.keyToggle)+'/toggle',{method:'PATCH'});toast('Key state persisted');await loadKeys()}catch(err){toast('Update failed: '+err.message)}}
    if(t.matches('[data-key-delete]')){if(!confirm('Remove this managed API key?'))return;try{const d=await api('/api/keys/'+encodeURIComponent(t.dataset.keyDelete),{method:'DELETE'});toast('✓ '+d.message);await loadKeys()}catch(err){toast('Delete failed: '+err.message)}}
    if(t.matches('[data-key-test]')){try{const d=await api('/api/keys/'+encodeURIComponent(t.dataset.keyTest)+'/test',{method:'POST'});toast(d.valid?(d.isRateLimited?'⚠ Key valid but rate-limited':'✓ Key responded in '+d.latencyMs+'ms'):'✕ '+(d.error||'Key test failed'));await loadKeys()}catch(err){toast('Test failed: '+err.message)}}
  });

  document.addEventListener('DOMContentLoaded',()=>{
    const overview=document.getElementById('view-overview');
    if(overview&&!document.getElementById('wbControlPlane')){const wrap=document.createElement('div');wrap.className='card wb-cp';wrap.id='wbControlPlane';wrap.innerHTML='<div class="section-head"><div><div class="section-title">Authoritative Runtime Control Plane</div><div class="section-note">One backend source of truth for models, keys, execution, and runtime health.</div></div><button class="btn" onclick="window.__wbLoadControlPlane()">Refresh</button></div><div class="wb-cp-grid"><div class="wb-cp-stat"><strong id="wbCpKeys">—</strong><span>Managed API keys</span></div><div class="wb-cp-stat"><strong id="wbCpHealthy">—</strong><span>Healthy keys</span></div><div class="wb-cp-stat"><strong id="wbCpModel">—</strong><span>Active primary model</span></div><div class="wb-cp-stat"><strong id="wbCpExec">—</strong><span>Execution engine</span></div></div><div class="wb-cp-note" id="wbCpNote">Live state is read from the server; UI values are not a separate configuration store.</div>';overview.appendChild(wrap);window.__wbLoadControlPlane=loadControlPlane;loadControlPlane()}
    const models=document.getElementById('view-models');
    if(models&&!document.getElementById('wbKeyManager')){const wrap=document.createElement('div');wrap.className='card wb-model-manager';wrap.id='wbKeyManager';wrap.innerHTML='<div class="section-head"><div><div class="section-title">Managed API-Key Registry <span class="pill" id="wbKeyCount">0</span></div><div class="section-note" data-key-loading>Loading encrypted database registry…</div></div><div class="wb-key-toolbar"><select id="wbKeyMode" class="select" style="width:auto" onchange="window.__wbSetKeyMode(this.value)"><option value="round_robin">Round robin</option><option value="failover">Failover</option></select><button class="btn" onclick="window.__wbLoadKeys()">Refresh</button></div></div><div class="notice">Dashboard-created keys survive restarts with their names, state, cooldowns, and health metrics. Environment keys are imported as managed records; revoked environment keys are tombstoned so they cannot silently reappear.</div><div id="wbKeyList" class="stack" style="margin-top:10px"></div><div style="border-top:1px solid var(--line);margin-top:13px;padding-top:13px"><div class="section-title">Add API key</div><div class="wb-key-form"><input id="wbNewApiKey" class="input" type="password" autocomplete="new-password" placeholder="Gemini API key"/><input id="wbNewApiKeyName" class="input" placeholder="Display name (optional)"/><button class="btn primary" onclick="window.__wbAddKey()">Validate & Save</button></div></div>';const anchor=models.querySelector('.card.section:nth-of-type(3)')||models.lastElementChild;models.insertBefore(wrap,anchor||null);window.__wbLoadKeys=loadKeys;window.__wbAddKey=addKey;window.__wbSetKeyMode=setMode;loadKeys()}
  });
})();
</script>`;
}
