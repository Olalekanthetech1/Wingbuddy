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
  return value
    .filter((item): item is ManagedModel => Boolean(item && typeof item === "object" && typeof (item as ManagedModel).modelId === "string"))
    .map((item) => {
      const roles = unique((Array.isArray(item.roles) ? item.roles : []).filter((role): role is ModelRole => ROLES.includes(role)));
      return {
        ...item,
        id: item.id || makeId(item.modelId),
        provider: "gemini",
        name: item.name || item.modelId,
        roles: roles.includes("embedding") ? roles.filter((role) => role !== "primary") : roles,
        enabled: item.enabled !== false,
        priority: Number.isFinite(item.priority) ? item.priority : 0,
        capabilities: unique(Array.isArray(item.capabilities) ? item.capabilities.filter((v): v is string => typeof v === "string") : ["generate"]),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      };
    });
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
      ].filter((v): v is ModelRole => typeof v === "string")).filter((role) => !(modelId === process.env.GEMINI_EMBEDDING_MODEL?.trim() && role === "primary")),
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
        const models = normalizeStoredModels(JSON.parse(rows[0].value)).sort((a, b) => a.priority - b.priority);
        this.cache = this.ensureSinglePrimary(models);
        this.cacheAt = Date.now();
        this.syncRuntime(this.cache);
        return this.cache;
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to read Gemini model registry from PostgreSQL");
    }
    this.cache = this.ensureSinglePrimary(this.buildEnvironmentRegistry());
    this.cacheAt = Date.now();
    return this.cache;
  }

  private ensureSinglePrimary(models: ManagedModel[]): ManagedModel[] {
    let foundPrimary = false;
    return models.map((model) => {
      const cleanRoles = model.roles.filter((role) => !(model.roles.includes("embedding") && role === "primary"));
      if (!cleanRoles.includes("primary")) return { ...model, roles: cleanRoles };
      if (foundPrimary || !model.enabled) return { ...model, roles: cleanRoles.filter((role) => role !== "primary") };
      foundPrimary = true;
      return { ...model, roles: cleanRoles };
    });
  }

  private async persist(models: ManagedModel[]): Promise<void> {
    const normalized = this.ensureSinglePrimary(models).sort((a, b) => a.priority - b.priority);
    await db.insert(systemSettingsTable)
      .values({ key: REGISTRY_KEY, value: JSON.stringify(normalized), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value: JSON.stringify(normalized), updatedAt: new Date() },
      });
    this.cache = normalized;
    this.cacheAt = Date.now();
    this.syncRuntime(normalized);
  }

  private syncRuntime(models: ManagedModel[]): void {
    const enabled = models.filter((m) => m.enabled && m.provider === "gemini" && !m.roles.includes("embedding"));
    const first = (role: ModelRole) => enabled.filter((m) => m.roles.includes(role)).sort((a, b) => a.priority - b.priority)[0];
    const primary = first("primary") || enabled[0];
    const fast = first("fast");
    const reasoning = first("reasoning");
    const extraction = first("extraction");
    const embedding = models.filter((m) => m.enabled && m.provider === "gemini" && m.roles.includes("embedding")).sort((a, b) => a.priority - b.priority)[0];
    const executable = enabled;

    process.env.GEMINI_MODEL = primary?.modelId || "";
    process.env.GEMINI_MODEL_POOL = executable.map((m) => m.modelId).join(",");
    process.env.GEMINI_MODEL_FALLBACKS = executable.filter((m) => m.id !== primary?.id).map((m) => m.modelId).join(",");
    process.env.GEMINI_MODEL_FAST = fast?.modelId || "";
    process.env.GEMINI_MODEL_REASONING = reasoning?.modelId || "";
    process.env.GEMINI_MODEL_EXTRACTION = extraction?.modelId || "";
    process.env.GEMINI_EMBEDDING_MODEL = embedding?.modelId || "";
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
    const hasPrimary = models.some((m) => m.enabled && m.roles.includes("primary"));
    const requestedRoles = unique((input.roles || []).filter((role): role is ModelRole => ROLES.includes(role)));
    if (!hasPrimary && !requestedRoles.includes("embedding")) requestedRoles.push("primary");
    if (requestedRoles.includes("primary") && requestedRoles.includes("embedding")) throw new Error("Embedding models cannot be primary.");
    const model: ManagedModel = {
      id: makeId(modelId), provider: "gemini", modelId,
      name: input.name?.trim() || modelId,
      roles: unique(requestedRoles),
      enabled: true,
      priority: Number.isFinite(input.priority) ? Number(input.priority) : models.length,
      capabilities: unique(input.capabilities?.length ? input.capabilities : (requestedRoles.includes("embedding") ? ["embedding"] : ["generate"])),
      createdAt: now, updatedAt: now,
    };
    const base = model.roles.includes("primary")
      ? models.map((m) => ({ ...m, roles: m.roles.filter((role) => role !== "primary") }))
      : models;
    const next = this.ensureSinglePrimary([...base, model]);
    await this.persist(next);
    return next.find((m) => m.id === model.id)!;
  }

  async update(id: string, patch: Partial<Pick<ManagedModel, "modelId" | "name" | "roles" | "enabled" | "priority" | "capabilities">>): Promise<ManagedModel> {
    const models = await this.read();
    const index = models.findIndex((m) => m.id === id);
    if (index < 0) throw new Error("Model not found");
    const current = models[index];
    const nextModelId = patch.modelId?.trim() || current.modelId;
    if (!nextModelId) throw new Error("modelId is required");
    if (models.some((m, i) => i !== index && m.modelId === nextModelId)) throw new Error(`Model ${nextModelId} is already registered.`);
    const roles = patch.roles ? unique(patch.roles.filter((role): role is ModelRole => ROLES.includes(role))) : current.roles;
    if (roles.includes("primary") && roles.includes("embedding")) throw new Error("Embedding models cannot be primary.");
    if (roles.includes("primary") && patch.enabled === false) throw new Error("The primary model must remain enabled.");
    if (current.roles.includes("primary") && !roles.includes("primary")) throw new Error("Select another primary model before removing the primary role.");
    if (current.roles.includes("primary") && patch.enabled === false) throw new Error("Select another primary model before disabling the current primary.");
    const updated: ManagedModel = {
      ...current,
      ...patch,
      id: makeId(nextModelId),
      modelId: nextModelId,
      name: patch.name?.trim() || current.name,
      roles,
      updatedAt: new Date().toISOString(),
    };
    const base = models.map((m, i) => i === index ? updated : m);
    const normalized = roles.includes("primary") ? base.map((m, i) => i === index ? m : ({ ...m, roles: m.roles.filter((role) => role !== "primary") })) : base;
    await this.persist(normalized);
    return updated;
  }

  async setPrimary(id: string): Promise<ManagedModel> {
    const models = await this.read();
    const target = models.find((m) => m.id === id);
    if (!target) throw new Error("Model not found");
    if (!target.enabled) throw new Error("Enable the model before making it primary.");
    if (target.roles.includes("embedding")) throw new Error("Embedding models cannot be primary.");
    const next = models.map((m) => ({ ...m, roles: m.id === id ? unique([...m.roles.filter((r) => r !== "primary"), "primary"]) : m.roles.filter((r) => r !== "primary") }));
    await this.persist(next);
    return next.find((m) => m.id === id)!;
  }

  async remove(id: string): Promise<void> {
    const models = await this.read();
    const target = models.find((m) => m.id === id);
    if (!target) throw new Error("Model not found");
    if (target.roles.includes("primary")) throw new Error("Select another primary model before deleting the current primary.");
    const next = models.filter((m) => m.id !== id);
    await this.persist(next);
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
