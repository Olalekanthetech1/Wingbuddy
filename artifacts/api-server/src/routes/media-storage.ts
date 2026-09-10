import { Router, type IRouter, type Request, type Response } from "express";
import { safeErrorMetadata } from "../utils/safe-error";
import { logger } from "../lib/logger";
import { cloudinaryMediaAdminService } from "../services/cloudinary-media-admin.service";
import { db, systemSettingsTable } from "@workspace/db";

const router: IRouter = Router();

function mask(value?: string): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

router.get("/dashboard/media-storage/status", async (_req: Request, res: Response) => {
  try {
    const status = await cloudinaryMediaAdminService.getStatus();
    res.json({
      ...status,
      credentials: {
        cloudName: mask(status.cloudName || process.env.CLOUDINARY_CLOUD_NAME),
        apiKey: mask(process.env.CLOUDINARY_API_KEY),
        secretConfigured: Boolean(process.env.CLOUDINARY_API_SECRET?.trim()),
        urlConfigured: Boolean(process.env.CLOUDINARY_URL?.trim()),
      },
    });
  } catch (error) {
    logger.warn({ error: safeErrorMetadata(error) }, "Cloudinary media storage status check failed");
    res.status(200).json({ configured: false, healthy: false, capabilities: [], error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/dashboard/media-storage/test", async (req: Request, res: Response) => {
  try {
    const result = await cloudinaryMediaAdminService.testConnection({
      cloudName: typeof req.body?.cloudName === "string" ? req.body.cloudName : undefined,
      apiKey: typeof req.body?.apiKey === "string" ? req.body.apiKey : undefined,
      apiSecret: typeof req.body?.apiSecret === "string" ? req.body.apiSecret : undefined,
      cloudinaryUrl: typeof req.body?.cloudinaryUrl === "string" ? req.body.cloudinaryUrl : undefined,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/dashboard/media-storage/overview", async (_req: Request, res: Response) => {
  try {
    res.json(await cloudinaryMediaAdminService.getOverview());
  } catch (error) {
    logger.warn({ error: safeErrorMetadata(error) }, "Cloudinary media storage overview failed");
    res.status(200).json({ configured: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/dashboard/media-storage/assets", async (req: Request, res: Response) => {
  try {
    const resourceType = req.query.resourceType === "video" || req.query.resourceType === "raw" ? String(req.query.resourceType) : "image";
    const maxResults = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const assets = await cloudinaryMediaAdminService.listAssets(resourceType as "image" | "video" | "raw", maxResults);
    res.json({ resourceType, assets });
  } catch (error) {
    logger.warn({ error: safeErrorMetadata(error) }, "Cloudinary media asset listing failed");
    res.status(200).json({ resourceType: req.query.resourceType || "image", assets: [], error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete("/dashboard/media-storage/assets", async (req: Request, res: Response) => {
  try {
    const publicIds = Array.isArray(req.body?.publicIds) ? req.body.publicIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0) : [];
    const resourceType = req.body?.resourceType === "video" || req.body?.resourceType === "raw" ? req.body.resourceType : "image";
    if (!publicIds.length) {
      res.status(400).json({ error: "publicIds must contain at least one asset ID" });
      return;
    }
    res.json(await cloudinaryMediaAdminService.deleteAssets(resourceType, publicIds));
  } catch (error) {
    logger.warn({ error: safeErrorMetadata(error) }, "Cloudinary media asset deletion failed");
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/dashboard/media-storage/save", async (req: Request, res: Response) => {
  try {
    const cloudName = typeof req.body?.cloudName === "string" ? req.body.cloudName.trim() : "";
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    const apiSecret = typeof req.body?.apiSecret === "string" ? req.body.apiSecret.trim() : "";
    const cloudinaryUrl = typeof req.body?.cloudinaryUrl === "string" ? req.body.cloudinaryUrl.trim() : "";

    const test = await cloudinaryMediaAdminService.testConnection({ cloudName, apiKey, apiSecret, cloudinaryUrl });
    if (!test.ok) {
      res.status(400).json({ ok: false, error: test.error || "Cloudinary connection test failed" });
      return;
    }

    const updates: Record<string, string> = cloudinaryUrl
      ? { CLOUDINARY_URL: cloudinaryUrl }
      : { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret };
    if (cloudinaryUrl && cloudName) updates.CLOUDINARY_CLOUD_NAME = cloudName;
    if (cloudinaryUrl && apiKey) updates.CLOUDINARY_API_KEY = apiKey;
    if (cloudinaryUrl && apiSecret) updates.CLOUDINARY_API_SECRET = apiSecret;

    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
      await db.insert(systemSettingsTable).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value, updatedAt: new Date() } });
    }

    res.json({ ok: true, message: "Cloudinary credentials validated and persisted to the database", cloudName: test.cloudName || cloudName });
  } catch (error) {
    logger.error({ error: safeErrorMetadata(error) }, "Cloudinary credential save failed");
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
