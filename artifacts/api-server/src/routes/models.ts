import { Router, type IRouter, type Request, type Response } from "express";
import { modelRegistryService, type ModelRole } from "../services/model-registry.service";

const router: IRouter = Router();

function normalizeRoles(value: unknown): ModelRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is ModelRole =>
    role === "primary" || role === "fast" || role === "reasoning" || role === "extraction" || role === "embedding",
  );
}

router.get("/models", async (_req: Request, res: Response) => {
  try {
    const models = await modelRegistryService.list();
    res.json({ timestamp: new Date().toISOString(), models });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/models", async (req: Request, res: Response) => {
  try {
    const { modelId, name, roles, priority, capabilities } = req.body ?? {};
    if (!modelId || typeof modelId !== "string") {
      res.status(400).json({ error: "modelId is required" });
      return;
    }
    const model = await modelRegistryService.add({
      modelId,
      name: typeof name === "string" ? name : undefined,
      roles: normalizeRoles(roles),
      priority: typeof priority === "number" ? priority : undefined,
      capabilities: Array.isArray(capabilities) ? capabilities.filter((v): v is string => typeof v === "string") : undefined,
    });
    res.status(201).json({ message: "Model registered and saved to PostgreSQL", model });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const patch = req.body ?? {};
    const model = await modelRegistryService.update(id, {
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

router.delete("/models/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    await modelRegistryService.remove(id);
    res.json({ message: "Model removed from registry and PostgreSQL" });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/models/test", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.body ?? {};
    if (!modelId || typeof modelId !== "string") {
      res.status(400).json({ error: "modelId is required" });
      return;
    }
    const result = await modelRegistryService.test(modelId.trim());
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
