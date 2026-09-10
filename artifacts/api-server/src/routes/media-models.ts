import { Router, type IRouter, type Request, type Response } from "express";
import { aiModelCatalogService } from "../services/ai-model-catalog.service";
import { aiProviderRegistryService } from "../services/ai-provider-registry.service";
import { aiProviderGatewayService } from "../services/ai-provider-gateway.service";
import { unifiedModelRegistryService } from "../services/unified-model-registry.service";
import { huggingFaceCapabilityService } from "../services/huggingface-capability.service";
import type { AIProviderId } from "../services/ai-provider.types";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MEDIA_CAPABILITIES = new Set(["image_generation", "video_generation"]);

type MediaCapability = "image_generation" | "video_generation";
type MediaCatalogEntry = { provider: AIProviderId; modelId: string; name: string; status: "active" | "inactive" | "unknown" | "live"; capabilities: string[]; contextWindow?: number; source: string };

function resolveCapability(value: unknown): MediaCapability {
  const capability = String(value || "").trim().toLowerCase();
  if (!MEDIA_CAPABILITIES.has(capability)) throw new Error("Media capability must be image_generation or video_generation");
  return capability as MediaCapability;
}

async function resolveProvider(value: unknown): Promise<AIProviderId> {
  const providerId = String(value || "").trim().toLowerCase();
  if (!providerId) throw new Error("Provider is required");
  const provider = await aiProviderRegistryService.get(providerId as AIProviderId);
  return provider.id;
}

async function discoverCatalog(provider: AIProviderId, capability: MediaCapability, refresh: boolean): Promise<{ models: MediaCatalogEntry[]; source: string }> {
  if (provider === "huggingface") {
    const task = capability === "image_generation" ? "text-to-image" : "text-to-video";
    const discovery = await huggingFaceCapabilityService.resolveModel(task);
    return {
      source: "huggingface_capability_discovery",
      models: discovery.candidates.map((model) => ({
        provider,
        modelId: model.id,
        name: model.id,
        status: "live",
        capabilities: [capability],
        source: "huggingface_capability_discovery",
      })),
    };
  }
  const models = await aiModelCatalogService.list(provider, refresh);
  return { source: "provider_api", models: models.filter((model) => model.capabilities.includes(capability)).map((model) => ({ ...model })) };
}

