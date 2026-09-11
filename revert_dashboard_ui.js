const fs = require('fs');
const file = 'artifacts/api-server/src/dashboard-ui.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  '<div class="toolbar"><a href="/knowledge-vault" class="btn primary" style="text-decoration:none;">📚 Knowledge Vault</a><button class="btn" onclick="refreshAll()">↻ Refresh</button></div>',
  '<div class="toolbar"><button class="btn" onclick="refreshAll()">↻ Refresh</button></div>'
);

fs.writeFileSync(file, code);
console.log("Reverted dashboard-ui.ts");
