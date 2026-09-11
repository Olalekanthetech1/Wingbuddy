export function renderDashboardKnowledgeBase(): string {
  return `<script>
(function(){
  function showKnowledgeView(){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav button,.mobile-nav button').forEach(b=>b.classList.remove('active'));
    document.getElementById('view-knowledge')?.classList.add('active');
    document.querySelectorAll('[data-knowledge-nav]').forEach(b=>b.classList.add('active'));
    window.__wbLoadDocs?.();
  }
  function installNav(){
    ['nav','mobileNav'].forEach(id=>{
      const root=document.getElementById(id);
      if(root&&!root.querySelector('[data-knowledge-nav]')){
        const b=document.createElement('button');
        b.type='button';
        b.dataset.knowledgeNav='';
        b.textContent='📚 Knowledge Vault';
        b.addEventListener('click',showKnowledgeView);
        root.appendChild(b);
      }
    });
  }
  async function loadDocs() {
    const list = document.getElementById('wbKbDocList');
    if(!list) return;
    try {
      const res = await fetch('/api/knowledge');
      const data = await res.json();
      if (data.documents && data.documents.length > 0) {
        list.innerHTML = data.documents.map(d => \`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--line);border-radius:6px;margin-bottom:8px;background:var(--bg)">
            <div>
              <div style="font-weight:600;font-size:14px">\${d.filename.replace(/</g, '&lt;')}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px">\${new Date(d.createdAt).toLocaleString()}</div>
            </div>
            <button class="btn danger" onclick="window.__wbDeleteDoc('\${d.id}')">Delete</button>
          </div>
        \`).join('');
      } else {
        list.innerHTML = '<div class="empty">No documents uploaded yet.</div>';
      }
    } catch (e) {
      list.innerHTML = '<div class="empty" style="color:var(--red)">Failed to load documents</div>';
    }
  }
  window.__wbDeleteDoc = async function(id) {
    if (!confirm("Delete this document from the Knowledge Vault?")) return;
    document.getElementById('wbKbDocList').innerHTML = '<div class="empty">Deleting...</div>';
    await fetch('/api/knowledge/' + id, { method: 'DELETE' });
    loadDocs();
  };
  function initKnowledgeVault(){
    installNav();
    if(!document.getElementById('view-knowledge')){
      const section=document.createElement('section');
      section.className='view';
      section.id='view-knowledge';
      section.innerHTML=\`
        <div class="card section">
          <div class="section-head">
            <div>
              <div class="section-title">Knowledge Vault</div>
              <div class="section-note">Upload private documents (TXT, MD, CSV) for Retrieval-Augmented Generation (RAG).</div>
            </div>
            <button class="btn" onclick="window.__wbLoadDocs()">Refresh</button>
          </div>
          
          <input type="file" id="wbKbFileInput" style="display: none;" accept=".txt,.md,.csv" multiple />
          <div id="wbKbUploadArea" style="border:2px dashed var(--line);border-radius:8px;padding:32px;text-align:center;cursor:pointer;color:var(--muted);margin-bottom:24px;" onclick="document.getElementById('wbKbFileInput').click()">
            <strong style="font-size:14px;color:var(--text);">Click to Upload Document</strong>
            <div style="font-size:12px;margin-top:6px;">Supports .txt, .md, .csv (Raw Text)</div>
          </div>
          
          <div style="font-weight:600;margin-bottom:12px;font-size:14px;">Indexed Documents</div>
          <div id="wbKbDocList">
            <div class="empty">Loading...</div>
          </div>
        </div>
      \`;
      const mainEl=document.querySelector('main');
      if(mainEl) mainEl.appendChild(section);
      
      window.__wbLoadDocs = loadDocs;
      
      const fileInput = section.querySelector('#wbKbFileInput');
      if (fileInput) {
        fileInput.addEventListener('change', async function(e) {
          const files = Array.from(e.target.files);
          if (files.length === 0) return;
          
          const btn = document.getElementById('wbKbUploadArea');
          const origContent = btn.innerHTML;
          
          let successCount = 0;
          let failCount = 0;
          
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            btn.innerHTML = '';
            const statusTitle = document.createElement('strong');
            statusTitle.style.color = 'var(--text)';
            statusTitle.textContent = 'Uploading (' + (i + 1) + ' of ' + files.length + ')...';
            const statusDetail = document.createElement('div');
            statusDetail.style.fontSize = '12px';
            statusDetail.style.marginTop = '6px';
            statusDetail.textContent = 'Embedding: ' + file.name;
            btn.appendChild(statusTitle);
            btn.appendChild(statusDetail);
            
            try {
              const text = await file.text();
              const res = await fetch('/api/knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name,
                  mimeType: file.type || "text/plain",
                  content: text
                })
              });
              
              const data = await res.json();
              if (data.success) successCount++;
              else failCount++;
            } catch (err) {
              failCount++;
            }
          }
          
          if (failCount > 0) {
            alert("Finished uploading. " + successCount + " succeeded, " + failCount + " failed.");
          }
          
          btn.innerHTML = origContent;
          e.target.value = '';
          loadDocs();
        });
      }
      setTimeout(loadDocs, 50);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initKnowledgeVault,{once:true});
  else initKnowledgeVault();
  const observer=new MutationObserver(installNav);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
}
