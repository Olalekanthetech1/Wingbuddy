import { v2 as cloudinary } from "cloudinary";
import { logger } from "../lib/logger";

export type CloudinaryResourceType = "image" | "video" | "raw";

function getConfiguredCredentials(): { cloudName: string; apiKey: string; apiSecret: string } | null {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      const cloudName = decodeURIComponent(parsed.hostname || "").trim();
      const apiKey = decodeURIComponent(parsed.username || "").trim();
      const apiSecret = decodeURIComponent(parsed.password || "").trim();
      if (cloudName && apiKey && apiSecret) return { cloudName, apiKey, apiSecret };
    } catch {
      return null;
    }
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || "";
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || "";
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

function configure(): void {
  const credentials = getConfiguredCredentials();
  if (!credentials) throw new Error("Cloudinary is not configured");
  cloudinary.config({ cloud_name: credentials.cloudName, api_key: credentials.apiKey, api_secret: credentials.apiSecret, secure: true });
}

async function adminJson(path: string, options?: { cloudName: string; apiKey: string; apiSecret: string }): Promise<any> {
  const credentials = options || getConfiguredCredentials();
  if (!credentials) throw new Error("Cloudinary is not configured");
  const auth = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64");
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `Cloudinary Admin API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export class CloudinaryMediaAdminService {
  getConfiguredCloudName(): string {
    return getConfiguredCredentials()?.cloudName || process.env.CLOUDINARY_CLOUD_NAME?.trim() || "";
  }

  async testConnection(input?: { cloudName?: string; apiKey?: string; apiSecret?: string; cloudinaryUrl?: string }): Promise<{ ok: boolean; latencyMs: number; message?: string; error?: string; cloudName?: string }> {
    const start = Date.now();
    try {
      let credentials = getConfiguredCredentials();
      const suppliedUrl = input?.cloudinaryUrl?.trim();
      if (suppliedUrl) {
        const parsed = new URL(suppliedUrl);
        credentials = { cloudName: parsed.hostname, apiKey: decodeURIComponent(parsed.username), apiSecret: decodeURIComponent(parsed.password) };
      } else if (input?.cloudName && input.apiKey && input.apiSecret) {
        credentials = { cloudName: input.cloudName.trim(), apiKey: input.apiKey.trim(), apiSecret: input.apiSecret.trim() };
      }
      if (!credentials) return { ok: false, latencyMs: Date.now() - start, error: "Provide Cloud Name + API Key + API Secret, or a valid CLOUDINARY_URL" };
      await adminJson("ping", credentials);
      return { ok: true, latencyMs: Date.now() - start, message: "Cloudinary connection is healthy", cloudName: credentials.cloudName };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getStatus(): Promise<{ configured: boolean; healthy: boolean; cloudName: string; capabilities: string[]; lastCheckedAt: string }> {
    const configured = Boolean(getConfiguredCredentials());
    if (!configured) return { configured: false, healthy: false, cloudName: "", capabilities: [], lastCheckedAt: new Date().toISOString() };
    const test = await this.testConnection();
    return {
      configured: true,
      healthy: test.ok,
      cloudName: test.cloudName || this.getConfiguredCloudName(),
      capabilities: test.ok ? ["image_upload", "video_upload", "large_media", "https_delivery", "asset_metadata", "asset_library", "usage_metrics"] : [],
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async getOverview(): Promise<{ configured: boolean; usage?: Record<string, unknown>; totals?: { images: number; videos: number; raw: number; total: number }; fetchedAt: string; error?: string }> {
    if (!getConfiguredCredentials()) return { configured: false, fetchedAt: new Date().toISOString() };
    configure();
    const [usage, images, videos, raw] = await Promise.all([
      adminJson("usage"),
      adminJson("resources/image/upload?max_results=1"),
      adminJson("resources/video/upload?max_results=1"),
      adminJson("resources/raw/upload?max_results=1"),
    ]);
    const imagesCount = Number(images?.total_count || 0);
    const videosCount = Number(videos?.total_count || 0);
    const rawCount = Number(raw?.total_count || 0);
    return {
      configured: true,
      usage: usage as Record<string, unknown>,
      totals: { images: imagesCount, videos: videosCount, raw: rawCount, total: imagesCount + videosCount + rawCount },
      fetchedAt: new Date().toISOString(),
    };
  }

  async listAssets(resourceType: CloudinaryResourceType, maxResults = 24): Promise<Array<Record<string, unknown>>> {
    if (!getConfiguredCredentials()) return [];
    configure();
    const response = await adminJson(`resources/${resourceType}/upload?max_results=${Math.min(100, Math.max(1, maxResults))}`);
    return Array.isArray(response?.resources) ? response.resources : [];
  }

  async deleteAssets(resourceType: CloudinaryResourceType, publicIds: string[]): Promise<{ deleted: string[] }> {
    if (!getConfiguredCredentials()) throw new Error("Cloudinary is not configured");
    configure();
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      cloudinary.api.delete_resources(publicIds, { resource_type: resourceType, type: "upload" }, (error, result) => {
        if (error) reject(error);
        else resolve(result || {});
      });
    });
    const deleted = Object.entries((response.deleted || {}) as Record<string, unknown>).filter(([, value]) => value === "deleted").map(([id]) => id);
    logger.info({ resourceType, requested: publicIds.length, deleted: deleted.length }, "Cloudinary assets deleted from dashboard");
    return { deleted };
  }
}

export const cloudinaryMediaAdminService = new CloudinaryMediaAdminService();
