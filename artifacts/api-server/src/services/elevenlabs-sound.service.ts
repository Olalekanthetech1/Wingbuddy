import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../lib/logger";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import { aiProviderRegistryService } from "./ai-provider-registry.service";

const execFileAsync = promisify(execFile);

export class ElevenLabsSoundService {
  private static async getAvailableKey(): Promise<{ key: string; keyId?: string } | null> {
    try {
      const record = await aiProviderRegistryService.get("elevenlabs");
      await aiProviderKeyPoolService.hydrateProvider("elevenlabs", record.apiKeyEnv);
    } catch {
      // Ignored if not yet in database
    }

    const keys = aiProviderKeyPoolService.getOrderedKeys("elevenlabs");
    if (keys.length > 0 && keys[0].key) {
      return { key: keys[0].key, keyId: keys[0].id };
    }

    const envKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (envKey) {
      return { key: envKey };
    }

    return null;
  }

  static async isAvailable(): Promise<boolean> {
    const keyInfo = await this.getAvailableKey();
    return Boolean(keyInfo?.key);
  }

  static async generateSound(prompt: string, durationSeconds: number = 4): Promise<Buffer | null> {
    const keyInfo = await this.getAvailableKey();
    if (!keyInfo) return null;

    const started = Date.now();
    try {
      const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
          "xi-api-key": keyInfo.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: prompt.slice(0, 300),
          duration_seconds: Math.max(1, Math.min(durationSeconds, 10)),
          prompt_influence: 0.35,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (keyInfo.keyId) {
          aiProviderKeyPoolService.recordFailure(keyInfo.keyId, `Sound generation ${response.status}: ${errorText.slice(0, 200)}`);
        }
        logger.warn({ status: response.status, error: errorText.slice(0, 200) }, "ElevenLabs sound generation request failed");
        return null;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      if (keyInfo.keyId) {
        aiProviderKeyPoolService.recordSuccess(keyInfo.keyId, Date.now() - started);
      }
      logger.info({ size: audioBuffer.length, latencyMs: Date.now() - started }, "ElevenLabs atmospheric audio generated successfully");
      return audioBuffer;
    } catch (error) {
      if (keyInfo.keyId) {
        aiProviderKeyPoolService.recordFailure(keyInfo.keyId, error);
      }
      logger.warn({ error: String(error) }, "ElevenLabs sound generation network error");
      return null;
    }
  }

  static async attachAudioToVideo(videoBuffer: Buffer, prompt: string): Promise<Buffer> {
    const isReady = await this.isAvailable();
    if (!isReady) return videoBuffer;

    const audioBuffer = await this.generateSound(prompt, 5);
    if (!audioBuffer || audioBuffer.length < 100) return videoBuffer;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-sound-"));
    const tmpVideo = path.join(tempDir, "input.mp4");
    const tmpAudio = path.join(tempDir, "input.mp3");
    const tmpOutput = path.join(tempDir, "output.mp4");

    try {
      await fs.writeFile(tmpVideo, videoBuffer);
      await fs.writeFile(tmpAudio, audioBuffer);

      await execFileAsync("ffmpeg", [
        "-y",
        "-i", tmpVideo,
        "-i", tmpAudio,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        tmpOutput,
      ]);

      const multiplexed = await fs.readFile(tmpOutput);
      if (multiplexed.length > 1000) {
        logger.info({ originalSize: videoBuffer.length, newSize: multiplexed.length }, "Multiplexed ElevenLabs audio with video MP4");
        return multiplexed;
      }
      return videoBuffer;
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to multiplex audio with video via ffmpeg; using silent video");
      return videoBuffer;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
