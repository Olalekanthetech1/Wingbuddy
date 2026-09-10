import { v2 as cloudinary, type UploadApiResponse, type UploadApiOptions } from "cloudinary";
import { Readable } from "node:stream";
import { logger } from "../lib/logger";

export type CloudinaryResourceType = "image" | "video" | "raw";

export interface CloudinaryMediaUploadOptions {
  resourceType: CloudinaryResourceType;
  mimeType?: string;
  folder?: string;
  publicId?: string;
  tags?: string[];
}

export interface CloudinaryMediaAsset {
  provider: "cloudinary";
  secureUrl: string;
  publicId: string;
  resourceType: CloudinaryResourceType;
  format?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes: number;
  version?: number;
}

function configured(): boolean {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  return Boolean(cloudinaryUrl || (cloudName && apiKey && apiSecret));
}

function configure(): void {
  if (!configured()) return;

  if (process.env.CLOUDINARY_URL?.trim()) {
    cloudinary.config({ secure: true });
    return;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: process.env.CLOUDINARY_API_KEY?.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET?.trim(),
    secure: true,
  });
}

function toUploadOptions(options: CloudinaryMediaUploadOptions): UploadApiOptions {
  return {
    resource_type: options.resourceType,
    folder: options.folder?.trim() || "wingbuddy/generated",
    public_id: options.publicId?.trim() || undefined,
    tags: options.tags,
  };
}

function toAsset(response: UploadApiResponse, mimeType?: string): CloudinaryMediaAsset {
  return {
    provider: "cloudinary",
    secureUrl: response.secure_url,
    publicId: response.public_id,
    resourceType: response.resource_type as CloudinaryResourceType,
    format: response.format,
    mimeType,
    width: response.width,
    height: response.height,
    duration: response.duration,
    bytes: response.bytes,
    version: response.version,
  };
}

export class CloudinaryMediaStorageService {
  isConfigured(): boolean {
    return configured();
  }

  async uploadBuffer(buffer: Buffer, options: CloudinaryMediaUploadOptions): Promise<CloudinaryMediaAsset> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("Cloudinary upload requires a non-empty media buffer");
    }

    if (!configured()) {
      throw new Error("Cloudinary is not configured; set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET");
    }

    configure();

    const uploadOptions = toUploadOptions(options);
    const useChunkedStream = buffer.byteLength > 90 * 1024 * 1024;
    const start = Date.now();

    const response = await new Promise<UploadApiResponse>((resolve, reject) => {
      const callback = (error: unknown, result?: UploadApiResponse) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (!result?.secure_url || !result.public_id) {
          reject(new Error("Cloudinary returned an incomplete upload response"));
          return;
        }
        resolve(result);
      };

      const stream = Readable.from(buffer);
      const uploadStream = useChunkedStream
        ? cloudinary.uploader.upload_chunked_stream(
            { ...uploadOptions, chunk_size: 20 * 1024 * 1024 },
            callback,
          )
        : cloudinary.uploader.upload_stream(uploadOptions, callback);

      stream.pipe(uploadStream);
    });

    const asset = toAsset(response, options.mimeType);
    logger.info(
      {
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        bytes: asset.bytes,
        durationMs: Date.now() - start,
        chunked: useChunkedStream,
      },
      "Cloudinary media upload succeeded",
    );

    return asset;
  }

  async uploadGeneratedMedia(
    buffer: Buffer,
    options: Omit<CloudinaryMediaUploadOptions, "folder"> & { folder?: string },
  ): Promise<CloudinaryMediaAsset> {
    return this.uploadBuffer(buffer, {
      ...options,
      folder: options.folder || "wingbuddy/generated",
      tags: ["wingbuddy", "ai-generated", options.resourceType, ...(options.tags || [])],
    });
  }
}

export const cloudinaryMediaStorageService = new CloudinaryMediaStorageService();
