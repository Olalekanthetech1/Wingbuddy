export function renderDashboardModelControls(): string {
  return String.raw`
<style>
.wb-model-manager{margin-top:14px}.wb-model-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.wb-model-form{display:grid;grid-template-columns:1fr 1.6fr 1fr 110px auto;gap:8px;margin-top:10px}.wb-model-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.wb-model-card{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--panel)}.wb-model-card.preferred-legacy{border-color:var(--muted)}.wb-model-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.wb-help{margin-top:8px;font-size:12px;color:var(--muted)}.wb-editing{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue) inset}.wb-catalog-meta{margin-top:7px;min-height:18px;font-size:11px;color:var(--muted)}.wb-refresh-row{display:flex;gap:6px;align-items:center}.wb-provider-note{font-size:11px;color:var(--muted)}@media(max-width:900px){.wb-model-form{grid-template-columns:1fr 1fr}.wb-model-form .wb-model-actions{grid-column:1/-1;justify-content:flex-start}}@media(max-width:600px){.wb-model-form{grid-template-columns:1fr}.wb-model-card{grid-template-columns:1fr}.wb-model-actions{justify-content:flex-start}}
</style>
<script>
(function(){
  let editingId=null; let cachedModels=[]; let providerRecords=[]; let catalogCache=new Map();
  function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.style.display='block';clearTimeout(window.__wbModelToast);window.__wbModelToast=setTimeout(()=>el.style.display='none',4200)}
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
  function currentProvider(){return document.getElementById('wbNewModelProvider').value}
  function selectedCatalogModel(){const id=document.getElementById('wbNewModelId').value;return (catalogCache.get(currentProvider())||[]).find(m=>m.modelId===id)}
  function setForm(model){
    const provider=model?.provider||providerRecords.find(p=>p.enabled)?.id||providerRecords[0]?.id||'gemini';
    document.getElementById('wbNewModelProvider').value=provider;
    populateModelSelect(provider,model?.modelId||'');
    document.getElementById('wbNewModelName').value=model?.name||'';
    document.getElementById('wbNewModelPriority').value=Number.isFinite(model?.priority)?model.priority:'';
    updateCatalogMeta();
    const title=document.getElementById('wbModelFormTitle');const button=document.getElementById('wbAddModelBtn');const cancel=document.getElementById('wbCancelEditBtn');
    if(editingId){title.textContent='Edit model';button.textContent='Save changes';cancel.style.display='inline-flex';document.getElementById('wbModelEditor').classList.add('wb-editing')}
    else{title.textContent='Register model';button.textContent='Register & Save';cancel.style.display='none';document.getElementById('wbModelEditor').classList.remove('wb-editing')}
  }
  function populateProviderSelect(){const select=document.getElementById('wbNewModelProvider');const previous=select.value;select.innerHTML=providerRecords.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name||p.id)+(p.enabled?'':' · Disabled')+'</option>').join('');if(previous&&providerRecords.some(p=>p.id===previous))select.value=previous;else if(providerRecords[0])select.value=providerRecords[0].id;updateProviderNote()}
  function updateProviderNote(){const p=providerRecords.find(x=>x.id===currentProvider());const el=document.getElementById('wbProviderNote');if(!el)return;el.textContent=p?(p.configured?'Connected · live model catalog available':p.enabled?'Provider enabled · add a key to load its live catalog':'Provider disabled · enable it in Providers or add a valid key to discover models'):''}
  function populateModelSelect(provider,selectedId){
    const select=document.getElementById('wbNewModelId');const models=catalogCache.get(provider)||[];const currentId=selectedId||select.value;
    let options=models.map(m=>'<option value="'+esc(m.modelId)+'" data-name="'+esc(m.name)+'" data-capabilities="'+esc((m.capabilities||[]).join(', '))+'">'+esc(m.name||m.modelId)+' · '+esc(m.modelId)+'</option>').join('');
    if(currentId&&!models.some(m=>m.modelId===currentId))options='<option value="'+esc(currentId)+'">Current registered model · '+esc(currentId)+'</option>'+options;
    select.innerHTML=options||'<option value="">No live models available</option>';
    if(currentId)select.value=currentId;
    updateCatalogMeta();
  }
  function updateCatalogMeta(){const model=selectedCatalogModel();const meta=document.getElementById('wbCatalogMeta');if(!meta)return;if(!model){meta.textContent='Select a model from the live provider catalog.';return}const caps=(model.capabilities||[]).join(', ');meta.textContent='Live catalog · '+(model.status||'active')+(model.contextWindow?' · context '+Number(model.contextWindow).toLocaleString():'')+(caps?' · '+caps:'')}
  async function loadProviders(){const d=await api('/api/providers');providerRecords=d.providers||[];populateProviderSelect()}
  async function loadCatalog(provider,force=false){
    const status=document.getElementById('wbCatalogStatus');if(status)status.textContent='Loading live catalog…';
    try{const d=await api('/api/models/catalog/'+encodeURIComponent(provider)+(force?'?refresh=true':''));catalogCache.set(provider,d.models||[]);populateModelSelect(provider,document.getElementById('wbNewModelId').value);if(status)status.textContent=(d.models||[]).length+' current models available from '+provider;return d.models||[]}
    catch(e){catalogCache.set(provider,[]);populateModelSelect(provider,document.getElementById('wbNewModelId').value);if(status)status.textContent='Catalog unavailable: '+e.message;return []}
  }
  async function loadModelRegistry() {
    const root = document.getElementById('wbModelManager');
    if (!root) return;
    root.querySelector('[data-model-loading]').textContent = 'Refreshing registry…';
    try {
      const d = await api('/api/models');
      cachedModels = d.models || [];
      document.getElementById('wbModelCount').textContent = cachedModels.length;
      
      const chatModels = [];
      const imageModels = [];
      const videoModels = [];
      const embedModels = [];

      cachedModels.forEach(m => {
        const caps = m.capabilities || [];
        const id = (m.modelId || '').toLowerCase();
        
        const isImage = caps.includes("image_generation") || id.includes("flux") || id.includes("image") || id.includes("stable-diffusion") || id.includes("sdxl");
        const isVideo = caps.includes("video_generation") || id.includes("wan") || id.includes("video") || id.includes("sora") || id.includes("kling");
        
        if (isImage) imageModels.push(m);
        else if (isVideo) videoModels.push(m);
        else if (caps.includes("embedding") || (m.roles || []).includes("embedding") || (m.roles || []).includes("primary_embedding") || id.includes("embed")) embedModels.push(m);
        else chatModels.push(m);
      });

      const renderCard = (m, categoryPrimaryRole, activePrimaryId) => {
        const roles = (m.roles || []).filter(r => !r.startsWith('primary')).map(r => '<span class="pill">' + esc(r) + '</span>').join('');
        const enabled = m.enabled !== false;
        const isPrimary = activePrimaryId ? (m.id === activePrimaryId) : ((m.roles || []).includes(categoryPrimaryRole) || (categoryPrimaryRole === 'primary_chat' && (m.roles || []).includes('primary')));
        const caps = (m.capabilities || []).map(c => '<span class="pill">' + esc(c) + '</span>').join('');
        
        return '<div class="wb-model-card ' + (isPrimary ? 'preferred-legacy' : '') + '"><div><strong>' + esc(m.name) + '</strong>' + (isPrimary ? ' <span class="pill good">Primary</span>' : '') + '<div class="mono" style="font-size:12px;color:var(--blue);margin-top:3px">' + esc(m.provider) + ' / ' + esc(m.modelId) + '</div><div class="wb-model-meta">' + roles + '<span class="pill ' + (enabled ? 'good' : 'bad') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span><span class="pill">Priority ' + esc(m.priority) + '</span>' + caps + '</div></div><div class="wb-model-actions">' + (!isPrimary && enabled ? '<button class="btn primary" data-model-primary="' + esc(m.id) + '">Set as Primary</button>' : '') + '<button class="btn" data-model-edit="' + esc(m.id) + '">Edit</button><button class="btn" data-model-test="' + esc(m.id) + '">Test</button><button class="btn" data-model-toggle="' + esc(m.id) + '" data-enabled="' + enabled + '">' + (enabled ? 'Disable' : 'Enable') + '</button><button class="btn danger" data-model-delete="' + esc(m.id) + '">Delete</button></div></div>';
      };

      
      window.__wbActiveTab = window.__wbActiveTab || 'chat';
      window.__wbSwitchTab = (tab) => {
        window.__wbActiveTab = tab;
        loadModelRegistry();
      };

      const renderTabContent = (models, primaryRole) => {
        if (!models.length) return '<div class="empty" style="margin-top:16px;">No models registered in this category.</div>';
        let primaryId = null;
        const explicitPrimary = models.find(m => m.enabled !== false && ((m.roles || []).includes(primaryRole) || (primaryRole === 'primary_chat' && (m.roles || []).includes('primary'))));
        if (explicitPrimary) {
          primaryId = explicitPrimary.id;
        } else {
          const firstEnabled = models.find(m => m.enabled !== false);
          if (firstEnabled) primaryId = firstEnabled.id;
        }
        return '<div class="stack" style="margin-top:16px">' + models.map(m => renderCard(m, primaryRole, primaryId)).join('') + '</div>';
      };

      
      const list = document.getElementById('wbModelList');
      if (!cachedModels.length) {
        list.innerHTML = '<div class="empty">No models registered yet. Use the live catalog below to register one.</div>';
      } else {
        const tabsHtml = '<div style="display:flex;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-top:16px;overflow-x:auto;">' +
             '<button class="btn ' + (window.__wbActiveTab === 'chat' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\'chat\')">🗣️ Chat & Reasoning <span class="pill">' + chatModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'image' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\'image\')">🎨 Image Generation <span class="pill">' + imageModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'video' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\'video\')">🎬 Video Generation <span class="pill">' + videoModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'embedding' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\'embedding\')">🧠 Embedding <span class="pill">' + embedModels.length + '</span></button>' +
          '</div>';
        
        let contentHtml = '';
        if (window.__wbActiveTab === 'chat') contentHtml = renderTabContent(chatModels, 'primary_chat');
        else if (window.__wbActiveTab === 'image') contentHtml = renderTabContent(imageModels, 'primary_image');
        else if (window.__wbActiveTab === 'video') contentHtml = renderTabContent(videoModels, 'primary_video');
        else if (window.__wbActiveTab === 'embedding') contentHtml = renderTabContent(embedModels, 'primary_embedding');

        list.innerHTML = tabsHtml + contentHtml;
      }

      root.querySelector('[data-model-loading]').textContent = 'PostgreSQL-backed registry. Model IDs are discovered from provider APIs, not hard-coded.';
    } catch(e) {
      root.querySelector('[data-model-loading]').textContent = 'Unable to load model registry: ' + e.message;
    }
  }
  async function setPrimary(id, btn){
    const model=cachedModels.find(m=>m.id===id);if(!model)return;
    if(model.enabled===false){toast('Enable the model before making it primary',true);return}
    if(btn){
      btn.disabled=true;
      btn.textContent='Setting…';
    }
    toast('Setting '+(model.name||model.modelId)+' as primary…');
    try{
      const d=await api('/api/models/'+encodeURIComponent(id)+'/primary',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      toast('✓ '+(d.message||'Primary model updated'));
      await loadModelRegistry();
      if(typeof window.loadRuntimeConfig==='function') await window.loadRuntimeConfig();
    }catch(e){
      toast('Primary model update failed: '+e.message,true);
      if(btn){
        btn.disabled=false;
        btn.textContent='Set as Primary';
      }
    }
  }
  async function saveModel(){
    const provider=currentProvider();const modelId=document.getElementById('wbNewModelId').value.trim();const name=document.getElementById('wbNewModelName').value.trim();const priority=Number(document.getElementById('wbNewModelPriority').value);
    if(!provider){toast('Select a provider');return}if(!modelId){toast('Select a model from the live catalog');return}
    const selected=selectedCatalogModel();if(!selected){toast('That model is not present in the current provider catalog');return}
    if(editingId){try{await api('/api/models/'+encodeURIComponent(editingId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,modelId,name,priority:Number.isFinite(priority)?priority:undefined})});toast('✓ Model updated and saved to PostgreSQL');editingId=null;setForm(null);await loadModelRegistry()}catch(e){toast('Model update failed: '+e.message)}return}
    try{const d=await api('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,modelId,name,priority:Number.isFinite(priority)?priority:undefined,capabilities:selected.capabilities})});setForm(null);toast('✓ '+(d.message||'Model registered'));await loadModelRegistry()}catch(e){toast('Model registration failed: '+e.message)}
  }
  async function beginEdit(id){const model=cachedModels.find(m=>m.id===id);if(!model)return;editingId=id;setForm(model);document.getElementById('wbModelEditor').scrollIntoView({behavior:'smooth',block:'nearest'});await loadCatalog(model.provider,false)}
  function cancelEdit(){editingId=null;setForm(null)}
  document.addEventListener('click',async e=>{
    const t=e.target;if(!(t instanceof Element))return;
    const primaryBtn = t.closest('[data-model-primary]');
    if(primaryBtn){
      const id = primaryBtn.getAttribute('data-model-primary');
      if(id) await setPrimary(id, primaryBtn);
      return;
    }
    const editBtn = t.closest('[data-model-edit]');
    if(editBtn){
      beginEdit(editBtn.getAttribute('data-model-edit'));
      return;
    }
    const testBtn = t.closest('[data-model-test]');
    if(testBtn){
      const id = testBtn.getAttribute('data-model-test');
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      try{
        const d=await api('/api/models/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
        toast(d.ok?'✓ Model responded in '+d.latencyMs+'ms':'✕ '+(d.error||'Model test failed'), !d.ok);
      }catch(err){
        toast('Model test failed: '+err.message, true);
      }finally{
        testBtn.disabled = false;
        testBtn.textContent = 'Test';
      }
      return;
    }
    const toggleBtn = t.closest('[data-model-toggle]');
    if(toggleBtn){
      const id = toggleBtn.getAttribute('data-model-toggle');
      const isEnabled = toggleBtn.getAttribute('data-enabled')==='true';
      toggleBtn.disabled = true;
      try{
        await api('/api/models/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!isEnabled})});
        await loadModelRegistry();
        if(typeof window.loadRuntimeConfig==='function') await window.loadRuntimeConfig();
        toast('Model state updated');
      }catch(err){
        toast('Update failed: '+err.message, true);
      }finally{
        toggleBtn.disabled = false;
      }
      return;
    }
    const deleteBtn = t.closest('[data-model-delete]');
    if(deleteBtn){
      const id = deleteBtn.getAttribute('data-model-delete');
      deleteBtn.disabled = true;
      try{
        await api('/api/models/'+encodeURIComponent(id),{method:'DELETE'});
        await loadModelRegistry();
        if(typeof window.loadRuntimeConfig==='function') await window.loadRuntimeConfig();
        toast('Model removed');
      }catch(err){
        toast('Delete failed: '+err.message, true);
        deleteBtn.disabled = false;
      }
      return;
    }
    if(t.closest('[data-model-refresh]')){
      await loadCatalog(currentProvider(),true);
      return;
    }
  });
  function initModelManager(){
    const view=document.getElementById('view-models');if(!view||document.getElementById('wbModelManager'))return;const wrap=document.createElement('div');wrap.className='card wb-model-manager';wrap.id='wbModelManager';
    wrap.innerHTML='<div class="wb-model-toolbar"><div><div class="section-title">Adaptive Model Registry <span class="pill" id="wbModelCount">0</span></div><div class="section-note" data-model-loading>Loading PostgreSQL registry…</div></div><div class="wb-refresh-row"><button class="btn" onclick="window.__wbLoadModels()">Refresh registry</button></div></div><div class="notice">Live provider catalogs supply model IDs and capability metadata. Routing choices are autonomous.</div><div id="wbModelList" class="stack" style="margin-top:10px"></div><div id="wbModelEditor" style="border-top:1px solid var(--line);margin-top:13px;padding-top:13px"><div class="section-title" id="wbModelFormTitle">Register model</div><div class="wb-model-form"><select id="wbNewModelProvider" class="input"></select><select id="wbNewModelId" class="input"></select><input id="wbNewModelName" class="input" placeholder="Display name (optional)"/><input id="wbNewModelPriority" class="input" type="number" min="0" placeholder="Priority"/><div class="wb-model-actions"><button id="wbAddModelBtn" class="btn primary">Register & Save</button><button id="wbCancelEditBtn" class="btn" style="display:none">Cancel</button></div></div><div class="wb-provider-note" id="wbProviderNote" style="margin-top:6px"></div><div class="wb-catalog-meta" id="wbCatalogMeta"></div><div style="display:flex;gap:8px;align-items:center;margin-top:5px"><span class="wb-provider-note" id="wbCatalogStatus">Select a provider to load its live model catalog.</span><button class="btn" data-model-refresh="true" type="button">Refresh catalog</button></div></div>';
    view.appendChild(wrap);
    document.getElementById('wbNewModelProvider').onchange=async()=>{updateProviderNote();await loadCatalog(currentProvider(),true)};
    document.getElementById('wbNewModelId').onchange=()=>{updateCatalogMeta()};
    document.getElementById('wbAddModelBtn').onclick=saveModel;
    document.getElementById('wbCancelEditBtn').onclick=cancelEdit;
    window.__wbLoadModels=async()=>{await loadProviders();await loadModelRegistry();const p=currentProvider();if(p)await loadCatalog(p,false)};
    window.__wbLoadModels();
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initModelManager);
  }else{
    initModelManager();
  }
})();
</script>`;
}
