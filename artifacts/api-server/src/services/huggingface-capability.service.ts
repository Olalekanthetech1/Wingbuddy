import { logger } from "../lib/logger";

export type HuggingFaceTask = "text-to-image" | "text-to-video";

export interface HuggingFaceProviderMapping {
  provider: string;
  status?: string;
  providerId?: string;
  task?: string;
}

export interface HuggingFaceDiscoveredModel {
  id: string;
  pipelineTag?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  providers?: HuggingFaceProviderMapping[];
}

interface CacheEntry {
  expiresAt: number;
  models: HuggingFaceDiscoveredModel[];
}

const HUB_API = "https://huggingface.co/api/models";
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const PROVIDER_MAPPING_TIMEOUT_MS = 8_000;
const LIMIT = 40;

function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseProviderMappings(payload: unknown): HuggingFaceProviderMapping[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as Record<string, unknown>).inferenceProviderMapping;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>).map(([provider, value]) => {
    if (!value || typeof value !== "object") return { provider };
    const item = value as Record<string, unknown>;
    return {
      provider,
      status: typeof item.status === "string" ? item.status : undefined,
      providerId: typeof item.providerId === "string" ? item.providerId : undefined,
      task: typeof item.task === "string" ? item.task : undefined,
    } satisfies HuggingFaceProviderMapping;
  });
}

function parseModels(payload: unknown): HuggingFaceDiscoveredModel[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((row) => {
    if (!row || typeof row !== "object") return undefined;
    const item = row as Record<string, unknown>;
    const id = normalizeModelId(item.id);
    if (!id) return undefined;
    return {
      id,
      pipelineTag: typeof item.pipeline_tag === "string" ? item.pipeline_tag : undefined,
      downloads: typeof item.downloads === "number" ? item.downloads : undefined,
      likes: typeof item.likes === "number" ? item.likes : undefined,
      lastModified: typeof item.lastModified === "string" ? item.lastModified : undefined,
    } satisfies HuggingFaceDiscoveredModel;
  }).filter((item): item is HuggingFaceDiscoveredModel => Boolean(item));
}

async function fetchProviderMappings(modelId: string): Promise<HuggingFaceProviderMapping[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_MAPPING_TIMEOUT_MS);
  try {
    const response = await fetch(`${HUB_API}/${modelId}?expand=inferenceProviderMapping`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    return parseProviderMappings(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export class HuggingFaceCapabilityService {
  private readonly cache = new Map<HuggingFaceTask, CacheEntry>();

  private async discover(task: HuggingFaceTask): Promise<HuggingFaceDiscoveredModel[]> {
    const cached = this.cache.get(task);
    if (cached && cached.expiresAt > Date.now()) return cached.models;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = `${HUB_API}?inference_provider=all&pipeline_tag=${encodeURIComponent(task)}&limit=${LIMIT}`;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HF capability discovery failed (${response.status})`);
      const models = parseModels(await response.json());
      if (!models.length) throw new Error(`HF returned no served ${task} models`);

      const enriched = await Promise.all(models.slice(0, 20).map(async (model) => ({
        ...model,
        providers: await fetchProviderMappings(model.id),
      })));

      this.cache.set(task, { expiresAt: Date.now() + CACHE_TTL_MS, models: enriched });
      logger.info({ task, count: enriched.length, mapped: enriched.filter((model) => (model.providers?.length || 0) > 0).length }, "Hugging Face capability discovery refreshed");
      return enriched;
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveModel(task: HuggingFaceTask, preferredModel?: string): Promise<{ model: string; discovered: boolean; preferredAvailable: boolean; candidates: HuggingFaceDiscoveredModel[] }> {
    try {
      const candidates = await this.discover(task);
      const preferred = normalizeModelId(preferredModel);
      const liveCandidates = candidates.filter((model) => !model.providers?.length || model.providers.some((provider) => provider.status === "live" || provider.status === "staging"));

      if (preferred) {
        const match = liveCandidates.find((model) => model.id === preferred);
        if (match) return { model: match.id, discovered: true, preferredAvailable: true, candidates: liveCandidates };
      }

      const selected = liveCandidates[0];
      if (!selected) throw new Error(`No live Hugging Face ${task} model is currently served by an inference provider`);
      return { model: selected.id, discovered: true, preferredAvailable: false, candidates: liveCandidates };
    } catch (error) {
      const preferred = normalizeModelId(preferredModel);
      if (preferred) {
        logger.warn({ task, preferredModel: preferred, error: String(error) }, "Hugging Face discovery unavailable; using explicitly configured model");
        return { model: preferred, discovered: false, preferredAvailable: true, candidates: [] };
      }
      throw error;
    }
  }

  invalidate(task?: HuggingFaceTask): void {
    if (task) this.cache.delete(task);
    else this.cache.clear();
  }
}

export const huggingFaceCapabilityService = new HuggingFaceCapabilityService();
