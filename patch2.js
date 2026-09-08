const fs = require('fs');
let content = fs.readFileSync('artifacts/api-server/src/utils/telegram-formatter.ts', 'utf8');

// Find the block "E. Handle standalone/un-delimited TeX macros outside code blocks"
const target = `    // E. Handle standalone/un-delimited TeX macros outside code blocks
    if (/\\\\(?:vec|frac|sigma|epsilon|Delta|cdot|text|customMacro|[a-zA-Z]+)/.test(text)) {
      text = text.replace(/\\\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\\{([^}]+)\\}/g, "$1");
      text = text.replace(/\\\\([a-zA-Z]+)\\{([^}]+)\\}/g, "$2");
      for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
        const regex = new RegExp(tex.replace("\\\\", "\\\\\\\\") + "(?![a-zA-Z])", "g");
        text = text.replace(regex, unicode);
      }
    }`;

const replacement = `    // E. Handle standalone/un-delimited TeX macros outside code blocks
    text = text.replace(/\\^\\\\?circ\\s*C/g, "°C");
    text = text.replace(/\\^\\\\?circ\\s*F/g, "°F");
    text = text.replace(/\\^\\\\?circ/g, "°");
    text = text.replace(/\\b(?:longrightarrow|rightarrow)\\b/g, "→");
    text = text.replace(/\\b(?:longleftarrow|leftarrow)\\b/g, "←");

    if (/\\\\(?:vec|frac|sigma|epsilon|Delta|cdot|text|customMacro|[a-zA-Z]+)/.test(text)) {
      text = text.replace(/\\\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\\{([^}]+)\\}/g, "$1");
      text = text.replace(/\\\\([a-zA-Z]+)\\{([^}]+)\\}/g, "$2");
      for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
        const regex = new RegExp(tex.replace("\\\\", "\\\\\\\\") + "(?![a-zA-Z])", "g");
        text = text.replace(regex, unicode);
      }
    }`;

content = content.replace(target, replacement);
fs.writeFileSync('artifacts/api-server/src/utils/telegram-formatter.ts', content);
