import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { webChatService } from "../services/web-chat.service";
import { mediaJobOrchestratorService } from "../services/media/media-job-orchestrator.service";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/media/health
 * Public health check for diffusion engines and storage provider.
 */
router.get("/health", async (_req: Request, res: Response) => {
  try {
    const health = await mediaJobOrchestratorService.getEngineHealth();
    res.json(health);
  } catch (err: any) {
    logger.error({ err }, "Failed querying media engine health");
    res.status(500).json({ error: err.message || "Failed checking media health" });
  }
});

// All following routes require authenticated user session
router.use(requireAuth);

/**
 * GET /api/media/jobs/:id
 * Retrieves the live status of an asynchronous media generation job.
 */
router.get("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const jobId = req.params.id;

    const job = await mediaJobOrchestratorService.getJob(jobId, partitionId);
    if (!job) {
      res.status(404).json({ error: "Media job not found" });
      return;
    }

    res.json({ job });
  } catch (err: any) {
    logger.error({ err, jobId: req.params.id }, "Failed fetching media job");
    res.status(500).json({ error: err.message || "Failed fetching media job" });
  }
});

/**
 * POST /api/media/generate
 * Initiates an asynchronous media job explicitly.
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const { modality, prompt, params: mediaParams, conversationId } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ error: "Missing required prompt" });
      return;
    }
    if (modality !== "image" && modality !== "video") {
      res.status(400).json({ error: "Invalid modality: must be 'image' or 'video'" });
      return;
    }

    let targetConvId = conversationId;
    if (!targetConvId) {
      const convList = await webChatService.listConversations(user);
      targetConvId = convList[0]?.id;
      if (!targetConvId) {
        const fresh = await webChatService.createConversation(user, "New Chat");
        targetConvId = fresh.id;
      }
    }

    const result = await mediaJobOrchestratorService.enqueueJob({
      ownerUserId: partitionId,
      conversationId: targetConvId,
      modality,
      prompt: prompt.trim(),
      params: mediaParams || {},
      sourceInterface: "web",
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Failed generating media job");
    res.status(500).json({ error: err.message || "Failed starting media generation" });
  }
});

/**
 * POST /api/media/jobs/:id/retry
 * Retries a previously failed media generation job.
 */
router.post("/jobs/:id/retry", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const jobId = req.params.id;

    const result = await mediaJobOrchestratorService.retryJob(jobId, partitionId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err, jobId: req.params.id }, "Failed retrying media job");
    res.status(500).json({ error: err.message || "Failed retrying media job" });
  }
});

/**
 * POST /api/media/assets/:id/regenerate
 * Re-runs media generation with identical parameters for the given asset.
 */
router.post("/assets/:id/regenerate", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const assetId = parseInt(req.params.id, 10);

    const result = await mediaJobOrchestratorService.regenerateAsset(assetId, partitionId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err, assetId: req.params.id }, "Failed regenerating media asset");
    res.status(500).json({ error: err.message || "Failed regenerating media asset" });
  }
});

/**
 * POST /api/media/assets/:id/vary
 * Creates a variation of the media asset using stored params.
 */
router.post("/assets/:id/vary", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const assetId = parseInt(req.params.id, 10);
    const { variationPrompt } = req.body || {};

    const result = await mediaJobOrchestratorService.varyAsset(assetId, partitionId, variationPrompt);
    res.json(result);
  } catch (err: any) {
    logger.error({ err, assetId: req.params.id }, "Failed varying media asset");
    res.status(500).json({ error: err.message || "Failed creating asset variation" });
  }
});

/**
 * GET /api/media/assets/:id/download
 * Proxies media file with explicit Content-Disposition attachment header.
 */
router.get("/assets/:id/download", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const partitionId = webChatService.getPartitionUserId(user);
    const assetId = parseInt(req.params.id, 10);

    const asset = await mediaJobOrchestratorService.getAsset(assetId, partitionId);
    if (!asset || !asset.url) {
      res.status(404).json({ error: "Media asset not found" });
      return;
    }

    const ext = asset.mimeType?.includes("video") ? "mp4" : "png";
    const filename = `wingbuddy-${asset.type}-${asset.id}.${ext}`;

    const upstream = await fetch(asset.url);
    if (!upstream.ok) {
      res.redirect(asset.url);
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    logger.error({ err, assetId: req.params.id }, "Failed downloading media asset");
    res.status(500).json({ error: err.message || "Failed downloading media asset" });
  }
});

export default router;
