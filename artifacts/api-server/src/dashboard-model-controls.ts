export function renderDashboardModelControls(): string {
  return String.raw`
<style>
.wb-model-manager{margin-top:14px}.wb-model-form{display:grid;grid-template-columns:1.3fr 1fr 110px auto;gap:8px;margin-top:10px}.wb-role-grid{display:flex;flex-wrap:wrap;gap:6px}.wb-role{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--line);border-radius:999px;background:#0a1626;color:var(--muted);font-size:11px}.wb-role input{accent-color:#5aa7ff}.wb-model-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.wb-model-card{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#0a1626}.wb-model-card.primary{border-color:var(--blue)}.wb-model-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.wb-help{margin-top:8px;font-size:12px;color:var(--muted)}.wb-editing{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue) inset}@media(max-width:760px){.wb-model-form{grid-template-columns:1fr}.wb-model-card{grid-template-columns:1fr}.wb-model-actions{justify-content:flex-start}}
</style>
<script>
(function(){
  let editingId=null;
  let cachedModels=[];
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.style.display='block';clearTimeout(window.__wbModelToast);window.__wbModelToast=setTimeout(()=>el.style.display='none',4200)}
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
  function selectedRoles(){return [...document.querySelectorAll('#wbModelRoles input:checked')].map(i=>i.value)}
  function setForm(model){
    document.getElementById('wbNewModelId').value=model?.modelId||'';
    document.getElementById('wbNewModelName').value=model?.name||'';
    document.getElementById('wbNewModelPriority').value=Number.isFinite(model?.priority)?model.priority:'';
    document.querySelectorAll('#wbModelRoles input').forEach(i=>{i.checked=(model?.roles||[]).includes(i.value)});
    const title=document.getElementById('wbModelFormTitle');
    const button=document.getElementById('wbAddModelBtn');
    const cancel=document.getElementById('wbCancelEditBtn');
    if(editingId){title.textContent='Edit model';button.textContent='Save changes';cancel.style.display='inline-flex';document.getElementById('wbModelEditor').classList.add('wb-editing')}
    else{title.textContent='Add model';button.textContent='Add & Save';cancel.style.display='none';document.getElementById('wbModelEditor').classList.remove('wb-editing')}
  }
  async function loadModelRegistry(){
    const root=document.getElementById('wbModelManager');if(!root)return;
    root.querySelector('[data-model-loading]').textContent='Refreshing registry…';
    try{
      const d=await api('/api/models'); cachedModels=d.models||[];
      document.getElementById('wbModelCount').textContent=cachedModels.length;
      const list=document.getElementById('wbModelList');
      list.innerHTML=cachedModels.length?cachedModels.map(m=>{
        const roles=(m.roles||[]).map(r=>'<span class="pill">'+esc(r)+'</span>').join('');
        const enabled=m.enabled!==false; const primary=(m.roles||[]).includes('primary');
        const caps=(m.capabilities||[]).map(c=>'<span class="pill">'+esc(c)+'</span>').join('');
        return '<div class="wb-model-card '+(primary?'primary':'')+'"><div><strong>'+esc(m.name)+'</strong>'+ (primary?' <span class="pill good">Primary</span>':'') +'<div class="mono" style="font-size:12px;color:var(--blue);margin-top:3px">'+esc(m.modelId)+'</div><div class="wb-model-meta">'+roles+'<span class="pill '+(enabled?'good':'bad')+'">'+(enabled?'Enabled':'Disabled')+'</span><span class="pill">Priority '+esc(m.priority)+'</span>'+caps+'</div></div><div class="wb-model-actions">'+(!primary?'<button class="btn primary" data-model-primary="'+esc(m.id)+'">Set primary</button>':'')+'<button class="btn" data-model-edit="'+esc(m.id)+'">Edit</button><button class="btn" data-model-test="'+esc(m.modelId)+'">Test</button><button class="btn" data-model-toggle="'+esc(m.id)+'" data-enabled="'+enabled+'">'+(enabled?'Disable':'Enable')+'</button><button class="btn danger" data-model-delete="'+esc(m.id)+'">Delete</button></div></div>'
      }).join(''):'<div class="empty">No models registered yet. Add one below.</div>';
      root.querySelector('[data-model-loading]').textContent='PostgreSQL-backed registry; primary and role changes hot-reload the runtime.';
    }catch(e){root.querySelector('[data-model-loading]').textContent='Unable to load model registry: '+e.message}
  }
  async function saveModel(){
    const modelId=document.getElementById('wbNewModelId').value.trim();
    const name=document.getElementById('wbNewModelName').value.trim();
    const priority=Number(document.getElementById('wbNewModelPriority').value);
    const roles=selectedRoles();
    if(!modelId){toast('Enter a model ID');return}
    if(editingId){
      try{
        const current=cachedModels.find(m=>m.id===editingId);
        const wasPrimary=(current?.roles||[]).includes('primary');
        if(wasPrimary&&!roles.includes('primary')){toast('Choose another primary model before removing the primary role.');return}
        await api('/api/models/'+encodeURIComponent(editingId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId,name,priority:Number.isFinite(priority)?priority:undefined,roles})});
        toast('✓ Model updated and saved to PostgreSQL'); editingId=null; setForm(null); await loadModelRegistry();
      }catch(e){toast('Model update failed: '+e.message)}
      return;
    }
    try{
      const d=await api('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId,name,priority:Number.isFinite(priority)?priority:undefined,roles,capabilities:['generate']})});
      setForm(null); toast('✓ '+(d.message||'Model saved')); await loadModelRegistry();
    }catch(e){toast('Model save failed: '+e.message)}
  }
  function beginEdit(id){
    const model=cachedModels.find(m=>m.id===id); if(!model)return;
    editingId=id; setForm(model); document.getElementById('wbModelEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function cancelEdit(){editingId=null;setForm(null)}
  async function setPrimary(id){
    try{const d=await api('/api/models/'+encodeURIComponent(id)+'/primary',{method:'POST'});toast('✓ '+(d.message||'Primary model updated'));await loadModelRegistry()}catch(e){toast('Primary model update failed: '+e.message)}
  }
  document.addEventListener('click',async e=>{
    const t=e.target; if(!(t instanceof Element))return;
    if(t.matches('[data-model-edit]')) beginEdit(t.dataset.modelEdit);
    if(t.matches('[data-model-primary]')) setPrimary(t.dataset.modelPrimary);
    if(t.matches('[data-model-test]')){try{const d=await api('/api/models/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:t.dataset.modelTest})});toast(d.ok?'✓ '+t.dataset.modelTest+' responded in '+d.latencyMs+'ms':'✕ '+(d.error||'Model test failed'))}catch(err){toast('Model test failed: '+err.message)}}
    if(t.matches('[data-model-toggle]')){try{await api('/api/models/'+encodeURIComponent(t.dataset.modelToggle),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:t.dataset.enabled!=='true'})});await loadModelRegistry();toast('Model state updated')}catch(err){toast('Update failed: '+err.message)}}
    if(t.matches('[data-model-delete]')){if(!confirm('Remove this model from the registry?'))return;try{await api('/api/models/'+encodeURIComponent(t.dataset.modelDelete),{method:'DELETE'});await loadModelRegistry();toast('Model removed')}catch(err){toast('Delete failed: '+err.message)}}
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const view=document.getElementById('view-models');if(!view||document.getElementById('wbModelManager'))return;
    const wrap=document.createElement('div');wrap.className='card wb-model-manager';wrap.id='wbModelManager';wrap.innerHTML='<div class="section-head"><div><div class="section-title">Model Registry & Runtime Configuration <span class="pill" id="wbModelCount">0</span></div><div class="section-note" data-model-loading>Loading database-backed model registry…</div></div><button class="btn" onclick="window.__wbLoadModels()">Refresh</button></div><div class="notice">The database registry is authoritative. Add, edit, test, enable/disable, or make any enabled model primary. Changes are persisted to PostgreSQL and hot-reloaded into the runtime.</div><div id="wbModelList" class="stack" style="margin-top:10px"></div><div id="wbModelEditor" style="border-top:1px solid var(--line);margin-top:13px;padding-top:13px"><div class="section-title" id="wbModelFormTitle">Add model</div><div class="wb-model-form"><input id="wbNewModelId" class="input" placeholder="Model ID"/><input id="wbNewModelName" class="input" placeholder="Display name"/><input id="wbNewModelPriority" class="input" type="number" min="0" placeholder="Priority"/><div class="wb-model-actions"><button id="wbAddModelBtn" class="btn primary">Add & Save</button><button id="wbCancelEditBtn" class="btn" style="display:none">Cancel</button></div></div><div class="wb-role-grid" id="wbModelRoles" style="margin-top:9px">'+['primary','fast','reasoning','extraction','embedding'].map(r=>'<label class="wb-role"><input type="checkbox" value="'+r+'"> '+r+'</label>').join('')+'</div><div class="wb-help">Only enabled models can be primary. Assigning primary automatically removes the primary role from every other model. Embedding-role models are excluded from generative fallback candidates.</div></div>';
    view.appendChild(wrap);document.getElementById('wbAddModelBtn').onclick=saveModel;document.getElementById('wbCancelEditBtn').onclick=cancelEdit;window.__wbLoadModels=loadModelRegistry;loadModelRegistry();
  });
})();
</script>`;
}
