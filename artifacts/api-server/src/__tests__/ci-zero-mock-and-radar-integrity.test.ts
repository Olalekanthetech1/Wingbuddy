import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { dailyDigestService } from "../services/daily-digest.service";

function getAllTsFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (file === "node_modules" || file === "dist" || file === ".git" || file === "__tests__") {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      getAllTsFiles(fullPath, fileList);
    } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe("CI Zero-Mock and Radar Integrity", () => {
  it("strictly enforces that no Job/Market Radar copy exists in views, routes, or services", () => {
    const srcDir = join(__dirname, "..");
    const tsFiles = getAllTsFiles(srcDir);

    const forbiddenPatterns = [
      /\bjob_search\b/i,
      /\bRemote AI Jobs\b/i,
      /\bRemote AI Engineer Job Search\b/i,
      /\b(security-audit-user|admin-toggle-test-user|dto-test-user|conflict-test)@example\.com/i,
    ];

    const violations: Array<{ file: string; pattern: string }> = [];

    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, "utf-8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ file: filePath, pattern: pattern.toString() });
        }
      }
    }

    expect(violations, `Found forbidden mock/radar patterns: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
  });

  it("sanitizes timezones deterministically with UTC as authoritative default", () => {
    expect(dailyDigestService.sanitizeTimezone(null)).toBe("UTC");
    expect(dailyDigestService.sanitizeTimezone("")).toBe("UTC");
    expect(dailyDigestService.sanitizeTimezone("   ")).toBe("UTC");
    expect(dailyDigestService.sanitizeTimezone("Invalid/Unknown_Zone")).toBe("UTC");
    expect(dailyDigestService.sanitizeTimezone("WAT")).toBe("UTC"); // Non-IANA 3-letter abbreviation defaults to UTC
    expect(dailyDigestService.sanitizeTimezone("UTC")).toBe("UTC");
    expect(dailyDigestService.sanitizeTimezone("Africa/Lagos")).toBe("Africa/Lagos");
    expect(dailyDigestService.sanitizeTimezone("Europe/London")).toBe("Europe/London");
    expect(dailyDigestService.sanitizeTimezone("America/New_York")).toBe("America/New_York");
  });

  it("skips digest generation when empty and configured to skip", async () => {
    // Arbitrary non-existent user with 0 items
    const testUserId = 999999999999n;
    // Set preference to skip
    await dailyDigestService.updatePreferences(testUserId, {
      whenEmpty: "skip",
      sections: ["tasks", "reminders", "goals"],
      timezone: "UTC",
    });

    const result = await dailyDigestService.buildDigest(testUserId);
    expect(result.shouldSkip).toBe(true);
    expect(result.itemCount).toBe(0);
    expect(result.sectionsIncluded).toHaveLength(0);
  });

  it("produces deterministic real empty message when configured to send message on empty", async () => {
    const testUserId = 999999999998n;
    await dailyDigestService.updatePreferences(testUserId, {
      whenEmpty: "message",
      sections: ["tasks", "reminders", "goals"],
      timezone: "UTC",
    });

    const result = await dailyDigestService.buildDigest(testUserId);
    expect(result.shouldSkip).toBe(false);
    expect(result.itemCount).toBe(0);
    expect(result.htmlText).toContain("Nothing scheduled today");
    // Strictly zero invented motivational focus quotes
    expect(result.htmlText).not.toContain("Tactical Focus");
    expect(result.htmlText).not.toContain("Action beats anxiety");
  });
});
