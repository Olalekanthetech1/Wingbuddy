import { logger } from "../lib/logger";

export type MediaArtifactType = "image" | "video";

export interface MediaArtifactContext {
  type: MediaArtifactType;
  prompt: string;
  publicUrl: string;
  provider?: string;
  storageProvider?: string;
  publicId?: string;
  model?: string;
  createdAt: number;
}

const MAX_ENTRIES = 100;
const TTL_MS = 24 * 60 * 60 * 1000;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

class MediaArtifactContextService {
  private readonly artifacts: MediaArtifactContext[] = [];

  remember(artifact: Omit<MediaArtifactContext, "createdAt">): void {
    const publicUrl = artifact.publicUrl.trim();
    if (!isPublicHttpUrl(publicUrl)) return;

    const entry: MediaArtifactContext = {
      ...artifact,
      prompt: artifact.prompt.trim(),
      publicUrl,
      createdAt: Date.now(),
    };

    const key = `${entry.type}:${normalize(entry.prompt)}`;
    const retained = this.artifacts.filter(
      (candidate) => candidate.createdAt > Date.now() - TTL_MS && `${candidate.type}:${normalize(candidate.prompt)}` !== key,
    );
    retained.push(entry);
    this.artifacts.splice(0, this.artifacts.length, ...retained.slice(-MAX_ENTRIES));

    logger.info(
      { type: entry.type, storageProvider: entry.storageProvider, publicId: entry.publicId, model: entry.model },
      "MEDIA_ARTIFACT_CONTEXT_REGISTERED",
    );
  }

  find(type: MediaArtifactType, prompt: string): MediaArtifactContext | undefined {
    const now = Date.now();
    for (let index = this.artifacts.length - 1; index >= 0; index -= 1) {
      const candidate = this.artifacts[index];
      if (candidate.createdAt <= now - TTL_MS) continue;
      if (candidate.type === type && normalize(candidate.prompt) === normalize(prompt)) return candidate;
    }
    return undefined;
  }

  enrichGeneratedMessage(content: string): string {
    const imageMatch = content.match(/^\[Generated Image for: \"([\s\S]*?)\"\]/);
    if (imageMatch) {
      const artifact = this.find("image", imageMatch[1]);
      if (artifact) {
        return `${content}\n[MEDIA_ARTIFACT]\nType: image\nPublic URL: ${artifact.publicUrl}${artifact.storageProvider ? `\nStorage: ${artifact.storageProvider}` : ""}${artifact.publicId ? `\nPublic ID: ${artifact.publicId}` : ""}`;
      }
    }

    const videoMatch = content.match(/^\[Generated Visual \([^)]*\) for: \"([\s\S]*?)\"\]/);
    if (videoMatch) {
      const artifact = this.find("video", videoMatch[1]);
      if (artifact) {
        return `${content}\n[MEDIA_ARTIFACT]\nType: video\nPublic URL: ${artifact.publicUrl}${artifact.storageProvider ? `\nStorage: ${artifact.storageProvider}` : ""}${artifact.publicId ? `\nPublic ID: ${artifact.publicId}` : ""}`;
      }
    }

    return content;
  }
}

export const mediaArtifactContextService = new MediaArtifactContextService();
