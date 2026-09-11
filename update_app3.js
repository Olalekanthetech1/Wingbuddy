const fs = require('fs');
const file = 'artifacts/api-server/src/app.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import { renderKnowledgeVaultPage } from "./knowledge-vault-ui";',
  'import { renderDashboardKnowledgeBase } from "./dashboard-knowledge-base";'
);

code = code.replace(
  '${renderDashboardProactiveAssistant()}',
  '${renderDashboardProactiveAssistant()}${renderDashboardKnowledgeBase()}'
);

const serveRoute = `
const serveKnowledgeVault = (_req: Request, res: Response): void => {
  res.type("html").send(renderKnowledgeVaultPage());
};
app.get("/knowledge-vault", serveKnowledgeVault);
`;

code = code.replace(serveRoute, '');

fs.writeFileSync(file, code);
console.log("Updated app.ts for SPA Knowledge Vault");
