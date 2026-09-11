const fs = require('fs');
const file = 'artifacts/api-server/src/app.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import { renderDashboardMediaStorage } from "./dashboard-media-storage";',
  'import { renderDashboardMediaStorage } from "./dashboard-media-storage";\nimport { renderDashboardKnowledgeBase } from "./dashboard-knowledge-base";'
);

code = code.replace(
  '${renderDashboardMediaStorage()}',
  '${renderDashboardKnowledgeBase()}${renderDashboardMediaStorage()}'
);

fs.writeFileSync(file, code);
console.log("Updated app.ts");
