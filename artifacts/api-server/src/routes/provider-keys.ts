import { Router, type IRouter, type Request, type Response } from "express";
import type { AIProviderId } from "../services/ai-provider.types";
import { aiProviderRegistryService } from "../services/ai-provider-registry.service";
import { aiProviderKeyPoolService, type ProviderKeyRotationMode } from "../services/ai-provider-key-pool.service";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const PROVIDERS = new Set<AIProviderId>(["gemini", "groq", "mistral"]);
function providerOf(value: unknown): AIProviderId { const normalized = String(value || "").trim().toLowerCase() as AIProviderId; if (!PROVIDERS.has(normalized)) throw new Error("Unsupported provider"); return normalized; }

router.get("/provider-keys", async (req: Request, res: Response) => {
  try {
    const provider = providerOf(req.query.provider || "gemini");
    const record = await aiProviderRegistryService.get(provider);
    await aiProviderKeyPoolService.hydrateProvider(provider, record.apiKeyEnv);
    res.json(aiProviderKeyPoolService.getSummary(provider));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/provider-keys", async (req: Request, res: Response) => {
  try {
    const providerId = providerOf(req.body?.provider || "gemini");
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
    const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    if (!key) { res.status(400).json({ error: "Missing required field 'key'" }); return; }
    if (!model) { res.status(400).json({ error: "Missing required field 'model' for key validation" }); return; }
    const provider = await aiProviderRegistryService.get(providerId);
    if (!provider.enabled) { res.status(409).json({ error: `Provider ${providerId} is disabled` }); return; }
    const adapter = aiProviderRegistryService.getAdapter(provider.adapter);
    const validation = await adapter.test(model, provider, key);
    if (!validation.ok) { res.status(400).json({ error: validation.error || "Provider API key validation failed", validation }); return; }
    const saved = await aiProviderKeyPoolService.addKey(providerId, key, name);
    res.status(201).json({ message: "Provider API key validated and securely saved", key: saved, poolSummary: aiProviderKeyPoolService.getSummary(providerId) });
  } catch (error) { logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Provider API key add failed"); res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.delete("/provider-keys/:id", async (req: Request, res: Response) => {
  try { const removed = await aiProviderKeyPoolService.removeKey(req.params.id); if (!removed) { res.status(404).json({ error: "Provider API key not found" }); return; } res.json({ message: "Provider API key removed" }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.patch("/provider-keys/:id/toggle", async (req: Request, res: Response) => {
  try { const updated = await aiProviderKeyPoolService.toggleKey(req.params.id); if (!updated) { res.status(404).json({ error: "Provider API key not found" }); return; } res.json({ message: "Provider API key state updated", key: updated }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/provider-keys/mode", async (req: Request, res: Response) => {
  const mode = req.body?.mode as ProviderKeyRotationMode;
  if (mode !== "round_robin" && mode !== "failover") { res.status(400).json({ error: "Invalid key rotation mode" }); return; }
  try { await aiProviderKeyPoolService.setRotationMode(mode); res.json({ message: "Provider key rotation mode persisted", rotationMode: mode }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.get("/provider-keys/summary/all", async (_req: Request, res: Response) => {
  try {
    const result: Record<string, unknown> = {};
    for (const providerId of ["gemini", "groq", "mistral"] as AIProviderId[]) {
      const provider = await aiProviderRegistryService.get(providerId);
      await aiProviderKeyPoolService.hydrateProvider(providerId, provider.apiKeyEnv);
      result[providerId] = aiProviderKeyPoolService.getSummary(providerId);
    }
    res.json({ providers: result });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

export default router;