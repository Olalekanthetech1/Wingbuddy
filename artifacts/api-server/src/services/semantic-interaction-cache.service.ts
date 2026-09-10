import { createHash } from "node:crypto";

export type SemanticTaskIntent =
  | "NEW_TASK"
  | "CONTINUE_TASK"
  | "PAUSE_TASK"
  | "COMPLETE_TASK"
  | "CANCEL_TASK"
  | "VIEW_TASKS"
  | "NO_TASK";

export type PromptType =
  | "DIRECT_COMMAND"
  | "QUESTION"
  | "CONTEXTUAL"
  | "FEW_SHOT"
  | "ZERO_SHOT"
  | "REASONING"
  | "ROLE_BASED"
  | "CONVERSATIONAL"
  | "MULTI_STEP"
  | "CONSTRAINT_DRIVEN";

export type RequestExecutionProfile = "conversational" | "one_shot" | "durable" | "clarification" | "unknown";

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
  promptTypes: PromptType[];
  primaryPromptType: PromptType;
  executionProfile: RequestExecutionProfile;
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
  taskIntent?: SemanticTaskIntent;
  taskTitle?: string;
  taskGoal?: string;
  taskIdHint?: number;
  taskSteps?: string[];
  conversationOperation?: string;
  conversationTargetHistoryIndices?: number[];
  unresolvedReference?: string;
}

interface CacheEntry {
  decision: SemanticInteractionDecision;
  expiresAt: number;
  decisionFingerprint: string;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_LATEST_ENTRIES_PER_TEXT = 8;

function ttlMs(): number {
  const raw = Number(process.env.SEMANTIC_INTENT_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function fingerprint(text: string, mode: string, history: Array<{ role: string; content: string }>): string {
  const payload = JSON.stringify({ text: text.trim(), mode, history: history.slice(-8) });
  return createHash("sha256").update(payload).digest("hex");
}

function decisionFingerprint(decision: SemanticInteractionDecision): string {
  return createHash("sha256").update(JSON.stringify(decision)).digest("hex");
}

class SemanticInteractionCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly latestByText = new Map<string, CacheEntry[]>();

  key(text: string, mode: string, history: Array<{ role: string; content: string }>): string {
    return fingerprint(text, mode, history);
  }

  set(
    text: string,
    mode: string,
    history: Array<{ role: string; content: string }>,
    decision: SemanticInteractionDecision,
  ): void {
    const entry: CacheEntry = {
      decision,
      expiresAt: Date.now() + ttlMs(),
      decisionFingerprint: decisionFingerprint(decision),
    };
    this.entries.set(this.key(text, mode, history), entry);

    const textKey = text.trim();
    const current = (this.latestByText.get(textKey) ?? []).filter(
      (candidate) => candidate.expiresAt > Date.now(),
    );
    const withoutSameDecision = current.filter(
      (candidate) => candidate.decisionFingerprint !== entry.decisionFingerprint,
    );
    withoutSameDecision.push(entry);
    this.latestByText.set(
      textKey,
      withoutSameDecision.slice(-MAX_LATEST_ENTRIES_PER_TEXT),
    );
    this.prune();
  }

  get(
    text: string,
    mode: string,
    history: Array<{ role: string; content: string }>,
  ): SemanticInteractionDecision | undefined {
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
    const now = Date.now();
    const current = (this.latestByText.get(key) ?? []).filter(
      (entry) => entry.expiresAt > now,
    );
    if (current.length === 0) {
      this.latestByText.delete(key);
      return undefined;
    }

    this.latestByText.set(key, current);
    const distinct = new Map<string, CacheEntry>();
    for (const entry of current) distinct.set(entry.decisionFingerprint, entry);
    if (distinct.size !== 1) return undefined;

    return current[current.length - 1].decision;
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
    for (const [key, entries] of this.latestByText) {
      const active = entries.filter((entry) => entry.expiresAt > now);
      if (active.length === 0) this.latestByText.delete(key);
      else this.latestByText.set(key, active.slice(-MAX_LATEST_ENTRIES_PER_TEXT));
    }
  }
}

export const semanticInteractionCache = new SemanticInteractionCacheService();
