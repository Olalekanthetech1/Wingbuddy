import { Router, type IRouter, type Request, type Response } from "express";
import { adaptiveAIRouterService } from "../services/adaptive-ai-router.service";
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

export default router;
