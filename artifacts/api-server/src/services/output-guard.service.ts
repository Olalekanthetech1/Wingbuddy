import { PROMPT_CANARY } from "./prompt-builder.service";
import { logger } from "../lib/logger";

export class OutputGuardService {
  /**
   * Checks if the user's input asks about the assistant's identity, prompt, or technical structure.
   */
  public static isQueryAboutAssistant(query: string): boolean {
    const q = query.toLowerCase();
    return (
      q.includes("who are you") ||
      q.includes("introduce yourself") ||
      q.includes("your name") ||
      q.includes("your prompt") ||
      q.includes("your instructions") ||
      q.includes("system prompt") ||
      q.includes("what model") ||
      q.includes("which model") ||
      q.includes("your configuration") ||
      q.includes("how do you work") ||
      q.includes("what are you") ||
      q.includes("tell me about yourself")
    );
  }

  /**
   * Analyzes the response for canary leaks, prompt overlap, or denylist matches.
   */
  public static detectLeak(params: {
    response: string;
    systemPrompt: string;
    userQuery: string;
  }): { isLeak: boolean; reason?: string } {
    const resp = params.response;
    const respLower = resp.toLowerCase();

    // 1. Canary leak check
    if (resp.includes(PROMPT_CANARY) || respLower.includes("canary_secure_guard")) {
      return { isLeak: true, reason: "Canary leak detected" };
    }

    // 2. Exact or near-exact n-gram overlap check with the system prompt (to catch prompt injection/recitation)
    const systemNgrams = this.getNgrams(params.systemPrompt, 6);
    const responseNgrams = this.getNgrams(resp, 6);
    let matchedNgram: string | null = null;
    for (const ngram of responseNgrams) {
      if (systemNgrams.has(ngram)) {
        matchedNgram = ngram;
        break;
      }
    }
    if (matchedNgram) {
      return { isLeak: true, reason: `Prompt recitation overlap detected: "${matchedNgram}"` };
    }

    // 3. Contextual term denylist if the user asked about the assistant
    if (this.isQueryAboutAssistant(params.userQuery)) {
      const denylist = [
        "zero-fallback",
        "system prompt",
        "postgresql",
        "directed acyclic",
        "row-level leases",
        "multi-key",
        "fencing token",
        "circuit breaker",
        "key pool",
        "drizzle",
        "prisma",
        "gemini-3.1",
      ];
      for (const term of denylist) {
        if (respLower.includes(term)) {
          return { isLeak: true, reason: `Denylist term match in self-referential query: "${term}"` };
        }
      }
    }

    return { isLeak: false };
  }

  private static getNgrams(text: string, n: number): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const ngrams = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      const slice = words.slice(i, i + n).join(" ");
      ngrams.add(slice);
    }
    return ngrams;
  }
}
