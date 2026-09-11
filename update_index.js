const fs = require('fs');
const file = 'artifacts/api-server/src/index.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import { onboardingService } from "./services/onboarding.service";',
  'import { onboardingService } from "./services/onboarding.service";\nimport { knowledgeVaultService } from "./services/knowledge-vault.service";'
);

code = code.replace(
  'await apiKeyPoolService.hydrateFromDatabase();',
  'await apiKeyPoolService.hydrateFromDatabase();\n    await knowledgeVaultService.initialize();'
);

fs.writeFileSync(file, code);
console.log("Updated index.ts");
