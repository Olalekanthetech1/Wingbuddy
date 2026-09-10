import { logger } from "../lib/logger";

export type HuggingFaceTask = "text-to-image" | "text-to-video";

export interface HuggingFaceDiscoveredModel {
  id: string;
  pipelineTag?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
}

interface CacheEntry {
  expiresAt: number;
  models: HuggingFaceDiscoveredModel[];
}

const HUB_API = "https://huggingface.co/api/models";
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const LIMIT = 40;

function normalizeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseModels(payload: unknown): HuggingFaceDiscoveredModel[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => {
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
    })
    .filter((item): item is HuggingFaceDiscoveredModel => Boolean(item));
}

export class HuggingFaceCapabilityService {
  private readonly cache = new Map<HuggingFaceTask, CacheEntry>();

  private async discover(task: HuggingFaceTask): Promise<HuggingFaceDiscoveredModel[]> {
    const cached = this.cache.get(task);
    if (cached && cached.expiresAt > Date.now()) return cached.models;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = `${HUB_API}?inference_provider=all&pipeline_tag=${encodeURIComponent(task)}&sort=trending_score&direction=-1&limit=${LIMIT}`;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HF capability discovery failed (${response.status})`);
      const models = parseModels(await response.json());
      if (!models.length) throw new Error(`HF returned no served ${task} models`);
      this.cache.set(task, { expiresAt: Date.now() + CACHE_TTL_MS, models });
      logger.info({ task, count: models.length }, "Hugging Face capability discovery refreshed");
      return models;
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveModel(task: HuggingFaceTask, preferredModel?: string): Promise<{ model: string; discovered: boolean; preferredAvailable: boolean; candidates: HuggingFaceDiscoveredModel[] }> {
    try {
      const candidates = await this.discover(task);
      const preferred = normalizeModelId(preferredModel);
      if (preferred) {
        const match = candidates.find((model) => model.id === preferred);
        if (match) return { model: match.id, discovered: true, preferredAvailable: true, candidates };
      }
      const selected = candidates[0];
      return { model: selected.id, discovered: true, preferredAvailable: false, candidates };
    } catch (error) {
      const preferred = normalizeModelId(preferredModel);
      if (preferred) {
        logger.warn({ task, preferredModel: preferred, error: String(error) }, "Hugging Face discovery unavailable; using configured model");
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
