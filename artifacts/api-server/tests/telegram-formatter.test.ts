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
it("TEST 11 — Tables: formats a 2-column markdown table cleanly", () => {
    const input = `
Here is the data:
| Name | Value |
|---|---|
| Alpha | 100 |
| Beta | 200 |
    `;
    const result = formatTelegramMessage(input);
    expect(result).toContain("<b>Alpha</b>: 100");
    expect(result).toContain("<b>Beta</b>: 200");
    expect(result).not.toContain("|");
  });

  it("TEST 12 — Tables: formats a 3+ column markdown table cleanly", () => {
    const input = `
| Material | Strength | Density |
|---|---|---|
| Steel | High | High |
| Aluminum | Good | Low |
    `;
    const result = formatTelegramMessage(input);
    expect(result).toContain("<b>Steel</b>");
    expect(result).toContain("• Strength: High");
    expect(result).toContain("• Density: High");
    expect(result).toContain("<b>Aluminum</b>");
    expect(result).toContain("• Strength: Good");
    expect(result).toContain("• Density: Low");
    expect(result).not.toContain("|");
  });


  it("TEST 13 — Chemistry/Physics edge cases: handles circC, longrightarrow, and standalone math without dollars", () => {
    const input = `The process happens at 1150^circC \longrightarrow forms $E = mc^2$`;
    const result = formatTelegramMessage(input);
    expect(result).toBe("The process happens at 1150°C → forms E = mc²");
    expect(result).not.toContain("^circ");
    expect(result).not.toContain("longrightarrow");
  });

  it("TEST 14 — Tables: handles multiline cells with <br> tags properly indented", () => {
    const input = "Here is a table:\n| Feature | Details |\n|---|---|\n| Speed | Very fast<br>Runs smoothly |\n| Memory | Low footprint<br/>Highly optimized |\n";
    const result = formatTelegramMessage(input);
    expect(result).toContain("<b>Speed</b>: Very fast\n  Runs smoothly");
    expect(result).toContain("<b>Memory</b>: Low footprint\n  Highly optimized");
  });

  it("TEST 15 — Math: single variables and numbers in inline delimiters are extracted", () => {
    const input = `Force is $F$ and Area is $A$, resulting in $10$.`;
    const result = formatTelegramMessage(input);
    expect(result).toBe("Force is F and Area is A, resulting in 10.");
  });

  it("TEST 16 — Math: unbraced subscripts and superscripts do not swallow punctuation", () => {
    const input = `Strain is (ΔL/L_0). Another is x^2, and 10^-5.`;
    const result = formatTelegramMessage(input);
    expect(result).toContain("(ΔL/L₀)");
    expect(result).toContain("x², and 10⁻⁵.");
  });

  it("TEST 17 — Math: preserves genuine currency when multiple dollar signs appear", () => {
    const input = `I paid $5 for apples and she paid $10 for oranges.`;
    const result = formatTelegramMessage(input);
    expect(result).toBe("I paid $5 for apples and she paid $10 for oranges.");
  });

  it("TEST 18 — Tables: formats the exact Stainless Steel vs Aluminum table from smoke test", () => {
    const input = `| Property             | Stainless Steel              | Aluminum               |
| :------------------- | :--------------------------- | :--------------------- |
| Density              | 7.8–8.0 g/cm³                | 2.7 g/cm³              |
| Strength             | High                         | Moderate–High          |
| Corrosion Resistance | Excellent                    | Very Good              |
| Thermal Conductivity | Low                          | High                   |
| Common Applications  | Kitchenware, medical equipment | Aircraft, heat sinks   |`;
    const result = formatTelegramMessage(input);
    console.log("TEST 18 RENDER OUTPUT:\n" + result);
    expect(result).toContain("<b>Density</b>");
    expect(result).toContain("• Stainless Steel: 7.8–8.0 g/cm³");
    expect(result).not.toContain("|");
  });
});
