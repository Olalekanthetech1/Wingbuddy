export function renderDashboardResponsiveLayer(): string {
  return String.raw`
<style id="wb-responsive-layer">
  /* Dashboard-wide fluid sizing. Components remain data-driven; this layer only controls presentation. */
  html{color-scheme:dark;overflow-x:hidden}
  body{overflow-x:hidden}
  .app{width:100%;min-width:0}
  main{width:100%;max-width:100%;min-width:0}
  .view,.card,.section,.split,.grid,.cards,.stack,.table-wrap{min-width:0}
  .card,.mini,.notice,.section{overflow-wrap:anywhere;word-break:break-word}
  .section-head,.toolbar{min-width:0}
  .section-head>*,.top>*,.toolbar>*{min-width:0}
  .table-wrap{-webkit-overflow-scrolling:touch}
  .table{min-width:720px}
  .input,.select,.btn{min-height:42px;max-width:100%}
  textarea.input{resize:vertical}

  /* Adaptive theme layer. Explicit user choice overrides system preference; "system" follows OS/browser. */
  :root{
    --wb-bg:#07111f;
    --wb-panel:#0d1a2b;
    --wb-panel-2:#0a1626;
    --wb-panel-3:#091524;
    --wb-line:#1b3049;
    --wb-line-strong:#31567e;
    --wb-text:#e8f0f8;
    --wb-muted:#8ea2b8;
    --wb-nav-active:#0e2036;
    --wb-table-line:#152a40;
    --wb-shadow:0 16px 40px rgba(0,0,0,.24);
    --wb-body-bg:radial-gradient(circle at top right,#0f2843 0,#07111f 42%,#040b14 100%);
  }
  html[data-wb-theme="light"]{
    color-scheme:light;
    --wb-bg:#f4f7fb;
    --wb-panel:#ffffff;
    --wb-panel-2:#f7f9fc;
    --wb-panel-3:#f0f4f8;
    --wb-line:#d8e1eb;
    --wb-line-strong:#a8b8ca;
    --wb-text:#122033;
    --wb-muted:#5f7186;
    --wb-nav-active:#e8f0f8;
    --wb-table-line:#e2e8f0;
    --wb-shadow:0 12px 32px rgba(33,54,79,.10);
    --wb-body-bg:radial-gradient(circle at top right,#e8f2ff 0,#f4f7fb 44%,#edf2f7 100%);
  }
  @media (prefers-color-scheme:light){
    html:not([data-wb-theme="dark"]){
      color-scheme:light;
      --wb-bg:#f4f7fb;
      --wb-panel:#ffffff;
      --wb-panel-2:#f7f9fc;
      --wb-panel-3:#f0f4f8;
      --wb-line:#d8e1eb;
      --wb-line-strong:#a8b8ca;
      --wb-text:#122033;
      --wb-muted:#5f7186;
      --wb-nav-active:#e8f0f8;
      --wb-table-line:#e2e8f0;
      --wb-shadow:0 12px 32px rgba(33,54,79,.10);
      --wb-body-bg:radial-gradient(circle at top right,#e8f2ff 0,#f4f7fb 44%,#edf2f7 100%);
    }
  }
  html[data-wb-theme="dark"]{
    color-scheme:dark;
    --wb-bg:#07111f;
    --wb-panel:#0d1a2b;
    --wb-panel-2:#0a1626;
    --wb-panel-3:#091524;
    --wb-line:#1b3049;
    --wb-line-strong:#31567e;
    --wb-text:#e8f0f8;
    --wb-muted:#8ea2b8;
    --wb-nav-active:#0e2036;
    --wb-table-line:#152a40;
    --wb-shadow:0 16px 40px rgba(0,0,0,.24);
    --wb-body-bg:radial-gradient(circle at top right,#0f2843 0,#07111f 42%,#040b14 100%);
  }
  body{background:var(--wb-body-bg);color:var(--wb-text);transition:background .18s ease,color .18s ease}
  .side{background:color-mix(in srgb,var(--wb-panel) 88%,transparent);border-color:var(--wb-line)}
  .nav button,.mobile-nav button{color:var(--wb-muted)}
  .nav button:hover,.nav button.active,.mobile-nav button.active{background:var(--wb-nav-active);color:var(--wb-text);border-color:var(--wb-line)}
  .health,.mini,.notice{background:var(--wb-panel-2);border-color:var(--wb-line)}
  .card{background:linear-gradient(180deg,color-mix(in srgb,var(--wb-panel) 97%,transparent),color-mix(in srgb,var(--wb-panel-2) 97%,transparent));border-color:var(--wb-line);box-shadow:var(--wb-shadow)}
  .label,.sub,.section-note,.subtitle,.mini span{color:var(--wb-muted)}
  .btn{background:var(--wb-panel);color:var(--wb-text);border-color:var(--wb-line)}
  .btn:hover{border-color:var(--wb-line-strong)}
  .input,.select{background:var(--wb-panel-3);color:var(--wb-text);border-color:var(--wb-line)}
  .table th,.table td{border-bottom-color:var(--wb-table-line)}
  .table th{background:var(--wb-panel-2)}
  .pill{background:var(--wb-panel-2);color:var(--wb-muted);border-color:var(--wb-line)}
  .toast{background:var(--wb-nav-active);color:var(--wb-text);border-color:var(--wb-line-strong)}
  .wb-theme-control{display:inline-flex;align-items:center;gap:6px;padding:3px;border:1px solid var(--wb-line);border-radius:10px;background:var(--wb-panel);box-shadow:var(--wb-shadow)}
  .wb-theme-control button{border:0;background:transparent;color:var(--wb-muted);min-height:36px;padding:7px 10px;border-radius:7px;cursor:pointer;font:inherit}
  .wb-theme-control button:hover,.wb-theme-control button:focus-visible{background:var(--wb-nav-active);color:var(--wb-text);outline:none}
  .wb-theme-control button[data-active="true"]{background:var(--wb-nav-active);color:var(--wb-text)}
  .wb-theme-label{font-size:12px;font-weight:700;white-space:nowrap}
  .wb-theme-icon{font-size:14px;line-height:1}

  /* Behaviour configurator: intentionally self-contained so it cannot inherit a desktop-only layout assumption. */
  #view-behavior{width:100%;max-width:100%}
  #view-behavior .behavior-toolbar,
  #view-behavior .behavior-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  #view-behavior .behavior-toolbar .select{width:auto;min-width:180px}
  #view-behavior .behavior-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px}
  #view-behavior .behavior-card{height:100%;display:flex;flex-direction:column;justify-content:space-between}
  #view-behavior .behavior-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  #view-behavior .behavior-editor-grid .full{grid-column:1/-1}
  #view-behavior textarea{width:100%;min-height:150px}
  #view-behavior .behavior-json{min-height:220px}
  #view-behavior .behavior-actions .btn{flex:0 0 auto}

  /* Medium tablets / small laptops. */
  @media (max-width: 1100px){
    main{padding:20px}
    .app{grid-template-columns:190px minmax(0,1fr)}
    #view-behavior .behavior-editor-grid{grid-template-columns:1fr}
    #view-behavior .behavior-editor-grid .full{grid-column:auto}
  }

  /* Phones. The navigation remains horizontally scrollable, while content becomes single-column. */
  @media (max-width: 760px){
    .app{display:block}
    .side{display:none}
    .mobile-nav{display:flex;width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:8px;gap:6px}
    .mobile-nav::-webkit-scrollbar{display:none}
    .mobile-nav button{flex:0 0 auto;white-space:nowrap;font-size:12px;min-height:38px}
    main{padding:12px}
    .top{gap:10px;margin-bottom:14px}
    .title{font-size:22px;line-height:1.2}
    .subtitle{font-size:13px}
    .toolbar{width:100%}
    .toolbar .btn,.toolbar .wb-theme-control{flex:1 1 auto}
    .grid,.cards,.split,.form-grid{grid-template-columns:1fr}
    .card{padding:13px;border-radius:12px}
    .section-head{align-items:flex-start;flex-direction:column}
    .section-head>.btn,.section-head>.toolbar,.section-head>.select{width:100%}
    .section-head .btn{flex:1 1 auto}
    .table-wrap{width:100%;max-width:100%;overflow-x:auto}
    .table{min-width:680px}
    .form-grid .btn,.form-grid .input,.form-grid .select{width:100%}
    .toast{left:12px;right:12px;bottom:12px;max-width:none}
    .wb-theme-control{justify-content:center}
    .wb-theme-label{flex:1}

    #view-behavior .behavior-toolbar,
    #view-behavior .behavior-actions{width:100%;align-items:stretch}
    #view-behavior .behavior-toolbar .select,
    #view-behavior .behavior-actions .btn{width:100%;min-width:0}
    #view-behavior .behavior-grid{grid-template-columns:1fr}
    #view-behavior .behavior-editor-grid{grid-template-columns:1fr}
    #view-behavior .behavior-actions .btn{flex:1 1 100%}
    #view-behavior .mini{padding:12px}
  }

  /* Very narrow phones. */
  @media (max-width: 390px){
    main{padding:9px}
    .mobile-nav{padding:6px}
    .mobile-nav button{padding:8px 10px}
    .title{font-size:20px}
    .value{font-size:19px}
    .card{padding:11px}
    .btn,.input,.select{font-size:13px}
  }
</style>
<script>
(function(){
  var THEME_KEY='wingbuddy-dashboard-theme';
  var THEMES=['system','light','dark'];
  var themeState='system';

  function normalizeTheme(value){return THEMES.indexOf(value)>=0?value:'system'}
  function applyTheme(value){
    themeState=normalizeTheme(value);
    var root=document.documentElement;
    if(themeState==='system')root.removeAttribute('data-wb-theme');
    else root.setAttribute('data-wb-theme',themeState);
    try{localStorage.setItem(THEME_KEY,themeState)}catch(_e){}
    renderThemeControl();
  }
  function resolvedTheme(){
    if(themeState==='light'||themeState==='dark')return themeState;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';
  }
  function renderThemeControl(){
    var control=document.getElementById('wbThemeControl');
    if(!control)return;
    var resolved=resolvedTheme();
    var label=themeState==='system'?'System':themeState==='light'?'Light':'Dark';
    control.querySelector('[data-theme-label]').textContent=label;
    control.setAttribute('title','Theme: '+label+' • Click to switch');
    control.setAttribute('aria-label','Theme: '+label+' • Click to switch');
    control.querySelector('[data-theme-icon]').textContent=resolved==='light'?'☀':'☾';
    THEMES.forEach(function(theme){
      var button=control.querySelector('[data-theme="'+theme+'"]');
      if(button)button.setAttribute('data-active',String(theme===themeState));
    });
  }
  function cycleTheme(){
    var next=THEMES[(THEMES.indexOf(themeState)+1)%THEMES.length];
    applyTheme(next);
  }
  function addThemeControl(){
    if(document.getElementById('wbThemeControl'))return;
    var toolbar=document.querySelector('.top .toolbar');
    if(!toolbar)return;
    var wrapper=document.createElement('div');
    wrapper.className='wb-theme-control';
    wrapper.id='wbThemeControl';
    wrapper.innerHTML='<button type="button" data-theme="system" data-active="false" aria-label="Use system theme">Auto</button><button type="button" data-theme="light" data-active="false" aria-label="Use light theme">Light</button><button type="button" data-theme="dark" data-active="false" aria-label="Use dark theme">Dark</button><button type="button" data-theme-cycle aria-label="Theme mode" title="Theme mode"><span class="wb-theme-icon" data-theme-icon>☾</span><span class="wb-theme-label" data-theme-label>System</span></button>';
    toolbar.insertBefore(wrapper,toolbar.firstChild);
    wrapper.addEventListener('click',function(event){
      var target=event.target.closest('button');
      if(!target)return;
      if(target.hasAttribute('data-theme-cycle')){cycleTheme();return}
      var value=target.getAttribute('data-theme');
      if(value)applyTheme(value);
    });
    renderThemeControl();
  }
  function init(){
    var stored='system';
    try{stored=normalizeTheme(localStorage.getItem(THEME_KEY))}catch(_e){}
    applyTheme(stored);
    addThemeControl();
    if(window.matchMedia){
      var media=window.matchMedia('(prefers-color-scheme:light)');
      var onChange=function(){if(themeState==='system')renderThemeControl()};
      if(media.addEventListener)media.addEventListener('change',onChange);else if(media.addListener)media.addListener(onChange);
    }
  }

  function enhanceBehavior(){
    var section=document.getElementById('view-behavior');
    if(!section)return;
    var list=section.querySelector('#behaviorList');
    if(list)list.classList.add('behavior-grid');
    var editor=section.querySelector('#behaviorEditor');
    if(editor){
      var stack=editor.querySelector('.stack');
      if(stack){
        stack.classList.add('behavior-editor-grid');
        var textareas=stack.querySelectorAll('textarea');
        if(textareas.length)textareas.forEach(function(t){t.parentElement&&t.parentElement.classList.add('full')});
        var actions=stack.querySelector('.toolbar');
        if(actions){actions.classList.add('behavior-actions');}
      }
    }
    var head=section.querySelector('.section-head');
    if(head){
      var toolbar=head.querySelector('select');
      if(toolbar){
        toolbar.parentElement&&toolbar.parentElement.classList.add('behavior-toolbar');
        toolbar.classList.add('select');
      }
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init();enhanceBehavior()},{once:true});
  else{init();enhanceBehavior()}
  new MutationObserver(function(){addThemeControl();enhanceBehavior()}).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
}