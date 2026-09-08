const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', 'utf8');

// Find the last '});'
const lastIdx = content.lastIndexOf('});');
if (lastIdx > -1) {
  content = content.substring(0, lastIdx);
}

// Remove the wrongly appended tests
content = content.replace(/  it\("TEST 11[^]*/, '');

content += `
  it("TEST 11 — Tables: formats a 2-column markdown table cleanly", () => {
    const input = \`
Here is the data:
| Name | Value |
|---|---|
| Alpha | 100 |
| Beta | 200 |
    \`;
    const result = formatTelegramMessage(input);
    expect(result).toContain("<b>Alpha</b>: 100");
    expect(result).toContain("<b>Beta</b>: 200");
    expect(result).not.toContain("|");
  });

  it("TEST 12 — Tables: formats a 3+ column markdown table cleanly", () => {
    const input = \`
| Material | Strength | Density |
|---|---|---|
| Steel | High | High |
| Aluminum | Good | Low |
    \`;
    const result = formatTelegramMessage(input);
    expect(result).toContain("<b>Steel</b>");
    expect(result).toContain("• Strength: High");
    expect(result).toContain("• Density: High");
    expect(result).toContain("<b>Aluminum</b>");
    expect(result).toContain("• Strength: Good");
    expect(result).toContain("• Density: Low");
    expect(result).not.toContain("|");
  });
});
`;

fs.writeFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', content);
