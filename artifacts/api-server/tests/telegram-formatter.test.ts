import { describe, expect, it } from "vitest";
import {
  formatTelegramMessage,
  stripTelegramHtml,
  normalizeLatexMath,
} from "../src/utils/telegram-formatter";

describe("TelegramMessageFormatter", () => {
  it("TEST 1 — Markdown: renders headings cleanly and converts bold without raw syntax", () => {
    const input = "### Elastic Deformation\n\n**Stress** is force per unit area.";
    const result = formatTelegramMessage(input);

    expect(result).toContain("<b>Elastic Deformation</b>");
    expect(result).toContain("<b>Stress</b> is force per unit area.");
    expect(result).not.toContain("###");
    expect(result).not.toContain("**");
  });

  it("TEST 2 — Inline LaTeX: converts inline fractions and symbols to clean Unicode math", () => {
    const input = "Stress is represented by $\\sigma = \\frac{F}{A}$.";
    const result = formatTelegramMessage(input);

    expect(result).toBe("Stress is represented by σ = F/A.");
    expect(result).not.toContain("$\\sigma");
    expect(result).not.toContain("\\frac");
  });

  it("TEST 3 — Display LaTeX: converts display math blocks into readable blocks", () => {
    const input = "\\[\n\\sigma = E \\cdot \\epsilon\n\\]";
    const result = formatTelegramMessage(input);

    expect(result).toContain("σ = E · ε");
    expect(result).not.toContain("\\[");
    expect(result).not.toContain("\\]");
    expect(result).not.toContain("\\cdot");
  });

  it("TEST 4 — Scientific notation: strips \\text and converts units properly", () => {
    const input = "Material A has $E = 200\\text{ GPa}$.";
    const result = formatTelegramMessage(input);

    expect(result).toBe("Material A has E = 200 GPa.");
    expect(result).not.toContain("\\text");
  });

  it("TEST 5 — Subscripts: converts subscripts and delta expressions", () => {
    const input = "$\\epsilon = \\frac{\\Delta L}{L_0}$";
    const result = formatTelegramMessage(input);

    expect(result).toBe("ε = ΔL/L₀");
    expect(result).not.toContain("\\epsilon");
    expect(result).not.toContain("\\Delta");
  });

  it("TEST 6 — Markdown + mathematics: handles mixed content flawlessly", () => {
    const input = "### Young's Modulus\n\n**E** is defined as:\n\n\\[\nE = \\frac{\\sigma}{\\epsilon}\n\\]";
    const result = formatTelegramMessage(input);

    expect(result).toContain("<b>Young's Modulus</b>");
    expect(result).toContain("<b>E</b> is defined as:");
    expect(result).toContain("E = σ/ε");
    expect(result).not.toContain("###");
    expect(result).not.toContain("\\[");
  });

  it("TEST 7 — Code: renders inline code wrapped in <code> tag", () => {
    const input = "Use `sendMessage()` to send the response.";
    const result = formatTelegramMessage(input);

    expect(result).toBe("Use <code>sendMessage()</code> to send the response.");
  });

  it("TEST 8 — HTML escaping: safely escapes raw HTML angle brackets and ampersands", () => {
    const input = "<test> & \"example\"";
    const result = formatTelegramMessage(input);

    expect(result).toBe("&lt;test&gt; &amp; \"example\"");
  });

  it("TEST 9 — Ordinary dollar amounts: does not misinterpret prices as LaTeX", () => {
    const input = "The material costs $200.";
    const result = formatTelegramMessage(input);

    expect(result).toBe("The material costs $200.");
  });

  it("TEST 10 — Already formatted content: prevents double-formatting and double-escaping", () => {
    const input = "<b>Stress</b>";
    const result = formatTelegramMessage(input);

    expect(result).toBe("<b>Stress</b>");
    expect(result).not.toContain("&lt;b&gt;");

    // Re-formatting already formatted output is idempotent
    const secondPass = formatTelegramMessage(result);
    expect(secondPass).toBe("<b>Stress</b>");
  });

  it("handles the exact user screenshot example", () => {
    const screenshotText = `***

### Today's Topic: Elastic vs. Plastic Deformation

When you apply a force (load) to a solid material, it deforms (stretches, bends, or compresses). In materials science, we measure this using two key terms:
* **Stress ($\\sigma$):** The force applied divided by the cross-sectional area ($\\sigma = \\frac{F}{A}$).
* **Strain ($\\epsilon$):** The fractional change in length caused by that stress ($\\epsilon = \\frac{\\Delta L}{L_0}$).

Now, as you increase the stress on a material, it goes through two distinct types of deformation:

#### 1. Elastic Deformation
* **What happens at the atomic level:** Atomic bonds stretch like tiny springs, but they **do not break**.
* **Behavior:** It's completely reversible. Remove the force, and the material snaps right back to its original shape.
* **The Math:** Stress and strain have a linear relationship here, described by Hooke's Law:
  $$\\sigma = E \\cdot \\epsilon$$
  where **E** is **Young's Modulus** (a direct measure of a material's stiffness).

***

### Quick Check-In

Based on what we just covered, try answering these two questions:

1. **At the atomic level, what is the main difference between elastic deformation and plastic deformation?**
2. **If Material A has a Young's Modulus of $200\\text{ GPa}$ (like steel) and Material B has $70\\text{ GPa}$ (like aluminum), which material is stiffer in the elastic region?**`;

    const formatted = formatTelegramMessage(screenshotText);

    expect(formatted).toContain("<b>Today's Topic: Elastic vs. Plastic Deformation</b>");
    expect(formatted).toContain("• <b>Stress (σ):</b> The force applied divided by the cross-sectional area (σ = F/A).");
    expect(formatted).toContain("• <b>Strain (ε):</b> The fractional change in length caused by that stress (ε = ΔL/L₀).");
    expect(formatted).toContain("<b>1. Elastic Deformation</b>");
    expect(formatted).toContain("σ = E · ε");
    expect(formatted).toContain("where <b>E</b> is <b>Young's Modulus</b>");
    expect(formatted).toContain("2. <b>If Material A has a Young's Modulus of 200 GPa");
    expect(formatted).not.toContain("###");
    expect(formatted).not.toContain("$$\\sigma");
    expect(formatted).not.toContain("\\frac");
  });

  it("stripTelegramHtml strips HTML tags and restores unescaped characters", () => {
    const html = "<b>Hello</b> &amp; <i>World</i> &lt;test&gt;";
    const stripped = stripTelegramHtml(html);
    expect(stripped).toBe("Hello & World <test>");
  });

  it("handles alternate LaTeX delimiter variants: \\( E \\) and \\[ ... \\]", () => {
    const input = "The relationship is:\n\n\\[\nE = \\frac{\\sigma}{\\epsilon}\n\\]\n\nwhere \\(E\\) represents stiffness.";
    const result = formatTelegramMessage(input);

    expect(result).toContain("The relationship is:");
    expect(result).toContain("E = σ/ε");
    expect(result).toContain("where E represents stiffness.");
    expect(result).not.toContain("\\[");
    expect(result).not.toContain("\\(");
  });

  it("gracefully degrades when encountering unknown LaTeX macros and vector accents", () => {
    const input = "In physics, \\vec{F} = m \\cdot \\vec{a} and \\customMacro{200}.";
    const result = formatTelegramMessage(input);

    expect(result).toBe("In physics, F = m · a and 200.");
    expect(result).not.toContain("\\vec");
    expect(result).not.toContain("\\customMacro");
  });

  it("handles multi-disciplinary content across computer science, finance, physics, and chemistry", () => {
    const input = "### Computer Science\nFunction `calculateVelocity()` returns $\\vec{v} = \\frac{\\Delta x}{\\Delta t}$.\n\n### Finance\nInvestment returned $10,000 with a 5% gain.";
    const result = formatTelegramMessage(input);

    expect(result).toContain("<b>Computer Science</b>");
    expect(result).toContain("Function <code>calculateVelocity()</code> returns v = Δx/Δt.");
    expect(result).toContain("<b>Finance</b>");
    expect(result).toContain("Investment returned $10,000 with a 5% gain.");
  });
});
