import { Router, type IRouter, type Request, type Response } from "express";
import type { AIProviderId } from "../services/ai-provider.types";
import { aiModelCatalogService } from "../services/ai-model-catalog.service";
import { unifiedModelRegistryService, type UnifiedModelRole } from "../services/unified-model-registry.service";

const router: IRouter = Router();

function normalizeRoles(value: unknown): UnifiedModelRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is UnifiedModelRole =>
    role === "primary" || role === "fast" || role === "reasoning" || role === "extraction" || role === "embedding",
  );
}

function normalizeProvider(value: unknown): AIProviderId {
  if (value === "groq" || value === "mistral") return value;
  return "gemini";
}

router.get("/models", async (_req: Request, res: Response) => {
  try {
    const models = await unifiedModelRegistryService.list();
    res.json({ timestamp: new Date().toISOString(), controlPlane: "postgresql-authoritative", models });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/models/catalog/:provider", async (req: Request, res: Response) => {
  try {
    const rawProvider = Array.isArray(req.params.provider) ? req.params.provider[0] : req.params.provider;
    const provider = normalizeProvider(rawProvider);
    if (rawProvider !== provider) {
      res.status(400).json({ error: `Unsupported provider: ${String(rawProvider)}` });
      return;
    }
    const force = req.query.refresh === "true";
    const catalog = await aiModelCatalogService.list(provider, force);
    const registered = await unifiedModelRegistryService.list();
    const registeredIds = new Set(registered.filter((model) => model.provider === provider).map((model) => model.modelId));
    res.json({ provider, timestamp: new Date().toISOString(), source: "provider_api", models: catalog, registeredModelIds: [...registeredIds] });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/models", async (req: Request, res: Response) => {
  try {
    const { modelId, name, roles, priority, capabilities } = req.body ?? {};
    if (!modelId || typeof modelId !== "string") {
      res.status(400).json({ error: "modelId is required" });
      return;
    }
    const provider = normalizeProvider(req.body?.provider);
    const catalog = await aiModelCatalogService.list(provider);
    const selected = catalog.find((item) => item.modelId === modelId.trim());
    if (!selected) {
      res.status(400).json({ error: `Model ${provider}/${modelId.trim()} is not present in the provider's current model catalog` });
      return;
    }
    const model = await unifiedModelRegistryService.add({
      provider,
      modelId: selected.modelId,
      name: typeof name === "string" && name.trim() ? name : selected.name,
      roles: normalizeRoles(roles),
      priority: typeof priority === "number" ? priority : undefined,
      capabilities: selected.capabilities.length ? selected.capabilities : (Array.isArray(capabilities) ? capabilities.filter((v): v is string => typeof v === "string") : undefined),
    });
    res.status(201).json({ message: "Model registered and saved to PostgreSQL", model, catalog: selected });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const patch = req.body ?? {};
    const current = (await unifiedModelRegistryService.list()).find((model) => model.id === id);
    if (!current) {
      res.status(404).json({ error: "Model not found" });
      return;
    }
    const provider = patch.provider ? normalizeProvider(patch.provider) : current.provider;
    const requestedModelId = typeof patch.modelId === "string" ? patch.modelId.trim() : current.modelId;
    if (requestedModelId !== current.modelId || provider !== current.provider) {
      const catalog = await aiModelCatalogService.list(provider);
      if (!catalog.some((model) => model.modelId === requestedModelId)) {
        res.status(400).json({ error: `Model ${provider}/${requestedModelId} is not present in the provider's current model catalog` });
        return;
      }
    }
    const model = await unifiedModelRegistryService.update(id, {
      ...(patch.provider ? { provider } : {}),
      ...(typeof patch.modelId === "string" ? { modelId: requestedModelId } : {}),
      ...(typeof patch.name === "string" ? { name: patch.name } : {}),
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(typeof patch.priority === "number" ? { priority: patch.priority } : {}),
      ...(Array.isArray(patch.roles) ? { roles: normalizeRoles(patch.roles) } : {}),
      ...(Array.isArray(patch.capabilities) ? { capabilities: patch.capabilities.filter((v: unknown): v is string => typeof v === "string") } : {}),
    });
    res.json({ message: "Model updated and saved to PostgreSQL", model });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/models/:id/primary", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const model = await unifiedModelRegistryService.setPrimary(id);
    res.json({ message: "Primary model updated and saved to PostgreSQL", model });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete("/models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    await unifiedModelRegistryService.remove(id);
    aiModelCatalogService.invalidate();
    res.json({ message: "Model removed from unified PostgreSQL registry" });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/models/test", async (req: Request, res: Response) => {
  try {
    const rawId = typeof req.body?.id === "string" ? req.body.id : "";
    if (rawId) {
      res.json(await unifiedModelRegistryService.test(rawId));
      return;
    }
    const modelId = typeof req.body?.modelId === "string" ? req.body.modelId.trim() : "";
    const provider = normalizeProvider(req.body?.provider);
    if (!modelId) {
      res.status(400).json({ error: "modelId is required" });
      return;
    }
    const candidate = (await unifiedModelRegistryService.list()).find((model) => model.provider === provider && model.modelId === modelId);
    if (!candidate) {
      res.status(404).json({ error: `Model ${provider}/${modelId} is not registered` });
      return;
    }
    res.json(await unifiedModelRegistryService.test(candidate.id));
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
