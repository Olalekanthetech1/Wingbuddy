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
  "\\approx": "≈",
  "\\times": "×",
  "\\cdot": "·",
  "\\pm": "±",
  "\\mp": "∓",
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\longleftarrow": "⟵",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
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

  s = s.replace(/\^\\?circ\s*C/g, "°C");
  s = s.replace(/\^\\?circ\s*F/g, "°F");
  s = s.replace(/\^\\?circ/g, "°");
  s = s.replace(/\b(?:longrightarrow|rightarrow)\b/g, "→");
  s = s.replace(/\b(?:longleftarrow|leftarrow)\b/g, "←");

  // 1. Text container macros: \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  s = s.replace(/\\(?:text|mathrm|mb|mathbf|mathit|mathsf|mathtt)\{([^}]+)\}/g, "$1");

  // 2. Accent & Vector macros: \vec{x}, \hat{x}, \bar{x}, \tilde{x}, \mathbb{R} -> x, R
  s = s.replace(/\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\{([^}]+)\}/g, "$1");

  // 3. Centralized Symbol Registry Replacement
  for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
    const regex = new RegExp(tex.replace("\\", "\\\\") + "(?![a-zA-Z])", "g");
    s = s.replace(regex, unicode);
  }

  // 4. Space normalization after Greek/Math symbols e.g. "Δ L" -> "ΔL"
  s = s.replace(/([Δσεαβγλμπθω])\s+([a-zA-Z0-9])/g, "$1$2");

  // 5. Fractions: \frac{num}{den}
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
      return `${formattedNum}/${formattedDen}`;
    });
  }

  // 6. Subscripts: _0 -> ₀, _{0} -> ₀, _1 -> ₁
  s = s.replace(/_\{?([0-9\+\-\=\(\)a-z]+)\}?/gi, (_m, subText) => {
    const converted = convertSubscript(subText);
    return converted !== subText ? converted : `_${subText}`;
  });

  // 7. Superscripts: ^2 -> ², ^{2} -> ², ^n -> ⁿ
  s = s.replace(/\^\{?([0-9\+\-\=\(\)a-z]+)\}?/gi, (_m, superText) => {
    const converted = convertSuperscript(superText);
    return converted !== superText ? converted : `^${superText}`;
  });

  // 8. Graceful Degradation for Unknown Macros: e.g. \customCmd{val} -> val, \unknownCmd -> unknownCmd
  s = s.replace(/\\([a-zA-Z]+)\{([^}]+)\}/g, "$2"); // Extract argument of unknown macro with arg
  s = s.replace(/\\([a-zA-Z]+)/g, "$1"); // Strip backslash from zero-arg unknown macro

  // 9. Clean up LaTeX spacing commands
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
  static tokenize(input: string): { nodes: ASTNode[]; rawTextWithTokens: string; placeholders: Map<string, ASTNode> } {
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
      const isCurrency = /^[\d,\.]+(?:\s*(?:USD|EUR|GBP))?$/i.test(mathContent.trim());
      if (isCurrency) {
        return fullMatch;
      }
      const hasMath = /[\\=_^+\-*\/<>]|\b(?:sigma|epsilon|Delta|text|frac|alpha|beta|gamma|lambda|theta|omega|pi)\b/i.test(mathContent) ||
        /[a-zA-Z]\s*=\s*/.test(mathContent);

      if (hasMath) {
        return normalizeLatexMath(mathContent);
      }
      return fullMatch;
    });

    // E. Handle standalone/un-delimited TeX macros outside code blocks
    text = text.replace(/\^\\?circ\s*C/g, "°C");
    text = text.replace(/\^\\?circ\s*F/g, "°F");
    text = text.replace(/\^\\?circ/g, "°");
    text = text.replace(/\b(?:longrightarrow|rightarrow)\b/g, "→");
    text = text.replace(/\b(?:longleftarrow|leftarrow)\b/g, "←");

    if (/\\(?:vec|frac|sigma|epsilon|Delta|cdot|text|customMacro|[a-zA-Z]+)/.test(text)) {
      text = text.replace(/\\(?:vec|hat|bar|tilde|dot|ddot|mathbf|mathbb|mathcal)\{([^}]+)\}/g, "$1");
      text = text.replace(/\\([a-zA-Z]+)\{([^}]+)\}/g, "$2");
      for (const [tex, unicode] of Object.entries(CENTRALIZED_MATH_SYMBOL_REGISTRY)) {
        const regex = new RegExp(tex.replace("\\", "\\\\") + "(?![a-zA-Z])", "g");
        text = text.replace(regex, unicode);
      }
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

    return { nodes: Array.from(placeholders.values()), rawTextWithTokens: text, placeholders };
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
  static format(rawInput: string): string {
    if (!rawInput || typeof rawInput !== "string") return "";

    try {
      // 1. Tokenize & Parse AST Structures
      const { rawTextWithTokens, placeholders } = StructureAwareParser.tokenize(rawInput);

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
          .map((c) => c.trim());

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
          result += `<b>${row[0]}</b>: ${row[1]}\n`;
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
            result += `• ${headers[j]}: ${row[j]}\n`;
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

export function formatTelegramMessage(rawInput: string): string {
  return TelegramMessageFormatter.format(rawInput);
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
