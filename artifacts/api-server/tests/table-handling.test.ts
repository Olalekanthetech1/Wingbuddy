import { describe, it, expect } from "vitest";
import { AdaptiveEngineService } from "../src/services/adaptive-engine.service";
import { TelegramMessageFormatter, formatTelegramMessage, StructureAwareParser } from "../src/utils/telegram-formatter";

describe("Markdown Table Handling & Chunking", () => {

  // 1. Small 2-column table
  it("formats small 2-column table correctly", () => {
    const input = "| Key | Value |\n|---|---|\n| Name | Alice |\n| Age | 30 |";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<b>Name</b>: Alice");
    expect(formatted).toContain("<b>Age</b>: 30");
  });

  // 2. Small 3+ column table
  it("formats small 3+ column table correctly", () => {
    const input = "| Name | Role | Location |\n|---|---|---|\n| Alice | Admin | London |\n| Bob | User | Paris |";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<b>Alice</b>");
    expect(formatted).toContain("• Role: Admin");
    expect(formatted).toContain("• Location: London");
  });

  // 3. Table embedded between paragraphs
  it("handles table between paragraphs", () => {
    const input = "Intro paragraph.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nOutro paragraph.";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("Intro paragraph.");
    expect(formatted).toContain("<b>1</b>: 2");
    expect(formatted).toContain("Outro paragraph.");
  });

  // 4. Table followed by bullets
  it("handles table followed by bullets", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |\n\n- Bullet 1\n- Bullet 2";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<b>1</b>: 2");
    expect(formatted).toContain("• Bullet 1");
  });

  // 5. Table preceded by an equation
  it("handles table preceded by equation", () => {
    const input = "$$x = y$$\n\n| A | B |\n|---|---|\n| 1 | 2 |";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("x = y");
    expect(formatted).toContain("<b>1</b>: 2");
  });

  // 6. Large table that approaches Telegram's message limit
  it("keeps large table together if it fits", () => {
    let rows = "";
    for (let i = 0; i < 50; i++) {
      rows += `| Row ${i} | Data ${i} |\n`;
    }
    const input = "| Header | Value |\n|---|---|\n" + rows;
    // Length is roughly 50 * 20 = 1000 chars. Fits in one chunk.
    const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(input, { maxLimit: 4096 });
    expect(chunks.length).toBe(1);
  });

  // 7. Oversized table requiring multiple chunks
  it("splits oversized table and repeats headers", () => {
    let rows = "";
    for (let i = 0; i < 300; i++) {
      rows += `| Row ${i} | Data ${i} |\n`;
    }
    const input = "| Header | Value |\n|---|---|\n" + rows;
    // Input is ~6000 chars. Should split.
    const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(input, { maxLimit: 2000 });
    expect(chunks.length).toBeGreaterThan(1);
    
    // Check if second chunk has header
    expect(chunks[1]).toContain("| Header | Value |");
    expect(chunks[1]).toContain("|---|---|");
  });

  // 10. Attempted split in the middle of table
  it("avoids splitting middle of table if possible", () => {
     const prefix = "A".repeat(1500);
     const table = "| H1 | H2 |\n|---|---|\n| R1 | R2 |\n| R3 | R4 |";
     const input = prefix + "\n\n" + table;
     
     // Set limit so it would naturally split in the middle of table
     // We set maxLimit very tight so it MUST split if it tries to include the table
     const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(input, { maxLimit: 1510, targetPreferredLength: 1500 });
     
     // It should break BEFORE the table (at \n\n)
     expect(chunks[0].trim()).toBe(prefix);
     expect(chunks[1]).toContain("| H1 | H2 |");
  });

  // 11. Streaming incomplete table
  it("defers table rendering during streaming (incomplete)", () => {
    const input = "| Header 1 | Header 2 |";
    const formatted = formatTelegramMessage(input, { isStreaming: true });
    // Should be wrapped in <code> to preserve structure
    expect(formatted).toContain("<code>| Header 1 | Header 2 |</code>");
  });

  // 12. Streaming table becoming complete
  it("renders table once complete during streaming", () => {
    const input = "| H1 | H2 |\n|---|---|\n| R1 | R2 |";
    const formatted = formatTelegramMessage(input, { isStreaming: true });
    // Now it has a separator, it should be rendered as a table (which for 2 cols is bold keys)
    expect(formatted).toContain("<b>R1</b>: R2");
    expect(formatted).not.toContain("<code>| H1 | H2 |");
  });

  // 14. Pipes in normal prose
  it("does not treat pipes in prose as tables", () => {
    const input = "This is a | pipe | in prose.";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toBe("This is a | pipe | in prose.");
  });

  // 15. Pipes inside code blocks
  it("ignores pipes inside code blocks", () => {
    const input = "```\n| not | a | table |\n```";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<pre><code>| not | a | table |");
    // Verify findTables doesn't find it
    const found = StructureAwareParser.findTables(input);
    expect(found.length).toBe(0);
  });

  // 16. Mathematical absolute-value pipes
  it("ignores mathematical absolute value pipes", () => {
    const input = "The value is $|x|$.";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("|x|");
  });

  // 17. Malformed table
  it("handles malformed table gracefully", () => {
    const input = "| H1 | H2 |\n| Row without pipes";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("| H1 | H2 |");
    expect(formatted).toContain("Row without pipes");
  });

  // 8. Chunk boundary immediately before table
  it("handles chunk boundary immediately before table", () => {
    const prefix = "A".repeat(1500);
    const table = "| H1 | H2 |\n|---|---|\n| R1 | R2 |";
    const input = prefix + "\n" + table;
    const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(input, { maxLimit: 1501, targetPreferredLength: 1500 });
    expect(chunks[0].trim()).toBe(prefix);
    expect(chunks[1]).toContain("| H1 | H2 |");
  });

  // 9. Chunk boundary immediately after table
  it("handles chunk boundary immediately after table", () => {
    const table = "| H1 | H2 |\n|---|---|\n| R1 | R2 |";
    const filler = "F".repeat(3000);
    const suffix = "S".repeat(2000);
    const input = table + "\n\n" + filler + "\n\n" + suffix;
    
    // With default maxLimit 4096 and preferred ~3800, it should keep table + filler together, 
    // then split at \n\n before suffix because total length exceeds 4096.
    const chunks = AdaptiveEngineService.computeAdaptiveMessageSplit(input);
    
    expect(chunks[0]).toContain("| H1 | H2 |");
    expect(chunks[0]).toContain(filler);
    expect(chunks[0]).not.toContain(suffix);
    expect(chunks[1]).toContain(suffix);
  });

  // 13. Multiple tables in one response
  it("handles multiple tables in one response", () => {
    const input = "| T1 | V1 |\n|---|---|\n| 1 | 2 |\n\nSome text.\n\n| T2 | V2 |\n|---|---|\n| 3 | 4 |";
    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<b>1</b>: 2");
    expect(formatted).toContain("Some text.");
    expect(formatted).toContain("<b>3</b>: 4");
  });

  // 18. Exact Stainless Steel/Aluminum regression case
  it("handles the Stainless Steel vs Aluminum regression case correctly", () => {
    const input = `| Property | Stainless Steel | Aluminum |
| :--- | :--- | :--- |
| **Density** | 7.8–8.0 g/cm³ | 2.7 g/cm³ |
| **Strength** | High | Moderate–High |
| **Corrosion Resistance** | Excellent | Very Good |
| **Thermal Conductivity** | Low | High |
| **Common Applications** | Kitchenware, medical equipment | Aircraft, heat sinks |`;

    const formatted = formatTelegramMessage(input);
    expect(formatted).toContain("<b>Density</b>");
    expect(formatted).toContain("• Stainless Steel: 7.8–8.0 g/cm³");
    expect(formatted).toContain("• Aluminum: 2.7 g/cm³");
  });

});
