import { logger } from "../lib/logger";
import { safeErrorMetadata } from "./safe-error";

// ============================================================================
// 1. CENTRALIZED MATH SYMBOL REGISTRY
// ============================================================================
export const CENTRALIZED_MATH_SYMBOL_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\Delta": "Δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\Theta": "Θ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\Lambda": "Λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\Pi": "Π",
  "\\rho": "ρ",
  "\\sigma": "σ",
  "\\Sigma": "Σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\Phi": "Φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",
  "\\Omega": "Ω",
  "\\infty": "∞",
  "\\le": "≤",
  "\\leq": "≤",
  "\\ge": "≥",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\ne": "≠",
  "\\approx": "≈",
  "\\sim": "~",
  "\\equiv": "≡",
  "\\times": "×",
  "\\cdot": "·",
  "\\bullet": "•",
  "\\div": "÷",
  "\\pm": "±",
  "\\mp": "∓",
  "\\rightarrow": "→",
  "\\to": "→",
  "\\longrightarrow": "→",
  "\\leftarrow": "←",
  "\\longleftarrow": "⟵",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\leftrightarrow": "↔",
  "\\Leftrightarrow": "⇔",
  "\\iff": "⟺",
  "\\degree": "°",
  "\\circ": "°",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\in": "∈",
  "\\notin": "∉",
  "\\subset": "⊂",
  "\\subseteq": "⊆",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\sqrt": "√",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\int": "∫",
  "\\ll": "≪",
  "\\gg": "≫",
});

const GREEK_BARE_MAP: Readonly<Record<string, string>> = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  Theta: "Θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  Lambda: "Λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  Pi: "Π",
  rho: "ρ",
  sigma: "σ",
  Sigma: "Σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  Phi: "Φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Omega: "Ω",
});

const SUB_MAP: Readonly<Record<string, string>> = Object.freeze({
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "o": "ₒ", "x": "ₓ", "h": "ₕ",
  "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "p": "ₚ",
  "s": "ₛ", "t": "ₜ", "y": "ᵧ"
});

const SUPER_MAP: Readonly<Record<string, string>> = Object.freeze({
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  "n": "ⁿ", "i": "ⁱ"
});

function convertSubscript(str: string): string {
  return str.split("").map(ch => SUB_MAP[ch] || ch).join("");
}

function convertSuperscript(str: string): string {
  return str.split("").map(ch => SUPER_MAP[ch] || ch).join("");
}

// ============================================================================
// 2. GENERIC TEX / MATH PARSER & NORMALIZER WITH GRACEFUL DEGRADATION
// ============================================================================
/**
 * Recursively normalizes LaTeX expressions into human-readable Unicode text.
 * Gracefully degrades when encountering unknown commands or complex syntax.
 */
