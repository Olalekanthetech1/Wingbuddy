export function renderDashboardBehaviorControls(): string {
  return String.raw`
<style id="wb-behavior-styles">
  #view-behavior{width:100%;min-width:0}
  #view-behavior .behavior-panel{display:grid;gap:14px}
  #view-behavior .behavior-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}
  #view-behavior .behavior-card{display:flex;flex-direction:column;gap:10px;min-height:180px}
  #view-behavior .behavior-card-main{flex:1;min-width:0}
  #view-behavior .behavior-card-actions{display:flex;gap:8px;flex-wrap:wrap}
  #view-behavior .behavior-card-actions .btn{flex:1 1 140px}
  #view-behavior .behavior-switcher{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #view-behavior .behavior-switcher .select{min-width:190px;width:auto}
  #view-behavior .behavior-editor{display:grid;gap:12px}
  #view-behavior .behavior-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  #view-behavior .behavior-field{display:grid;gap:6px;min-width:0}
  #view-behavior .behavior-field.full{grid-column:1/-1}
  #view-behavior .behavior-field label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
  #view-behavior textarea{width:100%;min-height:150px;resize:vertical}
  #view-behavior .behavior-json{min-height:230px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  #view-behavior .behavior-actions{display:flex;gap:8px;flex-wrap:wrap}
  #view-behavior .behavior-actions .btn{flex:1 1 160px}
  @media(max-width:760px){
    #view-behavior .behavior-editor-grid{grid-template-columns:1fr}
    #view-behavior .behavior-field.full{grid-column:auto}
    #view-behavior .behavior-switcher,.behavior-actions,#view-behavior .behavior-card-actions{display:grid;grid-template-columns:1fr;width:100%}
    #view-behavior .behavior-switcher .select,#view-behavior .behavior-actions .btn,#view-behavior .behavior-card-actions .btn{width:100%;min-width:0}
  }
</style>
<section class="view" id="view-behavior">
  <div class="behavior-panel">
    <div class="top">
      <div>
        <div class="eyebrow">Runtime Behavior Control Plane</div>
        <div class="title">🎭 AI Personality & Operating Mode</div>
        <p class="subtitle">Configure approved behavioral profiles without changing security, tool permissions, or execution policy.</p>
      </div>
    </div>
    <div class="card section">
      <div class="section-head">
        <div>
          <div class="section-title">Behavior Profiles</div>
          <div class="section-note" id="behaviorStatus">Loading…</div>
        </div>
        <div class="behavior-switcher">
          <label class="sr-only" for="behaviorKind">Profile type</label>
          <select id="behaviorKind" class="select" aria-label="Profile type"><option value="personality">Personality</option><option value="mode">Operating Mode</option></select>
          <button class="btn" id="behaviorRefresh">↻ Refresh</button>
        </div>
      </div>
      <div class="notice">Behavior settings are versioned and persisted by the backend. Safety-critical controls remain outside this editor.</div>
      <div id="behaviorList" class="behavior-list"></div>
    </div>
    <div class="card section" id="behaviorEditor" style="display:none">
      <div class="section-head"><div><div class="section-title">Configure <span id="behaviorEditorKey"></span></div><div class="section-note">Saved changes become the active server-side revision after validation.</div></div></div>
      <div class="behavior-editor">
        <div class="behavior-editor-grid">
          <div class="behavior-field"><label for="behaviorLabel">Display label</label><input id="behaviorLabel" class="input" placeholder="Display label" /></div>
          <div class="behavior-field"><label for="behaviorDescription">Description</label><input id="behaviorDescription" class="input" placeholder="Description" /></div>
          <div class="behavior-field full"><label for="behaviorInstruction">Behavior instruction</label><textarea id="behaviorInstruction" class="input" placeholder="Behavior instruction"></textarea></div>
          <div class="behavior-field full"><label for="behaviorJson">Advanced configuration</label><textarea id="behaviorJson" class="input behavior-json" spellcheck="false" placeholder="Advanced configuration JSON"></textarea></div>
        </div>
        <div class="behavior-actions"><button class="btn primary" id="behaviorSave">Save & Apply</button><button class="btn" id="behaviorDefault">Set as Default</button><button class="btn" id="behaviorCancel">Cancel</button></div>
      </div>
    </div>
  </div>
</section>
<script>
(function(){
  var profiles=[];var selected=null;
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function api(url,opts){var r=await fetch(url,opts);var d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.error||('Request failed ('+r.status+')'));return d}
  function toast(msg,bad){var e=document.getElementById('toast');if(!e)return;e.textContent=msg;e.style.display='block';e.style.borderColor=bad?'rgba(255,102,117,.4)':'#2a4665';clearTimeout(window.__wbBehaviorToast);window.__wbBehaviorToast=setTimeout(function(){e.style.display='none'},3500)}
  function currentKind(){return document.getElementById('behaviorKind').value}
  function parseCfg(p){try{return typeof p.config==='string'?JSON.parse(p.config):p.config||{}}catch(e){return {}}}
  async function load(){
    var status=document.getElementById('behaviorStatus');
    status.textContent='Loading '+currentKind()+' profiles…';
    try{var d=await api('/api/behaviors?kind='+encodeURIComponent(currentKind()));profiles=Array.isArray(d.profiles)?d.profiles:[];status.textContent='PostgreSQL-backed • '+profiles.length+' profiles • Default: '+((d.defaults&&d.defaults.key)||'—');render()}catch(e){profiles=[];document.getElementById('behaviorList').innerHTML='<div class="empty">Unable to load behavior profiles.</div>';status.textContent='Unavailable: '+e.message}}
  function render(){
    var list=document.getElementById('behaviorList');
    if(!profiles.length){list.innerHTML='<div class="empty">No behavior profiles are available.</div>';return}
    list.innerHTML=profiles.map(function(p){var cfg=parseCfg(p);var label=cfg.label||cfg.displayName||p.key;var desc=cfg.description||'';return '<div class="card behavior-card"><div class="behavior-card-main"><strong>'+esc(label)+'</strong> '+(p.isDefault?'<span class="pill good">Default</span>':'')+'<div class="section-note" style="margin-top:7px">'+esc(desc||'No description')+'</div><div class="section-note" style="margin-top:7px">Revision '+esc(p.version==null?'—':p.version)+'</div></div><div class="behavior-card-actions"><button class="btn" data-beh-edit="'+esc(p.key)+'">Configure</button>'+(p.isDefault?'':'<button class="btn" data-beh-default="'+esc(p.key)+'">Set default</button>')+'</div></div>'}).join('')
  }
  function openEditor(key){selected=profiles.find(function(p){return p.key===key});if(!selected)return;var cfg=parseCfg(selected);document.getElementById('behaviorEditorKey').textContent=selected.key;document.getElementById('behaviorLabel').value=cfg.label||cfg.displayName||selected.key;document.getElementById('behaviorDescription').value=cfg.description||'';document.getElementById('behaviorInstruction').value=cfg.instruction||cfg.systemBehavior||'';document.getElementById('behaviorJson').value=JSON.stringify(cfg,null,2);document.getElementById('behaviorEditor').style.display='block';document.getElementById('behaviorEditor').scrollIntoView({behavior:'smooth',block:'start'})}
  async function save(){
    if(!selected)return;
    var cfg;try{cfg=JSON.parse(document.getElementById('behaviorJson').value||'{}')}catch(e){toast('Invalid JSON configuration',true);return}
    cfg.label=document.getElementById('behaviorLabel').value.trim()||cfg.label||selected.key;cfg.description=document.getElementById('behaviorDescription').value.trim()||cfg.description||'';cfg.instruction=document.getElementById('behaviorInstruction').value;
    try{var d=await api('/api/behaviors/'+encodeURIComponent(currentKind())+'/'+encodeURIComponent(selected.key),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});toast('✓ Saved and applied (revision '+((d.profile&&d.profile.version)||'updated')+')');document.getElementById('behaviorEditor').style.display='none';await load()}catch(e){toast('Save failed: '+e.message,true)}
  }
  async function setDefault(key){try{await api('/api/behaviors/'+encodeURIComponent(currentKind())+'/'+encodeURIComponent(key)+'/default',{method:'POST'});toast('✓ Default persisted');document.getElementById('behaviorEditor').style.display='none';await load()}catch(e){toast('Default update failed: '+e.message,true)}}
  function ensureNav(){if(document.getElementById('behaviorNav'))return;var nav=document.getElementById('nav'),mobile=document.getElementById('mobileNav');if(!nav)return;var b=document.createElement('button');b.id='behaviorNav';b.type='button';b.textContent='🎭 Personality & Modes';b.onclick=showBehavior;nav.appendChild(b);if(mobile){var mb=document.createElement('button');mb.type='button';mb.textContent='🎭 Personality & Modes';mb.dataset.view='behavior';mb.onclick=showBehavior;mobile.appendChild(mb)}}
  function showBehavior(){document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});var view=document.getElementById('view-behavior');if(!view)return;view.classList.add('active');document.querySelectorAll('[data-view]').forEach(function(x){x.classList.toggle('active',x.dataset.view==='behavior')});load()}
  document.addEventListener('click',function(e){var t=e.target;if(t.matches('[data-beh-edit]'))openEditor(t.getAttribute('data-beh-edit'));else if(t.matches('[data-beh-default]'))setDefault(t.getAttribute('data-beh-default'));else if(t.id==='behaviorSave')save();else if(t.id==='behaviorDefault'&&selected)setDefault(selected.key);else if(t.id==='behaviorCancel')document.getElementById('behaviorEditor').style.display='none';else if(t.id==='behaviorRefresh')load()});
  document.addEventListener('change',function(e){if(e.target&&e.target.id==='behaviorKind')load()});
  function init(){ensureNav()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.showBehavior=showBehavior;
})();
</script>`;
}
