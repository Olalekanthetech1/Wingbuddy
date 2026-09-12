export function renderDashboardThemeLayer(): string {
  return String.raw`
<style id="wb-dashboard-theme-layer">
  /* Single semantic token bridge. All Dashboard components consume these tokens instead of
     owning light/dark presentation values. System mode follows the browser/OS preference. */
  :root{
    --bg:var(--wb-bg);
    --panel:var(--wb-panel);
    --panel-2:var(--wb-panel-2);
    --panel-3:var(--wb-panel-3);
    --line:var(--wb-line);
    --text:var(--wb-text);
    --muted:var(--wb-muted);
    --blue:var(--wb-blue);
    --green:var(--wb-green);
    --amber:var(--wb-amber);
    --red:var(--wb-red);
    --shadow:var(--wb-shadow);
    --nav-active:var(--wb-nav-active);
    --table-line:var(--wb-table-line);
    --primary:var(--wb-primary);
    --success:var(--wb-success);
    --warning:var(--wb-warning);
    --danger:var(--wb-danger);
    --danger-bg:var(--wb-danger-bg);
    --danger-border:var(--wb-danger-border);
    --on-primary:var(--wb-on-primary);
  }

  html{
    color:var(--wb-text);
    background:var(--wb-bg);
  }

  /* Semantic states stay readable in either palette. These are tokens, not component-level colors. */
  html[data-wb-theme="dark"],
  :root{
    --wb-blue:var(--wb-blue-base,#5aa7ff);
    --wb-green:var(--wb-green-base,#37d39a);
    --wb-amber:var(--wb-amber-base,#f5b74f);
    --wb-red:var(--wb-red-base,#ff6675);
    --wb-primary:var(--wb-primary-base,#2563eb);
    --wb-success:var(--wb-success-base,#37d39a);
    --wb-warning:var(--wb-warning-base,#f5b74f);
    --wb-danger:var(--wb-danger-base,#fecaca);
    --wb-danger-bg:var(--wb-danger-bg-base,rgba(255,102,117,.10));
    --wb-danger-border:var(--wb-danger-border-base,rgba(255,102,117,.30));
    --wb-on-primary:#fff;
  }

  html[data-wb-theme="light"]{
    --wb-blue:#2563eb;
    --wb-green:#13795b;
    --wb-amber:#8a5a00;
    --wb-red:#b42332;
    --wb-primary:#2563eb;
    --wb-success:#13795b;
    --wb-warning:#8a5a00;
    --wb-danger:#b42332;
    --wb-danger-bg:rgba(180,35,50,.08);
    --wb-danger-border:rgba(180,35,50,.24);
    --wb-on-primary:#fff;
  }

  html[data-wb-theme="dark"]{
    --wb-blue:#5aa7ff;
    --wb-green:#37d39a;
    --wb-amber:#f5b74f;
    --wb-red:#ff6675;
    --wb-primary:#2563eb;
    --wb-success:#37d39a;
    --wb-warning:#f5b74f;
    --wb-danger:#fecaca;
    --wb-danger-bg:#2a0d12;
    --wb-danger-border:#7f1d1d;
    --wb-on-primary:#fff;
  }

  @media (prefers-color-scheme:light){
    html:not([data-wb-theme="dark"]){
      --wb-blue:#2563eb;
      --wb-green:#13795b;
      --wb-amber:#8a5a00;
      --wb-red:#b42332;
      --wb-primary:#2563eb;
      --wb-success:#13795b;
      --wb-warning:#8a5a00;
      --wb-danger:#b42332;
      --wb-danger-bg:rgba(180,35,50,.08);
      --wb-danger-border:rgba(180,35,50,.24);
      --wb-on-primary:#fff;
    }
  }

  .btn.primary{background:var(--primary)!important;color:var(--on-primary)!important;border-color:var(--primary)!important}
  .btn.danger{background:var(--danger-bg)!important;color:var(--danger)!important;border-color:var(--danger-border)!important}
  .sim-panel,.sim-card,.sim-kv,.sim-run,.sim-tab,.sim-result,.sim-input,.sim-select,.sim-textarea,
  .wb-model-card,.wb-role,.wb-cp-stat,.wb-key-card,.wb-pk-card,.wb-pk-item,.wb-air-stat-card,.wb-air-provider-card,.wb-media-asset,
  .wb-dag-suite,.wb-node-card,.wb-inspector-card,.wb-explain-item,.wb-code-block,.wb-dag-canvas-card,.persona-card,
  .side,.mobile-nav,.nav button,.mobile-nav button{transition:background-color .18s ease,color .18s ease,border-color .18s ease}
</style>
<script>
(function(){
  function updateThemeMeta(){
    var light=window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches;
    var forced=document.documentElement.getAttribute('data-wb-theme');
    var resolved=forced==='light'||(!forced&&light)?'light':'dark';
    var meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue('--wb-bg').trim());
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
