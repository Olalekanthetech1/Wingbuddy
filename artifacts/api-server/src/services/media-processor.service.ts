import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import type { Api } from "grammy";

export interface ProcessedMedia {
  mimeType: string;
  data: string; // Base64 string without data prefix
  fileName?: string;
  sizeBytes: number;
  mediaType: "image" | "document" | "voice" | "audio";
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  // Documents
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  xml: "application/xml",
  js: "text/javascript",
  ts: "text/plain",
  py: "text/plain",
  java: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  sql: "text/plain",
  sh: "text/plain",
  // Audio
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mp3",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/m4a",
  flac: "audio/flac",
};

export class MediaProcessorService {
  /**
   * Resolves the most accurate MIME type for Gemini ingestion based on file name & reported MIME.
   */
  static normalizeMimeType(
    rawMime?: string,
    fileName?: string,
    fallback = "application/octet-stream",
  ): string {
    if (fileName) {
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      if (MIME_EXTENSION_MAP[ext]) {
        return MIME_EXTENSION_MAP[ext];
      }
    }

    if (rawMime) {
      const cleanMime = rawMime.toLowerCase().split(";")[0].trim();
      if (cleanMime === "audio/ogg" || cleanMime === "audio/oga" || cleanMime === "audio/opus") {
        return "audio/ogg";
      }
      if (cleanMime === "audio/mpeg" || cleanMime === "audio/mp3") {
        return "audio/mp3";
      }
      if (cleanMime.startsWith("image/") || cleanMime.startsWith("audio/") || cleanMime === "application/pdf") {
        return cleanMime;
      }
      if (cleanMime.startsWith("text/")) {
        return cleanMime;
      }
    }

    return fallback;
  }

  /**
   * Downloads a media file directly from Telegram servers into a base64 buffer.
   */
  static async downloadTelegramMedia(
    api: Api,
    botToken: string,
    fileId: string,
    options: {
      expectedType: "image" | "document" | "voice" | "audio";
      reportedMime?: string;
      fileName?: string;
    },
  ): Promise<ProcessedMedia> {
    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`Telegram did not return a valid file_path for file ID ${fileId}`);
    }

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    logger.info(
      {
        fileId,
        filePath: file.file_path,
        fileSize: file.file_size,
        mediaType: options.expectedType,
      },
      "Downloading Telegram media for Gemini multimodal processing",
    );

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download media file from Telegram: ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");

    const mimeType = this.normalizeMimeType(
      options.reportedMime,
      options.fileName || file.file_path,
      options.expectedType === "voice" || options.expectedType === "audio"
        ? "audio/ogg"
        : options.expectedType === "image"
          ? "image/jpeg"
          : "application/pdf",
    );

    return {
      mimeType,
      data: base64,
      fileName: options.fileName,
      sizeBytes: buffer.length,
      mediaType: options.expectedType,
    };
  }

  /**
   * Generates a natural prompt for multimodal media if user did not provide explicit text caption.
   */
  static buildMultimodalPrompt(
    userCaption?: string,
    mediaType?: "image" | "document" | "voice" | "audio",
    fileName?: string,
  ): string {
    const trimmed = userCaption?.trim();
    if (trimmed) {
      if (mediaType === "voice" || mediaType === "audio") {
        return `[Voice Message Audio Attached]\nUser note: "${trimmed}"\nPlease transcribe the attached voice note and address the user's request thoroughly.`;
      }
      return trimmed;
    }

    switch (mediaType) {
      case "voice":
      case "audio":
        return "Please transcribe this voice message accurately and provide a helpful, direct, and complete response to whatever was asked or spoken in the audio.";
      case "image":
        return "Please analyze this image in detail: identify all key objects, diagrams, charts, or text/code shown, and provide a clear, structured breakdown.";
      case "document":
        return `Please analyze and summarize the attached document (${fileName || "file"}): highlight key points, extract critical data, and explain any relevant sections.`;
      default:
        return "Please analyze the attached media file and provide a helpful explanation.";
    }
  }
}
