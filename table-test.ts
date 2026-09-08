const text = `
Here is a comparison:
| Material | Strength | Temperature |
|---|---|---|
| Nickel | Excellent | High |
| Titanium | Good | Moderate |
`;

const tableRegex = /(?:^[ \t]*\|.*\|[ \t]*\n?){2,}/gm;
console.log(text.match(tableRegex));
