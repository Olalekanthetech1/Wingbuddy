import { createHash } from "node:crypto";

export interface SemanticInteractionDecision {
  intent:
    | "greeting"
    | "image_generation"
    | "video_generation"
    | "search_grounding"
    | "deep_reasoning"
    | "coding"
    | "study"
    | "writing"
    | "brainstorming"
    | "general";
  effectiveMode?: "general" | "study" | "coder" | "deep_research" | "math" | "creative" | "auto";
  requiredCapabilities: string[];
  enableSearch: boolean;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  isModeSwitch: boolean;
  requestedMode?: "general" | "study" | "coder" | "deep_research" | "math" | "creative" | "auto";
  cleanedPrompt?: string;
  isGreeting: boolean;
  complexity: "simple" | "moderate" | "complex" | "multi_step";
  confidence: number;
}

interface CacheEntry {
  decision: SemanticInteractionDecision;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;

function ttlMs(): number {
  const raw = Number(process.env.SEMANTIC_INTENT_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function fingerprint(text: string, mode: string, history: Array<{ role: string; content: string }>): string {
  const payload = JSON.stringify({ text: text.trim(), mode, history: history.slice(-8) });
  return createHash("sha256").update(payload).digest("hex");
}

class SemanticInteractionCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly latestByText = new Map<string, CacheEntry>();

  key(text: string, mode: string, history: Array<{ role: string; content: string }>): string {
    return fingerprint(text, mode, history);
  }

  set(text: string, mode: string, history: Array<{ role: string; content: string }>, decision: SemanticInteractionDecision): void {
    const entry = { decision, expiresAt: Date.now() + ttlMs() };
    this.entries.set(this.key(text, mode, history), entry);
    this.latestByText.set(text.trim(), entry);
    this.prune();
  }

  get(text: string, mode: string, history: Array<{ role: string; content: string }>): SemanticInteractionDecision | undefined {
    const key = this.key(text, mode, history);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.decision;
  }

  getLatestForText(text: string): SemanticInteractionDecision | undefined {
    const key = text.trim();
    const entry = this.latestByText.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.latestByText.delete(key);
      return undefined;
    }
    return entry.decision;
  }

  clear(): void {
    this.entries.clear();
    this.latestByText.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    for (const [key, entry] of this.latestByText) {
      if (entry.expiresAt <= now) this.latestByText.delete(key);
    }
  }
}

export const semanticInteractionCache = new SemanticInteractionCacheService();