export function normalizeLatexMath(mathStr: string): string {
  if (!mathStr || typeof mathStr !== "string") return "";

  let s = mathStr;

  // 1. Escaped symbols & Degree & temperature macros
  s = s.replace(/\\([%&#$])/g, "$1");
  s = s.replace(/\^\\?circ\s*C/g, "°C");
  s = s.replace(/\^\\?circ\s*F/g, "°F");
  s = s.replace(/\^\\?circ/g, "°");
  s = s.replace(/\\?(?:longrightarrow|rightarrow)\b/g, "→");
  s = s.replace(/\\?(?:longleftarrow|leftarrow)\b/g, "←");

  // 2. Text container macros: \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  s = s.replace(/\\(?:text|mathrm|mb|mathbf|mathit|mathsf|mathtt)\{([^}]+)\}/g, "$1");

  // 3. Accent & Vector macros: \vec{x}, \hat{x}, \bar{x}, \tilde{x}, \mathbb{R} -> x, R
  s = s.replace(/\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\{([^}]+)\}/g, "$1");

  // 4. Fractions: \frac{num}{den} - must run before single-arg macro strip
  let prev = "";
  let guardCount = 0;
  while (prev !== s && guardCount++ < 5) {
    prev = s;
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, num, den) => {
      const cleanNum = normalizeLatexMath(num).trim();
      const cleanDen = normalizeLatexMath(den).trim();
      const numHasOps = /[\+\-\=\*\/<>]/.test(cleanNum);
      const denHasOps = /[\+\-\=\*\/<>]/.test(cleanDen);
      const formattedNum = numHasOps ? `(${cleanNum})` : cleanNum;
      const formattedDen = denHasOps ? `(${cleanDen})` : cleanDen;
      const sep = (cleanNum.includes(" ") || cleanDen.includes(" ")) ? " / " : "/";
      return `${formattedNum}${sep}${formattedDen}`;
    });
  }

  // 5. Centralized Symbol Registry Replacement (Strictly require backslash to prevent mutating English words)
  for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
    const command = tex.startsWith("\\") ? tex.slice(1) : tex;
    // Must be preceded by a backslash and followed by a non-letter
    const regex = new RegExp(`\\\\${command}(?![a-zA-Z])`, "g");
    s = s.replace(regex, unicode);
  }

  // 6. Bare Greek letters: only full words on word boundaries (never substring of an English word)
  for (const [name, unicode] of Object.entries(GREEK_BARE_MAP)) {
    const regex = new RegExp(`\\b${name}\\b`, "g");
    s = s.replace(regex, unicode);
  }

  // 7. Space normalization after Greek/Math symbols e.g. "Δ L" -> "ΔL"
  s = s.replace(/([Δσεαβγλμπθω])\s+([a-zA-Z0-9])/g, "$1$2");

  // 8. Subscripts:
  // a) Braced subscripts: _{0} -> ₀, _{i+1} -> ᵢ₊₁
  s = s.replace(/_\{([0-9\+\-\=\(\)a-zA-Z]+)\}/g, (_m, subText) => {
    return convertSubscript(subText);
  });
  // b) Unbraced subscripts: alphanumeric and sign (never punctuation like closing parens)
  s = s.replace(/_([\+\-]?[0-9a-zA-Z]+)/g, (_m, subText) => {
    return convertSubscript(subText);
  });

  // 9. Superscripts:
  // a) Braced superscripts: ^{2} -> ², ^{(n)} -> ⁽ⁿ⁾
  s = s.replace(/\^\{([0-9\+\-\=\(\)a-zA-Z]+)\}/g, (_m, superText) => {
    return convertSuperscript(superText);
  });
  // b) Unbraced superscripts: alphanumeric and sign (e.g. 10^-5 -> 10⁻⁵)
  s = s.replace(/\^([\+\-]?[0-9a-zA-Z]+)/g, (_m, superText) => {
    return convertSuperscript(superText);
  });

  // 10. Graceful Degradation for Unknown Macros: e.g. \customCmd{val} -> val, \unknownCmd -> unknownCmd
  s = s.replace(/\\([a-zA-Z]+)\{([^}]+)\}/g, "$2"); // Extract argument of unknown macro with arg
  s = s.replace(/\\([a-zA-Z]+)/g, "$1"); // Strip backslash from zero-arg unknown macro

  // 11. Clean up LaTeX spacing commands
  s = s.replace(/\\(?:\s+|,|;|!)/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ============================================================================
// 3. STRUCTURE-AWARE TOKENIZER & AST ENGINE
// ============================================================================
export type ASTNodeType =
  | "code_block"
  | "inline_code"
  | "display_math"
  | "inline_math"
  | "heading"
  | "list_item"
  | "separator"
  | "paragraph"
  | "table";

export interface ASTNode {
  type: ASTNodeType;
  raw: string;
  content: string;
  level?: number;
  lang?: string;
}

export class StructureAwareParser {
  /**
   * Scans raw input and segments it into structured AST Nodes based on structural delimiters
   * (Code blocks, Display Math, Inline Math, Headings, Lists, Paragraphs).
   */
  static tokenize(input: string, isStreaming: boolean = false): { nodes: ASTNode[]; rawTextWithTokens: string; placeholders: Map<string, ASTNode> } {
    let text = input;
    const placeholders = new Map<string, ASTNode>();
    let counter = 0;

    // A. Extract Code Blocks (```lang ... ```)
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, codeContent) => {
      const key = `XTELEGRAMCB${counter++}X`;
      const node: ASTNode = { type: "code_block", raw: _m, content: codeContent, lang };
      placeholders.set(key, node);
      return key;
    });

    // B. Extract Inline Code (`...`)
    text = text.replace(/`([^`\n]+)`/g, (_m, codeContent) => {
      const key = `XTELEGRAMIC${counter++}X`;
      const node: ASTNode = { type: "inline_code", raw: _m, content: codeContent };
      placeholders.set(key, node);
      return key;
    });

    // C. Extract Display Math ($$...$$, \[...\], \begin{...}...\end{...})
    const displayMathRegex = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\begin\{(?:equation|align|math|eqnarray)\*?\}([\s\S]+?)\\end\{(?:equation|align|math|eqnarray)\*?\}/g;
    text = text.replace(displayMathRegex, (_m, m1, m2, m3) => {
      const rawMath = m1 || m2 || m3 || "";
      const normalizedMath = normalizeLatexMath(rawMath);
      const key = `XTELEGRAMDM${counter++}X`;
      const node: ASTNode = { type: "display_math", raw: _m, content: normalizedMath };
      placeholders.set(key, node);
      return `\n\n${key}\n\n`;
    });

    // D. Extract Inline Math (\(...\), $...$)
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, mathContent) => {
      return normalizeLatexMath(mathContent);
    });

    text = text.replace(/\$([^\$\n]+?)\$/g, (fullMatch, mathContent) => {
      const mathTerms = /\b(?:sigma|epsilon|Delta|text|frac|alpha|beta|gamma|lambda|theta|omega|pi|sqrt|sin|cos|tan|log|ln|lim|exp)\b/i;
      // Fast bailout for obvious currency overlaps (e.g. "$5 and she gave me $10")
      if (/\s/.test(mathContent) && !/[\\=_^+\-*\/<>|±×÷·≠≤≥√∑∏∫∂∇∈∉⊂⊆∪∩~≈%]/.test(mathContent) && !/[α-ωΑ-ΩΔσε]/.test(mathContent)) {
        if (!mathTerms.test(mathContent) && !/[a-zA-Z\p{L}]\s*=\s*/u.test(mathContent)) {
          // Multiple words without operators or math terms -> treat as currency
          if (/\b(?:and|or|for|to|with|from|than|then|is|was|are|were)\b/i.test(mathContent)) {
            return fullMatch;
          }
        }
      }

      const hasMath = 
        mathContent.includes("\\") ||
        /[\\=_^+\-*\/<>|±×÷·≠≤≥√∑∏∫∂∇∈∉⊂⊆∪∩~≈%]/.test(mathContent) ||
        /[α-ωΑ-ΩΔσε]/.test(mathContent) ||
        /[₀-₉⁰-⁹]/.test(mathContent) ||
        mathTerms.test(mathContent) ||
        /[a-zA-Z\p{L}]\s*=\s*/u.test(mathContent) ||
        /^[\p{L}\p{N}\p{M}\.,%_\^\+\-]+$/u.test(mathContent.trim()); // Single numbers, decimals, percentages, variables, Greek letters

      if (hasMath) {
        return normalizeLatexMath(mathContent);
      }
      return fullMatch;
    });

    // E. Handle standalone/un-delimited TeX macros outside code blocks
    text = text.replace(/\^\\?circ\s*C/g, "°C");
    text = text.replace(/\^\\?circ\s*F/g, "°F");
    text = text.replace(/\^\\?circ/g, "°");
    text = text.replace(/\\?(?:longrightarrow|rightarrow)\b/g, "→");
    text = text.replace(/\\?(?:longleftarrow|leftarrow)\b/g, "←");

    // Standalone subscripts / superscripts outside of math blocks (must not swallow punctuation)
    // 1. With braces
    text = text.replace(/_\{([0-9\+\-\=\(\)a-zA-Z]+)\}/g, (_m, subText) => {
      return convertSubscript(subText);
    });
    // 2. Without braces (limit to alphanumeric and sign, e.g. L_0 -> L₀; NEVER swallow closing parenthesis or periods)
    text = text.replace(/_([\+\-]?[0-9a-zA-Z]+)/g, (_m, subText) => {
      return convertSubscript(subText);
    });

    // 1. With braces
    text = text.replace(/\^\{([0-9\+\-\=\(\)a-zA-Z]+)\}/g, (_m, superText) => {
      return convertSuperscript(superText);
    });
    // 2. Without braces (limit to alphanumeric and sign, e.g. 10^-5 -> 10⁻⁵)
    text = text.replace(/\^([\+\-]?[0-9a-zA-Z]+)/g, (_m, superText) => {
      return convertSuperscript(superText);
    });

    if (/\\(?:vec|frac|sigma|epsilon|Delta|cdot|div|times|text|customMacro|[a-zA-Z]+)/.test(text)) {
      // Fractions: \frac{num}{den} - must run before single-arg macro strip
      let prevFrac = "";
      let fracGuard = 0;
      while (prevFrac !== text && fracGuard++ < 5) {
        prevFrac = text;
        text = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, num, den) => {
          const cleanNum = normalizeLatexMath(num).trim();
          const cleanDen = normalizeLatexMath(den).trim();
          const numHasOps = /[\+\-\=\*\/<>]/.test(cleanNum);
          const denHasOps = /[\+\-\=\*\/<>]/.test(cleanDen);
          const formattedNum = numHasOps ? `(${cleanNum})` : cleanNum;
          const formattedDen = denHasOps ? `(${cleanDen})` : cleanDen;
          const sep = (cleanNum.includes(" ") || cleanDen.includes(" ")) ? " / " : "/";
          return `${formattedNum}${sep}${formattedDen}`;
        });
      }

      text = text.replace(/\\(?:text|mathrm|mb|mathbf|mathit|mathsf|mathtt)\{([^}]+)\}/g, "$1");
      text = text.replace(/\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\{([^}]+)\}/g, "$1");

      for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
        const command = tex.startsWith("\\") ? tex.slice(1) : tex;
        const regex = new RegExp(`\\\\${command}(?![a-zA-Z])`, "g");
        text = text.replace(regex, unicode);
      }

      // Space normalization after Greek/Math symbols e.g. "Δ L" -> "ΔL"
      text = text.replace(/([Δσεαβγλμπθω])\s+([a-zA-Z0-9])/g, "$1$2");

      text = text.replace(/\\([a-zA-Z]+)\{([^}]+)\}/g, "$2");
      text = text.replace(/\\([a-zA-Z]+)/g, "$1");
    }

    // F. Remove horizontal line separators (---, ***, ___)
    text = text.replace(/^[ \t]*[\-\*_]{3,}[ \t]*$/gm, "");

    // G. Headings (# Heading, ## Heading, ### Heading, #### Heading)
    text = text.replace(/^[ \t]*#{1,6}[ \t]+([^\n]+)$/gm, (_m, headingText) => {
      return `<b>${headingText.trim()}</b>`;
    });

    // H. Bullet lists (* item, - item, + item)
    text = text.replace(/^[ \t]*[\*\-\+][ \t]+([^\n]+)$/gm, (_m, itemText) => {
      return `• ${itemText.trim()}`;
    });

    // I. Markdown Formatting (Bold, Italic, Strikethrough, Links)
    text = text.replace(/\*\*([^\*\n]+)\*\*/g, "<b>$1</b>");
    text = text.replace(/__([^_\n]+)__/g, "<b>$1</b>");
    text = text.replace(/(^|[^\*])\*([^\*\n]+)\*([^\*]|$)/g, "$1<i>$2</i>$3");
    text = text.replace(/(^|[^_])_([^_ \n]+)_([^_]|$)/g, "$1<i>$2</i>$3");
    text = text.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\)\s]+)\)/g, '<a href="$2">$1</a>');

    // J. Extract Markdown Tables
    text = text.replace(/(?:^[ \t]*\|.+\|[ \t]*$\n?){2,}/gm, (match) => {
      // Validate it's a table by checking for the separator row (---)
      const lines = match.trim().split("\n");
      if (lines.length < 2) return match;
      const separatorLine = lines[1];
      if (!/\|[\s\-\:]+\|/.test(separatorLine)) {
        return match;
      }
      const key = `XTELEGRAMTABLE${counter++}X`;
      const node: ASTNode = { type: "table", raw: match, content: match };
      placeholders.set(key, node);
      return `\n\n${key}\n\n`;
    });

    // K. DEFER/PROTECT incomplete tables during streaming
    if (isStreaming) {
      // If the text ends with lines that look like a table but hasn't been captured as an AST node
      const lines = text.split("\n");
      let tableStartLine = -1;
      // Look back for a sequence of lines starting with | that aren't already tokenized
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine.startsWith("|")) {
          if (trimmedLine.includes("XTELEGRAMTABLE")) {
            // Already tokenized as a valid table, break
            tableStartLine = -1;
            break;
          }
          tableStartLine = i;
        } else if (trimmedLine === "" && tableStartLine !== -1) {
          // Allow empty lines within potential table
        } else {
          break;
        }
      }

      if (tableStartLine !== -1) {
        const potentialTablePart = lines.slice(tableStartLine).join("\n");
        const key = `XTELEGRAMTABLE_INCOMPLETE${counter++}X`;
        const node: ASTNode = { type: "code_block", raw: potentialTablePart, content: potentialTablePart, lang: "" };
        placeholders.set(key, node);
        
        // Replace the trailing part in text
        const before = lines.slice(0, tableStartLine).join("\n");
        text = `${before}\n\n${key}\n\n`;
      }
    }

    return { nodes: Array.from(placeholders.values()), rawTextWithTokens: text, placeholders };
  }

  /**
   * Helper to identify all tables in a text block for chunking purposes.
   * Awareness of code blocks prevents misidentifying pipe-heavy code as tables.
   */
  static findTables(text: string): Array<{ start: number; end: number; raw: string; headerRow: string; separatorRow: string }> {
    const results: Array<{ start: number; end: number; raw: string; headerRow: string; separatorRow: string }> = [];
    
    // 1. Identify code blocks to exclude
    const codeBlocks: Array<{ start: number; end: number }> = [];
    const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
    let cbMatch;
    while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
      codeBlocks.push({ start: cbMatch.index, end: cbMatch.index + cbMatch[0].length });
    }

    // 2. Identify tables
    const tableRegex = /(?:^[ \t]*\|.+\|[ \t]*$\n?){2,}/gm;
    let match;

    while ((match = tableRegex.exec(text)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;

      // Check if table overlaps with any code block
      const isInsideCode = codeBlocks.some(cb => 
        (matchStart >= cb.start && matchStart < cb.end) || 
        (matchEnd > cb.start && matchEnd <= cb.end) ||
        (cb.start >= matchStart && cb.end <= matchEnd)
      );
      if (isInsideCode) continue;

      const lines = match[0].split("\n").filter(l => l.trim().length > 0);
      if (lines.length >= 2) {
        const separatorLine = lines[1];
        if (/\|[\s\-\:]+\|/.test(separatorLine)) {
          results.push({
            start: matchStart,
            end: matchEnd,
            raw: match[0],
            headerRow: lines[0],
            separatorRow: lines[1]
          });
        }
      }
    }
    return results;
  }
}

// ============================================================================
// 4. TELEGRAM HTML AST RENDERER & SANITIZER
// ============================================================================
export class TelegramMessageFormatter {
  /**
   * Main entry point: Formats raw AI content into clean Telegram-safe HTML.
   * Uses a structure-aware parser and generic math normalizer.
   */
  static format(rawInput: string, isStreaming: boolean = false): string {
    if (!rawInput || typeof rawInput !== "string") return "";

    try {
      // 1. Tokenize & Parse AST Structures
      const { rawTextWithTokens, placeholders } = StructureAwareParser.tokenize(rawInput, isStreaming);

      let text = rawTextWithTokens;

      // 2. Telegram HTML Tag Safety & Escaping
      const tagRegex = /(<\/?(?:b|i|s|u|code|pre|a(?:\s+href="[^"]*")?|tg-spoiler)(?:\s+class="[^"]*")?>)/gi;
      const parts = text.split(tagRegex);

      text = parts.map(part => {
        if (tagRegex.test(part)) {
          return part;
        }
        return part
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }).join("");

      // 3. Restore Placeholders (Display Math, Code Blocks, Inline Code, Tables)
      for (const [key, node] of placeholders.entries()) {
        if (node.type === "display_math") {
          text = text.replace(key, node.content);
        } else if (node.type === "code_block") {
          const escapedCode = node.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const formattedBlock = `<pre><code>${escapedCode}</code></pre>`;
          text = text.replace(key, formattedBlock);
        } else if (node.type === "inline_code") {
          const escapedCode = node.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const formattedInline = `<code>${escapedCode}</code>`;
          text = text.replace(key, formattedInline);
        } else if (node.type === "table") {
          text = text.replace(key, this.formatTable(node.content));
        }
      }

      // 4. Normalize excessive newlines
      text = text.replace(/\n{3,}/g, "\n\n").trim();

      return text;
    } catch (err) {
      logger.error(
        { stage: "telegram_formatter", error: safeErrorMetadata(err) },
        "Telegram formatting failed; returning safely escaped plain text",
      );
      return rawInput
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }

  /**
   * Dynamically formats markdown tables into Telegram-safe readable lists.
   */
  private static formatTable(tableRaw: string): string {
    const lines = tableRaw.trim().split("\n");
    const headers: string[] = [];
    const rows: string[][] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed
          .slice(1, -1)
          .split("|")
          .map((c) => c.replace(/<br\s*\/?>/gi, '\n').trim());

        // Ignore separator row
        if (cells.every((c) => /^[\s\-\:]+$/.test(c))) {
          continue;
        }

        if (headers.length === 0) {
          headers.push(...cells);
        } else {
          rows.push(cells);
        }
      }
    }

    if (headers.length === 0 || rows.length === 0) {
      return tableRaw;
    }

    let result = "";

    if (headers.length === 2) {
      // 2-column format:
      // <b>Row1Col1</b>: Row1Col2
      for (const row of rows) {
        if (row.length === 2) {
          const val = row[1].replace(/\n/g, "\n  ");
          result += `<b>${row[0]}</b>: ${val}\n`;
        }
      }
    } else {
      // 3+ columns:
      // Row 1 Column 1:
      // • Header 2: Value 2
      // • Header 3: Value 3
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.length > 0) {
          result += `<b>${row[0]}</b>\n`;
          for (let j = 1; j < Math.min(row.length, headers.length); j++) {
            const val = row[j].replace(/\n/g, "\n  ");
            result += `• ${headers[j]}: ${val}\n`;
          }
          if (i < rows.length - 1) {
            result += "\n";
          }
        }
      }
    }

    return result.trim();
  }
}

export function formatTelegramMessage(
  rawInput: string,
  metadata?: { 
    telegramUserId?: number; 
    chunkIndex?: number; 
    source?: string;
    isStreaming?: boolean;
  }
): string {
  return TelegramMessageFormatter.format(rawInput, metadata?.isStreaming);
}

export function stripTelegramHtml(htmlInput: string): string {
  if (!htmlInput) return "";
  return htmlInput
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
