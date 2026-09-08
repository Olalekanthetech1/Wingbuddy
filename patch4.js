const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/src/telegram/streaming-responder.ts', 'utf8');

content = content.replace(/const formattedFull = formatTelegramMessage\(this\.latestText\);\s*const chunks = AdaptiveEngineService\.computeAdaptiveMessageSplit\(formattedFull\);/g, 
  "const rawChunks = AdaptiveEngineService.computeAdaptiveMessageSplit(this.latestText);\n    const chunks = rawChunks.map(chunk => formatTelegramMessage(chunk));");

fs.writeFileSync('artifacts/api-server/src/telegram/streaming-responder.ts', content);
