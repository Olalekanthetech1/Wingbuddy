import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

export type ModelRole = "primary" | "fast" | "reasoning" | "extraction" | "embedding";

export interface ManagedModel {
  id: string;
  provider: "gemini";
  modelId: string;
  name: string;
  roles: ModelRole[];
  enabled: boolean;
  priority: number;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

const REGISTRY_KEY = "GEMINI_MODEL_REGISTRY";
const ROLES: ModelRole[] = ["primary", "fast", "reasoning", "extraction", "embedding"];

function parseList(value?: string): string[] {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function makeId(modelId: string): string {
  return `gemini:${modelId}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function normalizeStoredModels(value: unknown): ManagedModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ManagedModel => Boolean(item && typeof item === "object" && typeof (item as ManagedModel).modelId === "string"));
}

export class ModelRegistryService {
  private cache: ManagedModel[] | null = null;
  private cacheAt = 0;
  private readonly cacheTtlMs = 5000;

  private buildEnvironmentRegistry(): ManagedModel[] {
    const primary = process.env.GEMINI_MODEL?.trim() || process.env.GEMINI_DEFAULT_MODEL?.trim() || "";
    const ids = unique([
      primary,
      ...parseList(process.env.GEMINI_MODEL_POOL),
      ...parseList(process.env.GEMINI_MODEL_FALLBACKS),
      process.env.GEMINI_MODEL_FAST?.trim() || "",
      process.env.GEMINI_MODEL_REASONING?.trim() || "",
      process.env.GEMINI_MODEL_EXTRACTION?.trim() || "",
      process.env.GEMINI_EMBEDDING_MODEL?.trim() || "",
    ].filter(Boolean));
    const now = new Date().toISOString();
    return ids.map((modelId, priority) => ({
      id: makeId(modelId), provider: "gemini", modelId, name: modelId,
      roles: unique([
        modelId === primary ? "primary" : undefined,
        modelId === process.env.GEMINI_MODEL_FAST?.trim() ? "fast" : undefined,
        modelId === process.env.GEMINI_MODEL_REASONING?.trim() ? "reasoning" : undefined,
        modelId === process.env.GEMINI_MODEL_EXTRACTION?.trim() ? "extraction" : undefined,
        modelId === process.env.GEMINI_EMBEDDING_MODEL?.trim() ? "embedding" : undefined,
      ].filter((v): v is ModelRole => typeof v === "string")),
      enabled: true, priority,
      capabilities: modelId === process.env.GEMINI_EMBEDDING_MODEL?.trim() ? ["embedding"] : ["generate"],
      createdAt: now, updatedAt: now,
    }));
  }

  private async read(): Promise<ManagedModel[]> {
    if (this.cache && Date.now() - this.cacheAt < this.cacheTtlMs) return this.cache;
    try {
      const rows = await db.select({ value: systemSettingsTable.value })
        .from(systemSettingsTable)
        .where(eq(systemSettingsTable.key, REGISTRY_KEY))
        .limit(1);
      if (rows[0]?.value) {
        // Once persisted, PostgreSQL is authoritative. Environment values are
        // only the bootstrap source for first initialization/migration.
        this.cache = normalizeStoredModels(JSON.parse(rows[0].value)).sort((a, b) => a.priority - b.priority);
        this.cacheAt = Date.now();
        return this.cache;
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to read Gemini model registry from PostgreSQL");
    }
    this.cache = this.buildEnvironmentRegistry();
    this.cacheAt = Date.now();
    return this.cache;
  }

  private async persist(models: ManagedModel[]): Promise<void> {
    await db.insert(systemSettingsTable)
      .values({ key: REGISTRY_KEY, value: JSON.stringify(models), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(models), updatedAt: new Date() },
      });
    this.cache = models;
    this.cacheAt = Date.now();
  }

  private syncRuntime(models: ManagedModel[]): void {
    const enabled = models.filter((m) => m.enabled && m.provider === "gemini");
    const first = (role: ModelRole) => enabled.filter((m) => m.roles.includes(role)).sort((a, b) => a.priority - b.priority)[0];
    const primary = first("primary") || enabled[0];
    const fast = first("fast");
    const reasoning = first("reasoning");
    const extraction = first("extraction");
    const embedding = first("embedding");
    const executable = enabled.filter((m) => !m.roles.includes("embedding"));

    process.env.GEMINI_MODEL = primary?.modelId || "";
    process.env.GEMINI_MODEL_POOL = executable.map((m) => m.modelId).join(",");
    process.env.GEMINI_MODEL_FALLBACKS = executable.filter((m) => m.id !== primary?.id).map((m) => m.modelId).join(",");
    process.env.GEMINI_MODEL_FAST = fast?.modelId || "";
    process.env.GEMINI_MODEL_REASONING = reasoning?.modelId || "";
    process.env.GEMINI_MODEL_EXTRACTION = extraction?.modelId || "";
    if (embedding) process.env.GEMINI_EMBEDDING_MODEL = embedding.modelId;
  }

  async list(): Promise<ManagedModel[]> {
    const models = await this.read();
    return models.map((m) => ({ ...m, roles: [...m.roles], capabilities: [...m.capabilities] }));
  }

  async add(input: { modelId: string; name?: string; roles?: ModelRole[]; priority?: number; capabilities?: string[] }): Promise<ManagedModel> {
    const modelId = input.modelId.trim();
    if (!modelId) throw new Error("modelId is required");
    const models = await this.read();
    if (models.some((m) => m.provider === "gemini" && m.modelId === modelId)) throw new Error(`Model ${modelId} is already registered.`);
    const now = new Date().toISOString();
    const model: ManagedModel = {
      id: makeId(modelId), provider: "gemini", modelId,
      name: input.name?.trim() || modelId,
      roles: unique((input.roles || []).filter((role) => ROLES.includes(role))),
      enabled: true,
      priority: Number.isFinite(input.priority) ? Number(input.priority) : models.length,
      capabilities: unique(input.capabilities?.length ? input.capabilities : ["generate"]),
      createdAt: now, updatedAt: now,
    };
    const next = [...models, model].sort((a, b) => a.priority - b.priority);
    await this.persist(next); this.syncRuntime(next); return model;
  }

  async update(id: string, patch: Partial<Pick<ManagedModel, "name" | "roles" | "enabled" | "priority" | "capabilities">>): Promise<ManagedModel> {
    const models = await this.read();
    const index = models.findIndex((m) => m.id === id);
    if (index < 0) throw new Error("Model not found");
    const updated: ManagedModel = {
      ...models[index], ...patch,
      roles: patch.roles ? unique(patch.roles.filter((role) => ROLES.includes(role))) : models[index].roles,
      updatedAt: new Date().toISOString(),
    };
    const next = models.map((m, i) => i === index ? updated : m).sort((a, b) => a.priority - b.priority);
    await this.persist(next); this.syncRuntime(next); return updated;
  }

  async remove(id: string): Promise<void> {
    const models = await this.read();
    const next = models.filter((m) => m.id !== id);
    if (next.length === models.length) throw new Error("Model not found");
    await this.persist(next); this.syncRuntime(next);
  }

  async test(modelId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const key = process.env.GEMINI_API_KEY?.split(/[,\s\n]+/).map((v) => v.trim()).find(Boolean);
    if (!key) throw new Error("No Gemini API key is configured");
    const start = Date.now();
    try {
      const client = new GoogleGenAI({ apiKey: key });
      await client.models.generateContent({ model: modelId, contents: [{ role: "user", parts: [{ text: "ping" }] }], config: { maxOutputTokens: 4 } });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const modelRegistryService = new ModelRegistryService();
