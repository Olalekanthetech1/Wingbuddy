import { describe, it, expect } from "vitest";
import { formatTelegramMessage, normalizeLatexMath } from "../src/utils/telegram-formatter";

describe("Math Normalization & Corruption Regression Suite", () => {
  describe("Anti-Corruption Protections (Words must never be mutated)", () => {
    it("preserves English words like 'Strain' and 'Change' without LaTeX command collisions", () => {
      const input = "Strain (ε) = Change in Length (ΔL)/Original Length (L₀)";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toBe("Strain (ε) = Change in Length (ΔL)/Original Length (L₀)");
      expect(formatted).not.toContain("Stra∈");
      expect(formatted).not.toContain("Chan≥");
      expect(formatted).not.toContain("∈ Length");
    });

    it("handles LaTeX text blocks without mutating prose words", () => {
      const input = "$\\text{Strain } (\\epsilon) = \\frac{\\text{Change in Length } (\\Delta L)}{\\text{Original Length } (L_0)}$";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toBe("Strain (ε) = Change in Length (ΔL) / Original Length (L₀)");
      expect(formatted).not.toContain("Stra∈");
      expect(formatted).not.toContain("Chan≥");
      expect(formatted).not.toContain("∈ Length");
      expect(formatted).not.toContain("L₀₎");
      expect(formatted).not.toContain("$");
    });

    it("preserves unbraced subscripts and parens without producing 'L₀₎'", () => {
      const input = "Original Length (L_0) and initial state (x_0)";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toBe("Original Length (L₀) and initial state (x₀)");
      expect(formatted).not.toContain("L₀₎");
      expect(formatted).not.toContain("x₀₎");
    });

    it("does not leak markdown/LaTeX delimiters like '$0.005$'", () => {
      const input = "The calculated strain is $0.005$ or $0.5%$.";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toBe("The calculated strain is 0.005 or 0.5%.");
      expect(formatted).not.toContain("$");
    });
  });

  describe("13 Standard Mathematical Expressions", () => {
    it("1. σ = F/A", () => {
      expect(formatTelegramMessage("σ = F/A")).toBe("σ = F/A");
      expect(formatTelegramMessage("$\\sigma = \\frac{F}{A}$")).toBe("σ = F/A");
    });

    it("2. ε = ΔL/L₀", () => {
      expect(formatTelegramMessage("ε = ΔL/L₀")).toBe("ε = ΔL/L₀");
      expect(formatTelegramMessage("$\\epsilon = \\frac{\\Delta L}{L_0}$")).toBe("ε = ΔL/L₀");
    });

    it("3. 1 mm / 200 mm = 0.005", () => {
      expect(formatTelegramMessage("1 mm / 200 mm = 0.005")).toBe("1 mm / 200 mm = 0.005");
      expect(formatTelegramMessage("$1 \\text{ mm} / 200 \\text{ mm} = 0.005$")).toBe("1 mm / 200 mm = 0.005");
    });

    it("4. 0.005 × 100% = 0.5%", () => {
      expect(formatTelegramMessage("0.005 × 100% = 0.5%")).toBe("0.005 × 100% = 0.5%");
      expect(formatTelegramMessage("$0.005 \\times 100\\% = 0.5\\%$")).toBe("0.005 × 100% = 0.5%");
    });

    it("5. 1150 °C", () => {
      expect(formatTelegramMessage("1150 °C")).toBe("1150 °C");
      expect(formatTelegramMessage("1150 ^\\circ C")).toBe("1150 °C");
    });

    it("6. α → β", () => {
      expect(formatTelegramMessage("α → β")).toBe("α → β");
      expect(formatTelegramMessage("$\\alpha \\rightarrow \\beta$")).toBe("α → β");
      expect(formatTelegramMessage("$\\alpha \\to \\beta$")).toBe("α → β");
    });

    it("7. |x|", () => {
      expect(formatTelegramMessage("|x|")).toBe("|x|");
      expect(formatTelegramMessage("$|x|$")).toBe("|x|");
    });

    it("8. x²", () => {
      expect(formatTelegramMessage("x²")).toBe("x²");
      expect(formatTelegramMessage("x^2")).toBe("x²");
      expect(formatTelegramMessage("$x^2$")).toBe("x²");
    });

    it("9. x₁", () => {
      expect(formatTelegramMessage("x₁")).toBe("x₁");
      expect(formatTelegramMessage("x_1")).toBe("x₁");
      expect(formatTelegramMessage("$x_1$")).toBe("x₁");
    });

    it("10. $F$, $A$, $ε$, $ΔL$", () => {
      const input = "$F$, $A$, $ε$, $ΔL$";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toBe("F, A, ε, ΔL");
    });

    it("11. \\frac{1}{200}", () => {
      expect(formatTelegramMessage("\\frac{1}{200}")).toBe("1/200");
      expect(formatTelegramMessage("$\\frac{1}{200}$")).toBe("1/200");
    });

    it("12. \\Delta L", () => {
      expect(formatTelegramMessage("\\Delta L")).toBe("ΔL");
      expect(formatTelegramMessage("$\\Delta L$")).toBe("ΔL");
    });

    it("13. 1 \\div 200 = 0.005", () => {
      expect(formatTelegramMessage("1 \\div 200 = 0.005")).toBe("1 ÷ 200 = 0.005");
      expect(formatTelegramMessage("$1 \\div 200 = 0.005$")).toBe("1 ÷ 200 = 0.005");
    });
  });

  describe("Code blocks protection", () => {
    it("never touches math-like constructs inside code blocks", () => {
      const input = "```typescript\nconst inRange = value in object;\nconst ratio = 1 / 200;\n```";
      const formatted = formatTelegramMessage(input);
      expect(formatted).toContain("const inRange = value in object;");
      expect(formatted).toContain("const ratio = 1 / 200;");
      expect(formatted).not.toContain("∈");
    });
  });
});
