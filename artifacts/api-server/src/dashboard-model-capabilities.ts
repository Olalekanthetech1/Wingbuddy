export function renderDashboardModelCapabilities(): string {
  return String.raw`
<style id="wb-model-capabilities-layer">
  #wbModelCapabilities{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);color:var(--text)}
  #wbModelCapabilities[hidden]{display:none}
  #wbModelCapabilities .wb-capability-title{font-size:12px;font-weight:700;margin-bottom:6px}
  #wbModelCapabilities .wb-capability-list{display:flex;flex-wrap:wrap;gap:6px}
  #wbModelCapabilities .wb-capability{display:inline-flex;align-items:center;padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);font-size:11px}
  #wbModelCapabilities .wb-capability-empty{color:var(--muted);font-size:11px}
  #wbModelRoles[data-wb-role-state="dynamic"] .wb-role[data-wb-supported="false"]{opacity:.5}
  #wbModelRoles[data-wb-role-state="dynamic"] .wb-role[data-wb-supported="true"]{border-color:var(--line-strong)}
</style>
<script>
(function(){
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function getSelectedModel(){
    const select=document.getElementById('wbNewModelId');
    if(!select)return null;
    const option=select.options[select.selectedIndex];
    if(!option||!option.value)return null;
    const capabilities=(option.dataset.capabilities||'').split(',').map(v=>v.trim()).filter(Boolean);
    return {id:option.value,name:option.dataset.name||option.textContent||option.value,capabilities};
  }
  function render(){
    const roles=document.getElementById('wbModelRoles');
    if(!roles)return;
    let panel=document.getElementById('wbModelCapabilities');
    if(!panel){panel=document.createElement('div');panel.id='wbModelCapabilities';roles.parentElement?.insertBefore(panel,roles)}
    const model=getSelectedModel();
    if(!model){panel.hidden=true;roles.dataset.wbRoleState='dynamic';return}
    panel.hidden=false;
    const list=model.capabilities.length?model.capabilities.map(cap=>'<span class="wb-capability">'+esc(cap)+'</span>').join(''):'<span class="wb-capability-empty">The provider did not publish capability metadata for this model.</span>';
    panel.innerHTML='<div class="wb-capability-title">Detected capabilities for '+esc(model.name)+'</div><div class="wb-capability-list">'+list+'</div><div class="wb-capability-empty" style="margin-top:7px">Provider-reported capabilities are authoritative. Routing roles below remain adaptive administrative assignments.</div>';
    const reported=new Set(model.capabilities.map(v=>v.trim().toLowerCase()));
    roles.dataset.wbRoleState='dynamic';
    roles.querySelectorAll('.wb-role').forEach(label=>{
      const input=label.querySelector('input');
      const role=input?.value?.trim().toLowerCase()||'';
      const supported=reported.has(role);
      label.dataset.wbSupported=String(supported);
      label.title=supported?'This routing role is also explicitly reported by the provider.':'This model does not explicitly report this routing role; assigning it remains an admin routing decision.';
    });
  }
  function bind(){
    const select=document.getElementById('wbNewModelId');
    if(!select)return;
    if(select.dataset.wbCapabilityBound!=='1'){select.dataset.wbCapabilityBound='1';select.addEventListener('change',render)}
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
}
