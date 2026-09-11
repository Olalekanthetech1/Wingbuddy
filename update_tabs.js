const fs = require('fs');
const file = 'artifacts/api-server/src/dashboard-model-controls.ts';
let code = fs.readFileSync(file, 'utf8');

const replacement = `
      const list = document.getElementById('wbModelList');
      if (!cachedModels.length) {
        list.innerHTML = '<div class="empty">No models registered yet. Use the live catalog below to register one.</div>';
      } else {
        const tabsHtml = '<div style="display:flex;gap:8px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-top:16px;overflow-x:auto;">' +
             '<button class="btn ' + (window.__wbActiveTab === 'chat' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\\'chat\\')">🗣️ Chat & Reasoning <span class="pill">' + chatModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'image' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\\'image\\')">🎨 Image Generation <span class="pill">' + imageModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'video' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\\'video\\')">🎬 Video Generation <span class="pill">' + videoModels.length + '</span></button>' +
             '<button class="btn ' + (window.__wbActiveTab === 'embedding' ? 'primary' : '') + '" onclick="window.__wbSwitchTab(\\'embedding\\')">🧠 Embedding <span class="pill">' + embedModels.length + '</span></button>' +
          '</div>';
        
        let contentHtml = '';
        if (window.__wbActiveTab === 'chat') contentHtml = renderTabContent(chatModels, 'primary_chat');
        else if (window.__wbActiveTab === 'image') contentHtml = renderTabContent(imageModels, 'primary_image');
        else if (window.__wbActiveTab === 'video') contentHtml = renderTabContent(videoModels, 'primary_video');
        else if (window.__wbActiveTab === 'embedding') contentHtml = renderTabContent(embedModels, 'primary_embedding');

        list.innerHTML = tabsHtml + contentHtml;
      }`;

// Regex to replace from `const list = document.getElementById('wbModelList');` to `list.innerHTML = tabsHtml + contentHtml; }`
const regex = /const list = document\.getElementById\('wbModelList'\);[\s\S]*?list\.innerHTML = tabsHtml \+ contentHtml;\s*}/;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(file, code);
  console.log("Fixed backticks successfully.");
} else {
  console.log("Regex Target not found");
}
