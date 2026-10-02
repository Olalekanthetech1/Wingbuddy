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

export function stripMediaArtifactMetadata(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/\[MEDIA_ARTIFACT\][\s\S]*?(?=(\n\n|$))/gi, "").trim();
  cleaned = cleaned.replace(/\[MEDIA_ARTIFACT\][\s\S]*/gi, "").trim();
  
  // Intercept and format raw ReAct/tool JSON strings (e.g., {"action": "dalle.generate", ...})
  if (cleaned.startsWith("{") && cleaned.endsWith("}") && (cleaned.includes('"action"') || cleaned.includes('"actionInput"'))) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.actionInput) {
        let promptText = "";
        if (typeof parsed.actionInput === "string") {
          try {
            const inner = JSON.parse(parsed.actionInput);
            promptText = inner.prompt || parsed.actionInput;
          } catch {
            promptText = parsed.actionInput;
          }
        } else if (typeof parsed.actionInput === "object") {
          promptText = parsed.actionInput.prompt || JSON.stringify(parsed.actionInput);
        }
        return parsed.thought || `I've prepared the prompt: "${promptText}". Generating your visual now!`;
      }
      if (parsed.thought) return parsed.thought;
    } catch {
      // Ignore JSON parse error and keep original text if not valid JSON
    }
  }

  const generatedMatch = cleaned.match(/^\[Generated (?:Image|Video|Visual)[^\]]*for:\s*["']([\s\S]*?)["']\](?:\s*Enhanced:\s*["']([\s\S]*?)["'])?/i);
  if (generatedMatch) {
    const original = generatedMatch[1];
    cleaned = `[A visual asset was generated and delivered for "${original}"]`;
  }
  return cleaned;
}

export const mediaArtifactContextService = new MediaArtifactContextService();
