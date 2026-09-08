export function renderDashboardModelControls(): string {
  return String.raw`
<style>
.wb-model-manager{margin-top:14px}.wb-model-form{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:8px;margin-top:10px}.wb-role-grid{display:flex;flex-wrap:wrap;gap:6px}.wb-role{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--line);border-radius:999px;background:#0a1626;color:var(--muted);font-size:11px}.wb-role input{accent-color:#5aa7ff}.wb-model-actions{display:flex;gap:6px;flex-wrap:wrap}.wb-model-card{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#0a1626}.wb-model-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.wb-help{margin-top:8px;font-size:12px;color:var(--muted)}@media(max-width:760px){.wb-model-form{grid-template-columns:1fr}.wb-model-card{grid-template-columns:1fr}}
</style>
<script>
(function(){
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.style.display='block';clearTimeout(window.__wbModelToast);window.__wbModelToast=setTimeout(()=>el.style.display='none',4200)}
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
  async function loadModelRegistry(){
    const root=document.getElementById('wbModelManager');if(!root)return;
    root.querySelector('[data-model-loading]').textContent='Refreshing registry…';
    try{
      const d=await api('/api/models'); const models=d.models||[];
      document.getElementById('wbModelCount').textContent=models.length;
      const list=document.getElementById('wbModelList');
      list.innerHTML=models.length?models.map(m=>{
        const roles=(m.roles||[]).map(r=>'<span class="pill">'+esc(r)+'</span>').join('');
        const enabled=m.enabled!==false;
        return '<div class="wb-model-card"><div><strong>'+esc(m.name)+'</strong><div class="mono" style="font-size:12px;color:var(--blue);margin-top:3px">'+esc(m.modelId)+'</div><div class="wb-model-meta">'+roles+'<span class="pill '+(enabled?'good':'bad')+'">'+(enabled?'Enabled':'Disabled')+'</span><span class="pill">Priority '+esc(m.priority)+'</span></div></div><div class="wb-model-actions"><button class="btn" data-model-test="'+esc(m.modelId)+'">Test</button><button class="btn" data-model-toggle="'+esc(m.id)+'" data-enabled="'+enabled+'">'+(enabled?'Disable':'Enable')+'</button><button class="btn danger" data-model-delete="'+esc(m.id)+'">Delete</button></div></div>'
      }).join(''):'<div class="empty">No models registered yet. Add one below.</div>';
      root.querySelector('[data-model-loading]').textContent='Database-backed registry; runtime configuration updates immediately.';
    }catch(e){root.querySelector('[data-model-loading]').textContent='Unable to load model registry: '+e.message}
  }
  function selectedRoles(){return [...document.querySelectorAll('#wbModelRoles input:checked')].map(i=>i.value)}
  async function addModel(){
    const modelId=document.getElementById('wbNewModelId').value.trim();
    const name=document.getElementById('wbNewModelName').value.trim();
    const priority=Number(document.getElementById('wbNewModelPriority').value);
    if(!modelId){toast('Enter a model ID');return}
    try{
      const d=await api('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId,name,priority:Number.isFinite(priority)?priority:undefined,roles:selectedRoles(),capabilities:['generate']})});
      document.getElementById('wbNewModelId').value='';document.getElementById('wbNewModelName').value='';
      document.querySelectorAll('#wbModelRoles input').forEach(i=>i.checked=false);
      toast('✓ '+(d.message||'Model saved'));
      await loadModelRegistry();
    }catch(e){toast('Model save failed: '+e.message)}
  }
  document.addEventListener('click',async e=>{
    const t=e.target;
    if(t.matches('[data-model-test]')){try{const d=await api('/api/models/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:t.dataset.modelTest})});toast(d.ok?'✓ '+t.dataset.modelTest+' responded in '+d.latencyMs+'ms':'✕ '+(d.error||'Model test failed'))}catch(err){toast('Model test failed: '+err.message)}}
    if(t.matches('[data-model-toggle]')){try{await api('/api/models/'+encodeURIComponent(t.dataset.modelToggle),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:t.dataset.enabled!=='true'})});await loadModelRegistry();toast('Model state updated')}catch(err){toast('Update failed: '+err.message)}}
    if(t.matches('[data-model-delete]')){if(!confirm('Remove this model from the registry?'))return;try{await api('/api/models/'+encodeURIComponent(t.dataset.modelDelete),{method:'DELETE'});await loadModelRegistry();toast('Model removed')}catch(err){toast('Delete failed: '+err.message)}}
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const view=document.getElementById('view-models');if(!view||document.getElementById('wbModelManager'))return;
    const wrap=document.createElement('div');wrap.className='card wb-model-manager';wrap.id='wbModelManager';wrap.innerHTML='<div class="section-head"><div><div class="section-title">Model Registry & Runtime Configuration <span class="pill" id="wbModelCount">0</span></div><div class="section-note" data-model-loading>Loading database-backed model registry…</div></div><button class="btn" onclick="window.__wbLoadModels()">Refresh</button></div><div class="notice">Register a model once, assign role(s), test its live availability, and enable/disable it. The backend persists the registry and hot-syncs the active Gemini routing environment.</div><div id="wbModelList" class="stack" style="margin-top:10px"></div><div style="border-top:1px solid var(--line);margin-top:13px;padding-top:13px"><div class="section-title">Add model</div><div class="wb-model-form"><input id="wbNewModelId" class="input" placeholder="Model ID"/><input id="wbNewModelName" class="input" placeholder="Display name"/><input id="wbNewModelPriority" class="input" type="number" min="0" placeholder="Priority"/><button id="wbAddModelBtn" class="btn primary">Add & Save</button></div><div class="wb-role-grid" id="wbModelRoles" style="margin-top:9px">'+['primary','fast','reasoning','extraction','embedding'].map(r=>'<label class="wb-role"><input type="checkbox" value="'+r+'"> '+r+'</label>').join('')+'</div><div class="wb-help">Role assignment influences adaptive routing. Embedding models are excluded from generative fallback candidates.</div></div>';
    view.appendChild(wrap);document.getElementById('wbAddModelBtn').onclick=addModel;window.__wbLoadModels=loadModelRegistry;loadModelRegistry();
  });
})();
</script>`;
}
