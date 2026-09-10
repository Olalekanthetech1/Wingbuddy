export function renderDashboardThemeLayer(): string {
  return String.raw`
<style id="wb-dashboard-theme-layer">
  /* Final dashboard theme layer. This exists because several control-plane panels are injected
     independently and contain inline presentation styles. Theme selection remains data-driven
     through the existing html[data-wb-theme] state from dashboard-responsive.ts. */
  #ai-routing-control-plane,
  #provider-key-control-plane {
    color:var(--wb-text) !important;
    background:var(--wb-panel) !important;
    border-color:var(--wb-line) !important;
  }

  #ai-routing-control-plane h2,
  #ai-routing-control-plane h3,
  #provider-key-control-plane h2,
  #provider-key-control-plane h3,
  #ai-routing-control-plane strong,
  #provider-key-control-plane strong,
  #ai-routing-control-plane b,
  #provider-key-control-plane b {
    color:var(--wb-text) !important;
  }

  #ai-routing-control-plane p,
  #ai-routing-control-plane label,
  #ai-routing-control-plane th,
  #ai-routing-control-plane td,
  #provider-key-control-plane p,
  #provider-key-control-plane label,
  #provider-key-control-plane th,
  #provider-key-control-plane td,
  #provider-key-control-plane span,
  #ai-routing-control-plane span {
    color:var(--wb-muted) !important;
  }

  #ai-routing-control-plane > div,
  #provider-key-control-plane > div {
    border-color:var(--wb-line) !important;
  }

  #ai-routing-control-plane table,
  #provider-key-control-plane table {
    color:var(--wb-text) !important;
  }

  #ai-routing-control-plane input,
  #ai-routing-control-plane select,
  #ai-routing-control-plane button,
  #provider-key-control-plane input,
  #provider-key-control-plane select,
  #provider-key-control-plane button {
    background:var(--wb-panel-3) !important;
    color:var(--wb-text) !important;
    border-color:var(--wb-line) !important;
  }

  #ai-routing-control-plane input::placeholder,
  #provider-key-control-plane input::placeholder {
    color:var(--wb-muted) !important;
  }

  #ai-routing-control-plane button:hover,
  #provider-key-control-plane button:hover {
    background:var(--wb-nav-active) !important;
    border-color:var(--wb-line-strong) !important;
  }

  #ai-routing-control-plane [id="air-save-policy"],
  #ai-routing-control-plane [id="air-add-model"],
  #provider-key-control-plane [id="pk-mode-save"] {
    background:var(--wb-primary,#2563eb) !important;
    color:#fff !important;
    border-color:var(--wb-primary,#2563eb) !important;
  }

  #ai-routing-control-plane [id="air-reset-health"] {
    background:var(--wb-danger-bg,rgba(255,102,117,.10)) !important;
    color:var(--wb-danger, #ff9aa4) !important;
    border-color:var(--wb-danger-border,rgba(255,102,117,.30)) !important;
  }

  #ai-routing-control-plane .air-toggle,
  #ai-routing-control-plane .air-model-toggle,
  #ai-routing-control-plane .air-reset-model,
  #provider-key-control-plane [data-pk-toggle],
  #provider-key-control-plane [data-pk-discover] {
    background:var(--wb-panel-3) !important;
    color:var(--wb-text) !important;
    border-color:var(--wb-line) !important;
  }

  #ai-routing-control-plane [style*="background:#0b1220"],
  #ai-routing-control-plane [style*="background:#0f172a"],
  #ai-routing-control-plane [style*="background:#111827"],
  #ai-routing-control-plane [style*="background:#0e2036"],
  #ai-routing-control-plane [style*="background:#0a1626"],
  #provider-key-control-plane [style*="background:#0b1220"],
  #provider-key-control-plane [style*="background:#0f172a"],
  #provider-key-control-plane [style*="background:#111827"],
  #provider-key-control-plane [style*="background:#0e2036"],
  #provider-key-control-plane [style*="background:#0a1626"] {
    background:var(--wb-panel-2) !important;
  }

  #ai-routing-control-plane [style*="border-color:#1e293b"],
  #ai-routing-control-plane [style*="border:1px solid #1e293b"],
  #ai-routing-control-plane [style*="border:1px solid #334155"],
  #provider-key-control-plane [style*="border:1px solid #1e293b"],
  #provider-key-control-plane [style*="border:1px solid #334155"] {
    border-color:var(--wb-line) !important;
  }

  #ai-routing-control-plane [style*="color:#e5e7eb"],
  #provider-key-control-plane [style*="color:#e5e7eb"] {
    color:var(--wb-text) !important;
  }

  #ai-routing-control-plane [style*="color:#94a3b8"],
  #provider-key-control-plane [style*="color:#94a3b8"] {
    color:var(--wb-muted) !important;
  }

  html[data-wb-theme="light"] {
    --wb-primary:#2563eb;
    --wb-danger:#b42332;
    --wb-danger-bg:rgba(180,35,50,.08);
    --wb-danger-border:rgba(180,35,50,.24);
  }

  html[data-wb-theme="dark"] {
    --wb-primary:#2563eb;
    --wb-danger:#fecaca;
    --wb-danger-bg:#2a0d12;
    --wb-danger-border:#7f1d1d;
  }

  @media (prefers-color-scheme:light) {
    html:not([data-wb-theme="dark"]) {
      --wb-primary:#2563eb;
      --wb-danger:#b42332;
      --wb-danger-bg:rgba(180,35,50,.08);
      --wb-danger-border:rgba(180,35,50,.24);
    }
  }
</style>
<script>
(function(){
  function updateThemeMeta(){
    var light=window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches;
    var root=document.documentElement;
    var forced=root.getAttribute('data-wb-theme');
    var resolved=forced==='light'||(!forced&&light)?'light':'dark';
    var meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',resolved==='light'?'#f4f7fb':'#07111f');
  }
  function init(){updateThemeMeta();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  var observer=new MutationObserver(updateThemeMeta);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-wb-theme']});
  if(window.matchMedia){
    var media=window.matchMedia('(prefers-color-scheme:light)');
    var onChange=function(){if(!document.documentElement.hasAttribute('data-wb-theme'))updateThemeMeta()};
    if(media.addEventListener)media.addEventListener('change',onChange);else if(media.addListener)media.addListener(onChange);
  }
})();
</script>`;
}
