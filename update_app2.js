const fs = require('fs');
const file = 'artifacts/api-server/src/app.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import { renderDashboardKnowledgeBase } from "./dashboard-knowledge-base";',
  'import { renderKnowledgeVaultPage } from "./knowledge-vault-ui";'
);

code = code.replace(
  '${renderDashboardKnowledgeBase()}',
  ''
);

const serveRoute = `
const serveKnowledgeVault = (_req: Request, res: Response): void => {
  res.type("html").send(renderKnowledgeVaultPage());
};
app.get("/knowledge-vault", serveKnowledgeVault);
`;

code = code.replace(
  'app.get("/", serveDashboard);',
  serveRoute + '\napp.get("/", serveDashboard);'
);

fs.writeFileSync(file, code);
console.log("Updated app.ts for standalone Knowledge Vault page");
