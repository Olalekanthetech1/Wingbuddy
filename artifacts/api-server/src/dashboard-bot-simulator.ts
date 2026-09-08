import { MODE_KEYS } from "./config/mode";

export function renderDashboardBotSimulator(): string {
  const modeOptions = [
    `<option value="">Use user's persisted mode</option>`,
    ...MODE_KEYS.map((mode) => `<option value="${mode}">${mode}</option>`),
    `<option value="auto">Auto / turn resolution</option>`,
  ].join("");

  return String.raw`
<style>
#simulatorShell{display:none}.sim-toolbar{display:grid;grid-template-columns:minmax(0,1fr) 180px 220px auto;gap:8px;margin-bottom:12px}.sim-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.sim-panel{background:linear-gradient(180deg,rgba(16,31,51,.96),rgba(10,22,38,.96));border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow)}.sim-label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.sim-textarea{width:100%;min-height:190px;resize:vertical;border:1px solid var(--line);background:#091524;color:var(--text);padding:12px;border-radius:10px;outline:none;font:inherit}.sim-textarea:focus,.sim-input:focus,.sim-select:focus{border-color:#2a78ca}.sim-input,.sim-select{width:100%;border:1px solid var(--line);background:#091524;color:var(--text);padding:10px 11px;border-radius:9px;outline:none}.sim-controls{display:grid;gap:9px}.sim-check{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.sim-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.sim-result{min-height:190px;white-space:pre-wrap;overflow:auto;border:1px solid var(--line);border-radius:10px;background:#081321;padding:13px}.sim-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.sim-card{border:1px solid var(--line);border-radius:10px;background:#0a1626;padding:10px}.sim-card strong{display:block;margin-bottom:3px}.sim-card span{font-size:12px;color:var(--muted)}.sim-trace{display:grid;grid-template-columns:1fr 1fr;gap:9px}.sim-kv{padding:10px;border:1px solid var(--line);border-radius:10px;background:#0a1626}.sim-kv b{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.sim-run-list{display:grid;gap:8px;max-height:430px;overflow:auto}.sim-run{border:1px solid var(--line);border-radius:10px;background:#0a1626;padding:10px;cursor:pointer}.sim-run:hover{border-color:#31567e}.sim-run-head{display:flex;justify-content:space-between;gap:8px}.sim-run-msg{margin-top:5px;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sim-tabs{display:flex;gap:6px;margin-bottom:9px}.sim-tab{border:1px solid var(--line);background:#0a1626;color:var(--muted);padding:7px 9px;border-radius:8px;cursor:pointer}.sim-tab.active{color:var(--text);border-color:#31567e;background:#0e2036}@media(max-width:980px){.sim-toolbar,.sim-grid,.sim-trace{grid-template-columns:1fr}.sim-meta{grid-template-columns:1fr 1fr}}@media(max-width:760px){.sim-meta{grid-template-columns:1fr}}
</style>
<section class="view" id="view-simulator">
  <div class="top">
    <div>
      <div class="eyebrow">Production Runtime Diagnostics</div>
      <div class="title">Bot Simulator</div>
      <p class="subtitle">Exercise the live planning/model path without sending Telegram messages or mutating production user state.</p>
    </div>
    <div class="toolbar"><span class="pill good">Isolated • No Telegram send</span></div>
  </div>
  <div class="sim-toolbar">
    <input id="simUserId" class="sim-input" placeholder="Telegram user ID (optional)" inputmode="numeric" />
    <select id="simMode" class="sim-select">${modeOptions}</select>
    <label class="sim-check" style="padding:0 9px;border:1px solid var(--line);border-radius:9px;background:#091524"><input id="simHistory" type="checkbox" checked /> Include persisted conversation history</label>
    <button class="btn primary" id="simRunBtn" onclick="runBotSimulation()">▶ Run Simulation</button>
  </div>
  <div class="sim-grid">
    <div class="sim-panel">
      <div class="sim-label">Incoming Telegram message</div>
      <textarea id="simMessage" class="sim-textarea" placeholder="Type exactly what you would send to Wingbuddy…"></textarea>
      <div class="sim-actions">
        <label class="sim-check"><input id="simSearch" type="checkbox" checked /> Permit live search when the resolved plan requests it</label>
        <button class="btn" onclick="simLoadRuns()">↻ Refresh Runs</button>
        <button class="btn" onclick="simClearResult()">Clear</button>
      </div>
      <div class="sim-meta">
        <div class="sim-card"><strong id="simModeMeta">—</strong><span>Effective mode</span></div>
        <div class="sim-card"><strong id="simIntentMeta">—</strong><span>Detected intent</span></div>
        <div class="sim-card"><strong id="simCapabilityMeta">—</strong><span>Capabilities</span></div>
      </div>
    </div>
    <div class="sim-panel">
      <div class="section-head"><div><div class="section-title">Recent Simulations</div><div class="section-note">Persisted diagnostics; no production chat state changes.</div></div></div>
      <div id="simRunList" class="sim-run-list"><div class="empty">Loading…</div></div>
    </div>
  </div>
  <div class="sim-panel" style="margin-top:12px">
    <div class="sim-tabs">
      <button class="sim-tab active" data-tab="response" onclick="simShowTab('response')">Response</button>
      <button class="sim-tab" data-tab="telegram" onclick="simShowTab('telegram')">Telegram Preview</button>
      <button class="sim-tab" data-tab="trace" onclick="simShowTab('trace')">Runtime Trace</button>
    </div>
    <div id="simTabResponse" class="sim-result">Run a simulation to inspect the real model response.</div>
    <div id="simTabTelegram" class="sim-result" style="display:none">Telegram-formatted preview will appear here.</div>
    <div id="simTabTrace" style="display:none"><div id="simTrace" class="sim-trace"></div></div>
  </div>
</section>
<script>
(function(){
  const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
  const fmtTime=(v)=>{try{return new Date(v).toLocaleString()}catch{return String(v||'')}};
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
    simLoadRuns();
  }
  window.showSimulator=function(){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('[data-simulator-nav]').forEach(b=>b.classList.add('active'));
    const section=document.getElementById('view-simulator'); if(section) section.classList.add('active');
    const shell=document.getElementById('simulatorShell'); if(shell) shell.style.display='block';
  };
  window.simShowTab=function(name){
    ['response','telegram','trace'].forEach(n=>{
      const el=document.getElementById('simTab'+n.charAt(0).toUpperCase()+n.slice(1)); if(el)el.style.display=n===name?'block':'none';
    });
    document.querySelectorAll('.sim-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  };
  window.simClearResult=function(){
    document.getElementById('simTabResponse').textContent='Run a simulation to inspect the real model response.';
    document.getElementById('simTabTelegram').textContent='Telegram-formatted preview will appear here.';
    document.getElementById('simTrace').innerHTML='';
    ['simModeMeta','simIntentMeta','simCapabilityMeta'].forEach(id=>document.getElementById(id).textContent='—');
  };
  window.runBotSimulation=async function(){
    const btn=document.getElementById('simRunBtn'); const msg=document.getElementById('simMessage').value.trim();
    if(!msg){alert('Enter a message to simulate.');return;}
    btn.disabled=true; btn.textContent='⏳ Running…';
    try{
      const body={message:msg,modeOverride:document.getElementById('simMode').value||undefined,includeHistory:document.getElementById('simHistory').checked,enableLiveSearch:document.getElementById('simSearch').checked};
      const uid=document.getElementById('simUserId').value.trim(); if(uid)body.telegramUserId=Number(uid);
      const r=await fetch('/api/simulator/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await r.json(); if(!r.ok||!data.success)throw new Error(data.error||data.result?.error||'Simulation failed');
      renderRun(data.result); simLoadRuns();
    }catch(e){ document.getElementById('simTabResponse').textContent='Simulation error: '+(e.message||String(e)); }
    finally{btn.disabled=false;btn.textContent='▶ Run Simulation';}
  };
  window.renderRun=function(run){
    document.getElementById('simTabResponse').textContent=run.response||run.error||'';
    document.getElementById('simTabTelegram').textContent=run.telegramPreview||'No preview generated.';
    const t=run.trace||{};
    document.getElementById('simModeMeta').textContent=t.effectiveMode||'—';
    document.getElementById('simIntentMeta').textContent=t.intent||'—';
    document.getElementById('simCapabilityMeta').textContent=(t.requiredCapabilities||[]).join(', ')||'none';
    const healthy=t.keyPool?.healthyKeys||0;
    const total=t.keyPool?.totalKeys||0;
    const entries=[['Simulation',t.simulationId],['User',t.telegramUserId??'anonymous'],['Persistent mode',t.persistentMode],['Effective mode',t.effectiveMode],['Personality',t.personality],['Intent',t.intent],['Search',String(t.enableSearch)],['Thinking',t.thinkingLevel||'—'],['Provider preference',t.providerPreference],['Model candidates',(t.modelCandidates||[]).join(', ')||'none'],['History messages',t.historyMessages],['Memory facts',t.memoryFacts],['Keys',healthy+'/'+total+' healthy'],['Side effects','Telegram: blocked • Execution: blocked • User mutation: blocked']];
    document.getElementById('simTrace').innerHTML=entries.map(([k,v])=>'<div class="sim-kv"><b>'+esc(k)+'</b><span>'+esc(v)+'</span></div>').join('');
    simShowTab('response');
  };
  window.simLoadRuns=async function(){
    const list=document.getElementById('simRunList'); if(!list)return; list.innerHTML='<div class="empty">Loading…</div>';
    try{
      const r=await fetch('/api/simulator/runs?limit=20'); const data=await r.json(); if(!r.ok||!data.success)throw new Error(data.error||'Load failed');
      if(!data.runs.length){list.innerHTML='<div class="empty">No simulation runs yet.</div>';return;}
      list.innerHTML=data.runs.map(run=>'<div class="sim-run" onclick="simLoadRun(\''+run.id+'\')"><div class="sim-run-head"><strong>'+esc(run.status)+'</strong><span class="pill">'+esc(fmtTime(run.created_at))+'</span></div><div class="sim-run-msg">'+esc(run.message)+'</div></div>').join('');
    }catch(e){list.innerHTML='<div class="empty">'+esc(e.message||String(e))+'</div>';}
  };
  window.simLoadRun=async function(id){
    try{const r=await fetch('/api/simulator/runs/'+encodeURIComponent(id));const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error||'Run not found');renderRun(data.run)}catch(e){alert(e.message||String(e))}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',activate);else setTimeout(activate,0);
})();
</script>`;
}
