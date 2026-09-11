import { db, usersTable, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { userTierService, UserTier } from "./user-tier.service";

export interface AIPersona {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  systemPrompt: string;
  preferredModel?: string | null;
  temperature: number;
  requiredTier: "free" | "pro" | "vip";
  capabilities?: string[];
  isBuiltIn: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_PERSONAS: AIPersona[] = [
  {
    id: "default_assistant",
    name: "Wingbuddy Pro",
    emoji: "⚡",
    tagline: "Adaptive, intelligent, and balanced all-round assistant",
    systemPrompt: `You are Wingbuddy, an exceptionally helpful, articulate, and adaptive personal AI assistant.
Balance conciseness with thorough, thoughtful explanations.
Match the user's conversational pace and provide proactive insights when helpful.
Always be polite, structured, and deliver high-value answers.`,
    preferredModel: null,
    temperature: 0.7,
    requiredTier: "free",
    capabilities: ["web_search", "image_generation", "code_execution"],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "software_architect",
    name: "Software Architect",
    emoji: "💻",
    tagline: "Staff systems engineer, clean architecture & high-performance coding",
    systemPrompt: `You are a Principal Software Architect and Staff Systems Engineer.
Your tone is technical, rigorous, and code-first.
Avoid conversational filler, pleasantries, or patronizing intros/outros.
Prioritize type safety, edge-case resilience, algorithmic efficiency (Big-O analysis), and maintainable design patterns.
Provide production-ready, clean, well-commented code snippets with appropriate syntax highlighting.
Always point out potential pitfalls, race conditions, or scalability bottlenecks.`,
    preferredModel: "mistral:ministral-14b-latest",
    temperature: 0.2,
    requiredTier: "free",
    capabilities: ["code_execution"],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "deep_researcher",
    name: "Deep Researcher",
    emoji: "🧠",
    tagline: "Academic synthesis, factual verification & multi-step investigative reasoning",
    systemPrompt: `You are an Elite Investigative Research Analyst and Academic Synthesizer.
Approach queries with rigorous fact-checking, logical breakdown, and deep contextual framing.
Present structured analyses with explicit sections: Key Findings, Evidence & Nuance, Counterarguments/Risks, and Strategic Conclusion.
Distinguish clearly between empirical consensus, emerging theories, and speculation.
Cite principles and methodologies clearly.`,
    preferredModel: "huggingface:deepseek-ai_DeepSeek-R1",
    temperature: 0.3,
    requiredTier: "pro",
    capabilities: ["web_search"],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mindfulness_coach",
    name: "Mindfulness & Life Coach",
    emoji: "🧘",
    tagline: "Empathetic listener, reflective inquiries & emotional grounding",
    systemPrompt: `You are an Empathetic Life & Mindfulness Coach.
Practice deep, active, reflective listening.
Use gentle Socratic inquiry to help the user clarify their thoughts, process emotions, and discover actionable personal insights.
Never judge, rush, or offer medical diagnoses. Offer practical grounding exercises, breathwork suggestions, and structured reflection prompts when suitable.`,
    preferredModel: null,
    temperature: 0.7,
    requiredTier: "free",
    capabilities: [],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "creative_writer",
    name: "Creative Storyteller",
    emoji: "✍️",
    tagline: "Vivid prose, narrative worldbuilding & compelling copy",
    systemPrompt: `You are an Award-Winning Creative Author, Screenwriter, and Master Copywriter.
Bring language to life with vivid sensory details, sharp dialogue, dynamic pacing, and emotional depth.
Avoid clichés and formulaic prose.
When writing fiction, build rich atmospheres and layered character motivations.
When writing copy, focus on visceral hooks, psychological resonance, and clarity.`,
    preferredModel: null,
    temperature: 0.85,
    requiredTier: "free",
    capabilities: ["image_generation"],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "language_tutor",
    name: "Polyglot Language Tutor",
    emoji: "🗣️",
    tagline: "Conversational immersion, grammar correction & cultural nuance",
    systemPrompt: `You are a Master Polyglot and Conversational Language Tutor.
Guide the user through engaging practice in their target language.
Always provide gentle, constructive corrections when grammar or vocabulary slips occur.
Include phonetic pronunciations where helpful, explain cultural idioms, and suggest more natural, native phrasing.
Adapt dynamically to the user's proficiency level (Beginner, Intermediate, Advanced).`,
    preferredModel: null,
    temperature: 0.5,
    requiredTier: "free",
    capabilities: [],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 6,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "market_strategist",
    name: "Crypto & Market Strategist",
    emoji: "📊",
    tagline: "Macroeconomic analysis, risk management & algorithmic trade framing",
    systemPrompt: `You are a Senior Quantitative Market Strategist and Crypto Ecosystem Analyst.
Deliver high-level market structure breakdowns, liquidity dynamics, macroeconomic correlation analysis, and risk-management principles.
Prioritize probabilistic thinking and capital preservation over hype.
Always clearly state: 'Educational and analytical perspectives only, not financial advice.'`,
    preferredModel: "huggingface:deepseek-ai_DeepSeek-R1",
    temperature: 0.2,
    requiredTier: "vip",
    capabilities: ["web_search"],
    isBuiltIn: true,
    enabled: true,
    sortOrder: 7,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const PERSONAS_STORAGE_KEY = "AI_PERSONAS_REGISTRY";

export class PersonaService {
  private memoryCache: AIPersona[] | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 60_000;

  private tierRank(tier: UserTier): number {
    switch (tier) {
      case "vip": return 3;
      case "pro": return 2;
      case "free":
      default: return 1;
    }
  }

  isTierEligible(userTier: UserTier, requiredTier: "free" | "pro" | "vip"): boolean {
    return this.tierRank(userTier) >= this.tierRank(requiredTier);
  }

  async getAllPersonas(forceRefresh = false): Promise<AIPersona[]> {
    if (!forceRefresh && this.memoryCache && (Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS)) {
      return this.memoryCache;
    }

    try {
      const rows = await db
        .select({ value: systemSettingsTable.value })
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.key, PERSONAS_STORAGE_KEY))
        .limit(1);

      if (rows.length > 0 && rows[0]?.value) {
        const parsed = JSON.parse(rows[0].value) as AIPersona[];
        // Merge with defaults to ensure all built-ins exist
        const merged = this.mergeWithDefaults(parsed);
        this.memoryCache = merged;
        this.cacheTimestamp = Date.now();
        return merged;
      }
    } catch (err) {
      logger.warn({ error: String(err) }, "Failed to fetch personas from DB, using defaults");
    }

    this.memoryCache = [...DEFAULT_PERSONAS];
    this.cacheTimestamp = Date.now();
    await this.persistPersonas(this.memoryCache);
    return this.memoryCache;
  }

  private mergeWithDefaults(saved: AIPersona[]): AIPersona[] {
    const savedMap = new Map<string, AIPersona>();
    for (const p of saved) {
      savedMap.set(p.id, p);
    }

    const result: AIPersona[] = [];
    // 1. Process all defaults
    for (const def of DEFAULT_PERSONAS) {
      if (savedMap.has(def.id)) {
        const s = savedMap.get(def.id)!;
        result.push({
          ...def,
          ...s,
          isBuiltIn: true,
        });
        savedMap.delete(def.id);
      } else {
        result.push({ ...def });
      }
    }

    // 2. Add remaining custom personas
    for (const custom of savedMap.values()) {
      result.push(custom);
    }

    result.sort((a, b) => a.sortOrder - b.sortOrder);
    return result;
  }

  private async persistPersonas(personas: AIPersona[]): Promise<void> {
    try {
      const payload = JSON.stringify(personas);
      await db
        .insert(systemSettingsTable)
        .values({
          key: PERSONAS_STORAGE_KEY,
          value: payload,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: {
            value: payload,
            updatedAt: new Date(),
          },
        });
      this.memoryCache = personas;
      this.cacheTimestamp = Date.now();
    } catch (err) {
      logger.error({ error: String(err) }, "Failed to persist personas registry");
    }
  }

  async getEnabledPersonas(): Promise<AIPersona[]> {
    const all = await this.getAllPersonas();
    return all.filter((p) => p.enabled);
  }

  async getPersonaById(id: string): Promise<AIPersona | null> {
    const all = await this.getAllPersonas();
    return all.find((p) => p.id === id) || null;
  }

  async savePersona(data: Partial<AIPersona> & { name: string; systemPrompt: string }): Promise<AIPersona> {
    const all = await this.getAllPersonas();
    const now = new Date().toISOString();

    let id = data.id?.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!id) {
      id = data.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    }

    const existingIndex = all.findIndex((p) => p.id === id);

    let updated: AIPersona;
    if (existingIndex >= 0) {
      const existing = all[existingIndex];
      updated = {
        ...existing,
        name: data.name.trim() || existing.name,
        emoji: data.emoji?.trim() || existing.emoji,
        tagline: data.tagline?.trim() ?? existing.tagline,
        systemPrompt: data.systemPrompt.trim() || existing.systemPrompt,
        preferredModel: data.preferredModel !== undefined ? data.preferredModel : existing.preferredModel,
        temperature: typeof data.temperature === "number" ? Math.max(0.1, Math.min(1.0, data.temperature)) : existing.temperature,
        requiredTier: data.requiredTier || existing.requiredTier,
        capabilities: data.capabilities || existing.capabilities || [],
        enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : existing.sortOrder,
        updatedAt: now,
      };
      all[existingIndex] = updated;
    } else {
      updated = {
        id,
        name: data.name.trim(),
        emoji: data.emoji?.trim() || "🎭",
        tagline: data.tagline?.trim() || "Custom AI Persona",
        systemPrompt: data.systemPrompt.trim(),
        preferredModel: data.preferredModel || null,
        temperature: typeof data.temperature === "number" ? Math.max(0.1, Math.min(1.0, data.temperature)) : 0.7,
        requiredTier: data.requiredTier || "free",
        capabilities: data.capabilities || [],
        isBuiltIn: false,
        enabled: data.enabled !== undefined ? data.enabled : true,
        sortOrder: all.length + 1,
        createdAt: now,
        updatedAt: now,
      };
      all.push(updated);
    }

    all.sort((a, b) => a.sortOrder - b.sortOrder);
    await this.persistPersonas(all);
    return updated;
  }

  async deletePersona(id: string): Promise<{ success: boolean; message: string }> {
    const all = await this.getAllPersonas();
    const target = all.find((p) => p.id === id);
    if (!target) {
      return { success: false, message: `Persona '${id}' not found` };
    }
    if (target.isBuiltIn) {
      return { success: false, message: `Built-in persona '${target.name}' cannot be deleted. You can disable it instead.` };
    }

    const filtered = all.filter((p) => p.id !== id);
    await this.persistPersonas(filtered);

    // Reset any users actively using this deleted persona back to default_assistant
    try {
      await db
        .update(usersTable)
        .set({ activePersonaId: "default_assistant", updatedAt: new Date() })
        .where(eq(usersTable.activePersonaId, id));
    } catch (err) {
      logger.warn({ error: String(err), personaId: id }, "Failed to reset deleted persona users");
    }

    return { success: true, message: `Persona '${target.name}' deleted successfully` };
  }

  async togglePersona(id: string, enabled: boolean): Promise<AIPersona | null> {
    const all = await this.getAllPersonas();
    const target = all.find((p) => p.id === id);
    if (!target) return null;

    target.enabled = enabled;
    target.updatedAt = new Date().toISOString();
    await this.persistPersonas(all);
    return target;
  }

  async getUserActivePersona(telegramUserId: number): Promise<{ persona: AIPersona; isGatedFallback?: boolean }> {
    try {
      const user = await userTierService.getUser(telegramUserId);
      const personaId = (user?.activePersonaId as string) || "default_assistant";
      const persona = await this.getPersonaById(personaId);

      const userTier = user?.tier || "free";
      if (persona && persona.enabled) {
        if (this.isTierEligible(userTier, persona.requiredTier)) {
          return { persona };
        } else {
          // Fallback to default assistant if user's tier was downgraded or is insufficient
          const defaultPersona = (await this.getPersonaById("default_assistant")) || DEFAULT_PERSONAS[0];
          return { persona: defaultPersona, isGatedFallback: true };
        }
      }
    } catch (err) {
      logger.warn({ error: String(err), telegramUserId }, "Failed to get user active persona");
    }

    const defaultPersona = (await this.getPersonaById("default_assistant")) || DEFAULT_PERSONAS[0];
    return { persona: defaultPersona };
  }

  async setUserActivePersona(
    telegramUserId: number,
    personaId: string,
  ): Promise<{ success: boolean; persona?: AIPersona; error?: string; requiresTier?: string }> {
    const persona = await this.getPersonaById(personaId);
    if (!persona) {
      return { success: false, error: `Persona '${personaId}' does not exist.` };
    }
    if (!persona.enabled) {
      return { success: false, error: `Persona '${persona.name}' is currently disabled.` };
    }

    const user = await userTierService.getUser(telegramUserId);
    const userTier = user?.tier || "free";

    if (!this.isTierEligible(userTier, persona.requiredTier)) {
      return {
        success: false,
        error: `The ${persona.emoji} ${persona.name} persona requires a ${persona.requiredTier.toUpperCase()} pass.`,
        requiresTier: persona.requiredTier,
      };
    }

    await db
      .insert(usersTable)
      .values({
        telegramUserId,
        activePersonaId: persona.id,
        personality: "playful",
        mode: "general",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usersTable.telegramUserId,
        set: {
          activePersonaId: persona.id,
          updatedAt: new Date(),
        },
      });

    logger.info({ telegramUserId, personaId: persona.id }, "User switched active AI persona");
    return { success: true, persona };
  }

  async switchUserPersona(
    telegramUserId: number,
    queryOrId: string,
  ): Promise<{ success: boolean; persona?: AIPersona; error?: string; requiresTier?: string }> {
    const q = queryOrId.trim().toLowerCase();
    const all = await this.getAllPersonas();
    
    // 1. Exact ID match
    let matched = all.find((p) => p.id.toLowerCase() === q);
    // 2. Exact Name match
    if (!matched) {
      matched = all.find((p) => p.name.toLowerCase() === q);
    }
    // 3. Substring match
    if (!matched) {
      matched = all.find((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }

    if (!matched) {
      const availableList = all.filter((p) => p.enabled).map((p) => `• <code>${p.id}</code> (${p.name})`).join("\n");
      return {
        success: false,
        error: `Persona "${queryOrId}" not found.\n\nAvailable personas:\n${availableList}`,
      };
    }

    return this.setUserActivePersona(telegramUserId, matched.id);
  }

  async resetToDefaults(): Promise<AIPersona[]> {
    this.memoryCache = [...DEFAULT_PERSONAS];
    this.cacheTimestamp = Date.now();
    await this.persistPersonas(this.memoryCache);
    return this.memoryCache;
  }

  async getSummaryStats(): Promise<{
    totalPersonas: number;
    enabledPersonas: number;
    builtInPersonas: number;
    customPersonas: number;
    personaUserCounts: Record<string, number>;
  }> {
    const all = await this.getAllPersonas();
    const enabled = all.filter((p) => p.enabled).length;
    const builtIn = all.filter((p) => p.isBuiltIn).length;
    const custom = all.filter((p) => !p.isBuiltIn).length;

    const personaUserCounts: Record<string, number> = {};
    for (const p of all) {
      personaUserCounts[p.id] = 0;
    }

    try {
      const users = await db
        .select({ activePersonaId: usersTable.activePersonaId })
        .from(usersTable);
      for (const u of users) {
        const pId = u.activePersonaId || "default_assistant";
        personaUserCounts[pId] = (personaUserCounts[pId] || 0) + 1;
      }
    } catch (err) {
      logger.warn({ error: String(err) }, "Failed to calculate persona user distribution");
    }

    return {
      totalPersonas: all.length,
      enabledPersonas: enabled,
      builtInPersonas: builtIn,
      customPersonas: custom,
      personaUserCounts,
    };
  }
}

export const personaService = new PersonaService();