router.get("/media-models", async (req: Request, res: Response) => {
  try {
    const capability = req.query.capability ? resolveCapability(req.query.capability) : undefined;
    const models = await unifiedModelRegistryService.list();
    const filtered = capability
      ? models.filter((model) => model.capabilities.includes(capability))
      : models.filter((model) => model.capabilities.some((item) => MEDIA_CAPABILITIES.has(item)));
    res.json({ timestamp: new Date().toISOString(), controlPlane: "postgresql-authoritative", capability: capability || null, models: filtered });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/media-models/catalog/:provider", async (req: Request, res: Response) => {
  try {
    const provider = await resolveProvider(req.params.provider);
    const capability = resolveCapability(req.query.capability);
    const discovered = await discoverCatalog(provider, capability, req.query.refresh === "true");
    const registered = await unifiedModelRegistryService.list();
    const registeredIds = new Set(registered.filter((model) => model.provider === provider && model.capabilities.includes(capability)).map((model) => model.modelId));
    res.json({ provider, capability, timestamp: new Date().toISOString(), source: discovered.source, models: discovered.models, registeredModelIds: [...registeredIds] });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/media-models", async (req: Request, res: Response) => {
  try {
    const provider = await resolveProvider(req.body?.provider);
    const capability = resolveCapability(req.body?.capability);
    const modelId = typeof req.body?.modelId === "string" ? req.body.modelId.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const priority = typeof req.body?.priority === "number" && Number.isFinite(req.body.priority) ? req.body.priority : undefined;
    if (!modelId) throw new Error("modelId is required");

    const discovered = await discoverCatalog(provider, capability, true);
    const selected = discovered.models.find((model) => model.modelId === modelId);
    if (!selected) throw new Error(`${provider}/${modelId} is not currently available for ${capability}`);

    const model = await unifiedModelRegistryService.add({ provider, modelId, name: name || selected.name || modelId, priority, capabilities: [capability], roles: [] });
    res.status(201).json({ message: "Media model registered in PostgreSQL", model });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/media-models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const current = (await unifiedModelRegistryService.list()).find((model) => model.id === rawId);
    if (!current || !current.capabilities.some((item) => MEDIA_CAPABILITIES.has(item))) throw new Error("Media model not found");
    const patch = req.body ?? {};
    const allowed: Record<string, unknown> = {};
    if (typeof patch.name === "string") allowed.name = patch.name.trim();
    if (typeof patch.enabled === "boolean") allowed.enabled = patch.enabled;
    if (typeof patch.priority === "number" && Number.isFinite(patch.priority)) allowed.priority = patch.priority;
    if (Object.keys(allowed).length === 0) throw new Error("No supported media model changes supplied");
    const model = await unifiedModelRegistryService.update(rawId, allowed);
    res.json({ message: "Media model updated in PostgreSQL", model });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/media-models/:id/preferred", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const models = await unifiedModelRegistryService.list();
    const target = models.find((model) => model.id === rawId);
    if (!target) throw new Error("Media model not found");
    const capability = target.capabilities.find((item) => MEDIA_CAPABILITIES.has(item));
    if (!capability) throw new Error("Selected model is not a registered media model");
    if (!target.enabled) throw new Error("Enable the model before making it preferred");
    const peers = models.filter((model) => model.enabled && model.capabilities.includes(capability) && model.id !== target.id);
    const nextPriority = peers.length ? Math.min(...peers.map((model) => model.priority)) : target.priority;
    const updated = await unifiedModelRegistryService.update(target.id, { priority: Math.max(0, nextPriority - 1) });
    res.json({ message: `Preferred ${capability === "image_generation" ? "image" : "video"} model updated`, model: updated });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete("/media-models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const target = (await unifiedModelRegistryService.list()).find((model) => model.id === rawId);
    if (!target || !target.capabilities.some((item) => MEDIA_CAPABILITIES.has(item))) throw new Error("Media model not found");
    await unifiedModelRegistryService.remove(rawId);
    res.json({ message: "Media model removed from PostgreSQL registry" });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/media-models/:id/test", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const target = (await unifiedModelRegistryService.list()).find((model) => model.id === rawId);
    if (!target || !target.capabilities.some((item) => MEDIA_CAPABILITIES.has(item))) throw new Error("Media model not found");
    if (!target.enabled) throw new Error("Enable the model before testing it");
    const capability = target.capabilities.includes("image_generation") ? "image_generation" : "video_generation";
    const prompt = capability === "image_generation" ? "A simple studio test image of a red geometric cube on a clean background" : "A simple cinematic test clip of a red ball moving across a clean studio floor";
    const execution = capability === "image_generation"
      ? await aiProviderGatewayService.generateImage(target.provider, { model: target.modelId, prompt, width: 256, height: 256, metadata: { dashboardTest: true } })
      : await aiProviderGatewayService.generateVideo(target.provider, { model: target.modelId, prompt, metadata: { dashboardTest: true } });
    if (!execution.result?.buffer?.length) throw new Error("Provider returned no media bytes");
    const buffer = execution.result.buffer;
    if (capability === "video_generation") {
      const isMp4 = buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70;
      const isWebm = buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
      if (!isMp4 && !isWebm) throw new Error("Provider returned bytes that are not a recognized video container");
    }
    res.json({ ok: true, capability, provider: target.provider, model: target.modelId, bytes: buffer.length, latencyMs: Date.now() - startedAt });
  } catch (error) {
    logger.warn({ error: String(error), durationMs: Date.now() - startedAt }, "Dashboard media model test failed");
    res.status(400).json({ ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
