export function renderDashboardProviderKeyControls(): string {
  return String.raw`
<section id="provider-key-control-plane" style="margin:24px 0;padding:20px;border:1px solid rgba(148,163,184,.22);border-radius:18px;background:rgba(15,23,42,.55);color:#e5e7eb;font-family:system-ui,sans-serif">
  <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
    <div><h2 style="margin:0 0 6px;font-size:20px">Provider API Key Pools</h2><p style="margin:0;color:#94a3b8;font-size:13px">Manage multiple encrypted API keys per provider. Rotation and failover happen below model/provider routing.</p></div>
    <div style="display:flex;gap:8px;align-items:center"><select id="pk-mode" style="padding:8px;border-radius:9px;background:#0f172a;color:#e5e7eb;border:1px solid #334155"><option value="round_robin">Round robin</option><option value="failover">Failover</option></select><button id="pk-mode-save" style="padding:8px 11px;border:1px solid #334155;border-radius:9px;background:#111827;color:#e5e7eb;cursor:pointer">Save rotation</button><button id="pk-refresh" style="padding:8px 11px;border:1px solid #334155;border-radius:9px;background:#111827;color:#e5e7eb;cursor:pointer">Refresh</button></div>
  </div>
  <div id="pk-status" style="margin-top:12px;font-size:13px;color:#94a3b8"></div>
  <div id="pk-providers" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px;margin-top:16px"></div>
</section>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url, options){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Request failed');return b;}
  async function load(){
    $('pk-status').textContent='Refreshing provider key pools…';
    try{
      const [providers, summaries, models]=await Promise.all([json('/api/providers'),json('/api/provider-keys/summary/all'),json('/api/models')]);
      const availableModels=new Map(models.models.map(m=>[m.provider,m]));
      const entries=providers.providers.map(p=>{
        const pool=summaries.providers[p.id]||{provider:p.id,totalKeys:0,healthyKeys:0,inCooldownKeys:0,disabledKeys:0,invalidKeys:0,keys:[]};
        const model=availableModels.get(p.id);
        return '<div style="padding:14px;border:1px solid #334155;border-radius:12px;background:#0b1220"><div style="display:flex;justify-content:space-between;gap:10px"><strong>'+esc(p.name)+'</strong><span style="font-size:11px;color:'+(p.enabled&&p.configured?'#4ade80':'#fbbf24')+'">'+(p.enabled&&p.configured?'READY':'NOT READY')+'</span></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;font-size:11px"><div><span style="color:#94a3b8">Total</span><br><b>'+pool.totalKeys+'</b></div><div><span style="color:#94a3b8">Healthy</span><br><b>'+pool.healthyKeys+'</b></div><div><span style="color:#94a3b8">Cooldown</span><br><b>'+pool.inCooldownKeys+'</b></div><div><span style="color:#94a3b8">Invalid</span><br><b>'+pool.invalidKeys+'</b></div></div><div style="margin-top:10px;display:grid;gap:7px">'+(pool.keys.length?pool.keys.map(k=>'<div style="display:flex;justify-content:space-between;gap:7px;align-items:center;padding:7px 8px;border:1px solid #1e293b;border-radius:9px"><div><b>'+esc(k.name)+'</b><div style="font:11px ui-monospace;color:#94a3b8">'+esc(k.maskedKey)+'</div></div><span style="font-size:11px">'+esc(k.status)+'</span><div style="display:flex;gap:4px"><button data-pk-toggle="'+esc(k.id)+'" style="padding:5px 7px;border-radius:7px;border:1px solid #334155;background:#111827;color:#e5e7eb">'+(k.status==='disabled'?'Enable':'Disable')+'</button><button data-pk-delete="'+esc(k.id)+'" style="padding:5px 7px;border-radius:7px;border:1px solid #7f1d1d;background:#2a0d12;color:#fecaca">Remove</button></div></div>').join(''):'<div style="color:#94a3b8;font-size:12px">No managed keys yet.</div>')+'</div><div style="border-top:1px solid #1e293b;margin-top:12px;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:7px"><input id="pk-name-'+esc(p.id)+'" placeholder="Key label" style="padding:8px;border-radius:8px;background:#0f172a;color:#e5e7eb;border:1px solid #334155"/><input id="pk-key-'+esc(p.id)+'" placeholder="Paste API key" type="password" autocomplete="new-password" style="padding:8px;border-radius:8px;background:#0f172a;color:#e5e7eb;border:1px solid #334155"/><select id="pk-model-'+esc(p.id)+'" style="padding:8px;border-radius:8px;background:#0f172a;color:#e5e7eb;border:1px solid #334155;grid-column:1/-1">'+models.models.filter(m=>m.provider===p.id&&m.enabled&&!m.roles.includes('embedding')).map(m=>'<option value="'+esc(m.modelId)+'">'+esc(m.name||m.modelId)+' · '+esc(m.modelId)+'</option>').join('')+'</select><button data-pk-add="'+esc(p.id)+'" style="padding:9px;border:0;border-radius:9px;background:#2563eb;color:white;cursor:pointer;grid-column:1/-1">Validate & Add Key</button></div></div>';
      }).join('');
      $('pk-providers').innerHTML=entries; $('pk-status').textContent='Encrypted provider key pools loaded from PostgreSQL.';
      document.querySelectorAll('[data-pk-add]').forEach(b=>b.onclick=async()=>{try{const id=b.dataset.pkAdd;const key=$(('pk-key-'+id)).value.trim();const name=$(('pk-name-'+id)).value.trim();const model=$(('pk-model-'+id)).value;await json('/api/provider-keys',{method:'POST',body:JSON.stringify({provider:id,key,name,model})});$('pk-key-'+id).value='';$('pk-name-'+id).value='';await load();}catch(e){alert(e.message)}});
      document.querySelectorAll('[data-pk-toggle]').forEach(b=>b.onclick=async()=>{try{await json('/api/provider-keys/'+encodeURIComponent(b.dataset.pkToggle)+'/toggle',{method:'PATCH',body:'{}'});load();}catch(e){alert(e.message)}});
      document.querySelectorAll('[data-pk-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this provider API key?'))return;try{await json('/api/provider-keys/'+encodeURIComponent(b.dataset.pkDelete),{method:'DELETE'});load();}catch(e){alert(e.message)}});
      const first=Object.values(summaries.providers)[0]; if(first) $('pk-mode').value=first.rotationMode||'round_robin';
    }catch(e){$('pk-status').textContent='Error: '+e.message;}
  }
  $('pk-refresh').onclick=load;
  $('pk-mode-save').onclick=async()=>{try{await json('/api/provider-keys/mode',{method:'POST',body:JSON.stringify({mode:$('pk-mode').value})});load();}catch(e){alert(e.message)}};
  load();
})();
</script>`;
}
