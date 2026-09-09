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
    .toolbar .btn{flex:1 1 auto}
    .grid,.cards,.split,.form-grid{grid-template-columns:1fr}
    .card{padding:13px;border-radius:12px}
    .section-head{align-items:flex-start;flex-direction:column}
    .section-head>.btn,.section-head>.toolbar,.section-head>.select{width:100%}
    .section-head .btn{flex:1 1 auto}
    .table-wrap{width:100%;max-width:100%;overflow-x:auto}
    .table{min-width:680px}
    .form-grid .btn,.form-grid .input,.form-grid .select{width:100%}
    .toast{left:12px;right:12px;bottom:12px;max-width:none}

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
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhanceBehavior,{once:true});
  else enhanceBehavior();
  new MutationObserver(function(){enhanceBehavior()}).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
}
