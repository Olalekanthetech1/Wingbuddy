import { Router, type IRouter, type Request, type Response } from "express";
import { aiProviderRegistryService } from "../services/ai-provider-registry.service";
import type { AIProviderCapability, AIProviderId } from "../services/ai-provider.types";

const router: IRouter = Router();
const CAPABILITIES: AIProviderCapability[] = ["chat", "streaming", "tool_calling", "vision", "reasoning", "long_context", "web_search", "image_generation", "video_generation", "audio_generation"];

router.get("/providers", async (_req: Request, res: Response) => {
  try {
    res.json({ timestamp: new Date().toISOString(), providers: await aiProviderRegistryService.list() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/providers/:id", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!aiProviderRegistryService.isKnownProvider(id)) {
      res.status(404).json({ error: `Unknown AI provider: ${id}` });
      return;
    }
    const body = req.body ?? {};
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter((value: unknown): value is AIProviderCapability => CAPABILITIES.includes(value as AIProviderCapability))
      : undefined;
    const provider = await aiProviderRegistryService.update(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {}),
      ...(capabilities ? { capabilities } : {}),
    });
    res.json({ message: "Provider updated and saved to PostgreSQL", provider });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/providers/:id/test", async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!aiProviderRegistryService.isKnownProvider(id)) {
      res.status(404).json({ error: `Unknown AI provider: ${id}` });
      return;
    }
    const provider = await aiProviderRegistryService.get(id);
    const requiresModel = (provider.capabilities || []).includes("chat");
    const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    if (requiresModel && !model) {
      res.status(400).json({ error: "model is required for chat provider testing" });
      return;
    }
    res.json(await aiProviderRegistryService.test(id, model));
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
