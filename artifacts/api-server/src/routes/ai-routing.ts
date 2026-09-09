import { Router, type IRouter, type Request, type Response } from "express";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
import { aiObservabilityService } from "../services/ai-observability.service";
import type { AIProviderId } from "../services/ai-provider.types";

const router: IRouter = Router();

function provider(value: unknown): AIProviderId | undefined {
  return value === "gemini" || value === "groq" || value === "mistral" ? value : undefined;
}

router.get("/ai/routing/policy", async (_req: Request, res: Response) => {
  res.json({ timestamp: new Date().toISOString(), policy: await adaptiveAIRouterService.getPolicy() });
});

router.patch("/ai/routing/policy", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const policy = await adaptiveAIRouterService.setPolicy({
      ...(body.strategy ? { strategy: body.strategy } : {}),
      ...(typeof body.capabilityWeight === "number" ? { capabilityWeight: body.capabilityWeight } : {}),
      ...(typeof body.healthWeight === "number" ? { healthWeight: body.healthWeight } : {}),
      ...(typeof body.latencyWeight === "number" ? { latencyWeight: body.latencyWeight } : {}),
      ...(typeof body.priorityWeight === "number" ? { priorityWeight: body.priorityWeight } : {}),
      ...(typeof body.maxAttempts === "number" ? { maxAttempts: body.maxAttempts } : {}),
    });
    res.json({ message: "Adaptive routing policy saved to PostgreSQL", policy });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/ai/routing/candidates", async (req: Request, res: Response) => {
  try {
    res.json({
      timestamp: new Date().toISOString(),
      candidates: await adaptiveAIRouterService.candidates({
        mode: typeof req.query.mode === "string" ? req.query.mode : undefined,
        isDeepReasoning: req.query.isDeepReasoning === "true",
        isExtraction: req.query.isExtraction === "true",
        enableSearch: req.query.enableSearch === "true",
        requiresVision: req.query.requiresVision === "true",
        requiresTools: req.query.requiresTools === "true",
        preferredProvider: provider(req.query.provider),
        preferredModelId: typeof req.query.modelId === "string" ? req.query.modelId : undefined,
      }),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/ai/routing/health", async (_req: Request, res: Response) => {
  res.json({ timestamp: new Date().toISOString(), health: await adaptiveAIRouterService.healthSnapshot() });
});

router.get("/ai/observability", async (_req: Request, res: Response) => {
  await aiObservabilityService.initialize();
  res.json({ timestamp: new Date().toISOString(), observability: aiObservabilityService.snapshot() });
});

router.post("/ai/observability/flush", async (_req: Request, res: Response) => {
  await aiObservabilityService.flush();
  res.json({ message: "AI observability metrics flushed", observability: aiObservabilityService.snapshot() });
});

router.post("/ai/health/reset", async (req: Request, res: Response) => {
  const providerId = provider(req.body?.provider);
  const modelId = typeof req.body?.modelId === "string" ? req.body.modelId.trim() : "";
  if (req.body?.provider && !providerId) {
    res.status(400).json({ error: "Unknown provider" });
    return;
  }
  const current = await adaptiveAIRouterService.healthSnapshot();
  const targets = current.filter((item) => (!providerId || item.provider === providerId) && (!modelId || item.modelId === modelId));
  for (const item of targets) adaptiveAIRouterService.resetHealth(item.id);
  aiObservabilityService.reset(providerId, modelId || undefined);
  await aiObservabilityService.flush();
  res.json({ message: targets.length ? "AI health state reset" : "No matching health state found", reset: targets.map((item) => ({ provider: item.provider, modelId: item.modelId })) });
});

export default router;
