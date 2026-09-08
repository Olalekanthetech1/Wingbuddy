const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/src/telegram/bot.ts', 'utf8');

content = content.replace(/const formattedReply = formatTelegramMessage\(reply\);\s*const chunks = splitTelegramMessage\(formattedReply\);/g, 
  "const chunks = splitTelegramMessage(reply).map(chunk => formatTelegramMessage(chunk));");

fs.writeFileSync('artifacts/api-server/src/telegram/bot.ts', content);
