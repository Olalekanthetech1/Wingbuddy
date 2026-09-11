const fs = require('fs');
const file = 'artifacts/api-server/src/services/global-context.service.ts';
let code = fs.readFileSync(file, 'utf8');

const importStatement = 'import { knowledgeVaultService, type KnowledgeSearchResult } from "./knowledge-vault.service";';
if (!code.includes(importStatement)) {
  code = code.replace(
    'import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";',
    'import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";\n' + importStatement
  );
}

// Add knowledgeVault field to UserGlobalContext
code = code.replace(
  'sessionSummaries: Array<{ id: number; summary: string; updatedAt: Date }>;',
  'sessionSummaries: Array<{ id: number; summary: string; updatedAt: Date }>;\n  knowledgeVaultResults?: KnowledgeSearchResult[];'
);

// Declare variable
code = code.replace(
  'let memoryRecallSource: "vector" | "lexical" | "none" = "none";',
  'let memoryRecallSource: "vector" | "lexical" | "none" = "none";\n    let knowledgeVaultResults: KnowledgeSearchResult[] = [];'
);

// Call searchSimilar
code = code.replace(
  'if (queryVec.length > 0) {',
  'knowledgeVaultResults = await knowledgeVaultService.searchSimilar(telegramUserId.toString(), query, 3);\n        if (queryVec.length > 0) {'
);

// Inject into promptInstruction
const injectTarget = 'const temporalInstruction = TemporalContextService.buildPromptInstruction(temporalContext);';
const injection = `
    const knowledgeVaultInstruction = knowledgeVaultResults.length > 0 ? 
      "[KNOWLEDGE VAULT RECALL]\\n" +
      "The following chunks were retrieved from the user's private documents based on semantic similarity to their query. Use these exclusively if they contain the answer to the user's question:\\n" +
      knowledgeVaultResults.map(r => "- From '" + r.filename + "': " + r.content).join("\\n") 
      : "";
`;

code = code.replace(injectTarget, injectTarget + injection);

code = code.replace(
  'temporalInstruction,',
  'temporalInstruction,\n      knowledgeVaultInstruction,'
);

// Add to return object
code = code.replace(
  'semanticRecall,',
  'semanticRecall,\n      knowledgeVaultResults,'
);

fs.writeFileSync(file, code);
console.log("Updated global-context.service.ts");
