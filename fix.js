const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', 'utf8');

// The file currently has a '});' in the middle and at the end.
// We just want one '});' at the very end of all the 'it' blocks.
// Let's strip all '});' lines that are at the outer scope and just add one at the end.

content = content.replace(/^}\);\s*/gm, ''); // removes all top level `});`

content += "\n});\n";

fs.writeFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', content);
