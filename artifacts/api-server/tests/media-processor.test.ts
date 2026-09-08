import { describe, expect, it } from "vitest";
import { MediaProcessorService } from "../src/services/media-processor.service";

describe("MediaProcessorService", () => {
  describe("normalizeMimeType", () => {
    it("correctly identifies image formats from file extensions and raw mimes", () => {
      expect(MediaProcessorService.normalizeMimeType(undefined, "photo.jpg")).toBe("image/jpeg");
      expect(MediaProcessorService.normalizeMimeType(undefined, "diagram.png")).toBe("image/png");
      expect(MediaProcessorService.normalizeMimeType(undefined, "chart.webp")).toBe("image/webp");
      expect(MediaProcessorService.normalizeMimeType("image/jpeg; charset=utf-8")).toBe("image/jpeg");
    });

    it("correctly identifies audio and voice notes for Gemini ingestion", () => {
      expect(MediaProcessorService.normalizeMimeType("audio/ogg")).toBe("audio/ogg");
      expect(MediaProcessorService.normalizeMimeType("audio/opus")).toBe("audio/ogg");
      expect(MediaProcessorService.normalizeMimeType(undefined, "voice_memo.oga")).toBe("audio/ogg");
      expect(MediaProcessorService.normalizeMimeType("audio/mpeg")).toBe("audio/mp3");
      expect(MediaProcessorService.normalizeMimeType(undefined, "recording.mp3")).toBe("audio/mp3");
    });

    it("correctly identifies documents and code files", () => {
      expect(MediaProcessorService.normalizeMimeType("application/pdf")).toBe("application/pdf");
      expect(MediaProcessorService.normalizeMimeType(undefined, "financial_report.pdf")).toBe("application/pdf");
      expect(MediaProcessorService.normalizeMimeType(undefined, "script.py")).toBe("text/plain");
      expect(MediaProcessorService.normalizeMimeType(undefined, "data.csv")).toBe("text/csv");
      expect(MediaProcessorService.normalizeMimeType(undefined, "payload.json")).toBe("application/json");
    });
  });

  describe("buildMultimodalPrompt", () => {
    it("returns user caption if explicitly provided for image or document", () => {
      const prompt = MediaProcessorService.buildMultimodalPrompt("What is the total on this receipt?", "image");
      expect(prompt).toBe("What is the total on this receipt?");
    });

    it("formats voice captions with audio context", () => {
      const prompt = MediaProcessorService.buildMultimodalPrompt("Focus on the second question", "voice");
      expect(prompt).toContain("[Voice Message Audio Attached]");
      expect(prompt).toContain("Focus on the second question");
    });

    it("provides natural default transcription & answer instructions for bare voice notes", () => {
      const prompt = MediaProcessorService.buildMultimodalPrompt(undefined, "voice");
      expect(prompt).toContain("transcribe this voice message");
      expect(prompt).toContain("response");
    });

    it("provides natural breakdown instructions for bare photos", () => {
      const prompt = MediaProcessorService.buildMultimodalPrompt(undefined, "image");
      expect(prompt).toContain("analyze this image in detail");
    });

    it("provides natural document summary instructions for bare documents", () => {
      const prompt = MediaProcessorService.buildMultimodalPrompt(undefined, "document", "contract.pdf");
      expect(prompt).toContain("contract.pdf");
      expect(prompt).toContain("analyze and summarize");
    });
  });
});
