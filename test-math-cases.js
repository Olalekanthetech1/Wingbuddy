const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', 'utf8');

content = content.replace(/^}\);\s*/gm, '');

content += `
  it("TEST 13 — Chemistry/Physics edge cases: handles circC, longrightarrow, and standalone math without dollars", () => {
    const input = \`The process happens at 1150^circC \\longrightarrow forms $E = mc^2$\`;
    const result = formatTelegramMessage(input);
    expect(result).toBe("The process happens at 1150°C → forms E = mc²");
    expect(result).not.toContain("^circ");
    expect(result).not.toContain("longrightarrow");
  });
});
`;

fs.writeFileSync('artifacts/api-server/tests/telegram-formatter.test.ts', content);
