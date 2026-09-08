export function renderDashboardBehaviorControls(): string {
  return String.raw`
<section class="view" id="view-behavior">
  <div class="top"><div><div class="eyebrow">Runtime Behavior Control Plane</div><div class="title">🎭 AI Personality & Operating Mode</div><p class="subtitle">Edit approved behavioral profiles, persist changes in PostgreSQL, and apply them to the live runtime.</p></div></div>
  <div class="card section">
    <div class="section-head"><div><div class="section-title">Behavior Profiles</div><div class="section-note" id="behaviorStatus">Loading…</div></div><select id="behaviorKind" class="select" style="width:auto"><option value="personality">Personality</option><option value="mode">Operating Mode</option></select></div>
    <div class="notice">Behavior configuration is persisted server-side. Safety-critical capabilities, tool permissions, execution limits, and security policy remain backend-authoritative.</div>
    <div id="behaviorList" class="cards" style="margin-top:10px"></div>
  </div>
  <div class="card section" id="behaviorEditor" style="display:none">
    <div class="section-head"><div><div class="section-title">Configure <span id="behaviorEditorKey"></span></div><div class="section-note">Versioned server-side update</div></div></div>
    <div class="stack">
      <input id="behaviorLabel" class="input" placeholder="Display label" />
      <input id="behaviorDescription" class="input" placeholder="Description" />
      <textarea id="behaviorInstruction" class="input" style="min-height:150px" placeholder="Behavior instruction"></textarea>
      <textarea id="behaviorJson" class="input" style="min-height:220px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace" spellcheck="false" placeholder="Advanced configuration JSON"></textarea>
      <div class="toolbar"><button class="btn primary" id="behaviorSave">Save & Apply</button><button class="btn" id="behaviorDefault">Set as Default</button><button class="btn" id="behaviorCancel">Cancel</button></div>
    </div>
  </div>
</section>
<script>
(function(){
  var profiles=[]; var selected=null;
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function api(url,opts){var r=await fetch(url,opts);var d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.error||'Request failed');return d}
  function toast(msg){var e=document.getElementById('toast');if(!e)return;e.textContent=msg;e.style.display='block';clearTimeout(window.__wbBehaviorToast);window.__wbBehaviorToast=setTimeout(function(){e.style.display='none'},3500)}
  function currentKind(){return document.getElementById('behaviorKind').value}
  async function load(){var kind=currentKind();var d=await api('/api/behaviors?kind='+encodeURIComponent(kind));profiles=d.profiles||[];document.getElementById('behaviorStatus').textContent='PostgreSQL-backed • '+profiles.length+' '+kind+' profiles • Default: '+(d.defaults&&d.defaults.key||'—');render()}
  function render(){var list=document.getElementById('behaviorList');list.innerHTML=profiles.map(function(p){var cfg=typeof p.config==='string'?JSON.parse(p.config):p.config||{};var label=cfg.label||cfg.displayName||p.key;var desc=cfg.description||'';return '<div class="mini"><strong>'+esc(label)+(p.isDefault?' <span class="pill good">Default</span>':'')+'</strong><span>'+esc(desc)+'</span><div class="toolbar" style="margin-top:8px"><button class="btn" data-beh-edit="'+esc(p.key)+'">Configure</button>'+(p.isDefault?'':'<button class="btn" data-beh-default="'+esc(p.key)+'">Set default</button>')+'</div></div>'}).join('')||'<div class="empty">No behavior profiles available.</div>'}
  function openEditor(key){selected=profiles.find(function(p){return p.key===key});if(!selected)return;var cfg=typeof selected.config==='string'?JSON.parse(selected.config):selected.config||{};document.getElementById('behaviorEditorKey').textContent=selected.key;document.getElementById('behaviorLabel').value=cfg.label||cfg.displayName||selected.key;document.getElementById('behaviorDescription').value=cfg.description||'';document.getElementById('behaviorInstruction').value=cfg.instruction||cfg.systemBehavior||'';document.getElementById('behaviorJson').value=JSON.stringify(cfg,null,2);document.getElementById('behaviorEditor').style.display='block'}
  async function save(){if(!selected)return;var kind=currentKind();var cfg;try{cfg=JSON.parse(document.getElementById('behaviorJson').value||'{}')}catch(e){toast('Invalid JSON configuration');return}cfg.label=document.getElementById('behaviorLabel').value.trim()||cfg.label||selected.key;cfg.description=document.getElementById('behaviorDescription').value.trim()||cfg.description||'';if(kind==='personality')cfg.instruction=document.getElementById('behaviorInstruction').value;else{cfg.systemBehavior=document.getElementById('behaviorInstruction').value;cfg.instruction=document.getElementById('behaviorInstruction').value}try{var d=await api('/api/behaviors/'+encodeURIComponent(kind)+'/'+encodeURIComponent(selected.key),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});toast('✓ Saved and applied. Version '+(d.profile&&d.profile.version||'updated'));document.getElementById('behaviorEditor').style.display='none';await load()}catch(e){toast('Save failed: '+e.message)}}
  async function setDefault(key){var kind=currentKind();try{await api('/api/behaviors/'+encodeURIComponent(kind)+'/'+encodeURIComponent(key)+'/default',{method:'POST'});toast('✓ Default persisted');document.getElementById('behaviorEditor').style.display='none';await load()}catch(e){toast('Default update failed: '+e.message)}}
  document.addEventListener('click',function(e){var t=e.target;if(t.matches('[data-beh-edit]'))openEditor(t.getAttribute('data-beh-edit'));else if(t.matches('[data-beh-default]'))setDefault(t.getAttribute('data-beh-default'));else if(t.id==='behaviorSave')save();else if(t.id==='behaviorDefault'&&selected)setDefault(selected.key);else if(t.id==='behaviorCancel')document.getElementById('behaviorEditor').style.display='none'});
  document.addEventListener('DOMContentLoaded',function(){
    var main=document.querySelector('main');if(!main)return;
    if(!document.getElementById('behaviorNav')){var b=document.createElement('button');b.id='behaviorNav';b.type='button';b.textContent='🎭 Personality & Modes';b.onclick=function(){showBehavior()};var nav=document.getElementById('nav');var mobile=document.getElementById('mobileNav');if(nav)nav.appendChild(b);if(mobile){var mb=b.cloneNode(true);mb.removeAttribute('id');mb.onclick=function(){showBehavior()};mobile.appendChild(mb)}}
    window.showBehavior=function(){document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});document.getElementById('view-behavior').classList.add('active');load().catch(function(e){document.getElementById('behaviorStatus').textContent='Unable to load: '+e.message})};
    var refresh=document.querySelector('[onclick="refreshAll()"]'); if(refresh){};
  });
})();
</script>`;
}
