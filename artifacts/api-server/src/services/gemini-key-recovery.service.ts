import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const TABLE = "ai_managed_api_keys";
type DbRow = Record<string, unknown>;

function asText(value: unknown): string { return typeof value === "string" ? value : ""; }

export class GeminiKeyRecoveryService {
  private secrets(): string[] {
    return Array.from(new Set([
      process.env.API_KEY_ENCRYPTION_SECRET?.trim(),
      process.env.API_KEY_ENCRYPTION_SECRET_PREVIOUS?.trim(),
      process.env.APP_ENCRYPTION_SECRET?.trim(),
      process.env.APP_ENCRYPTION_SECRET_PREVIOUS?.trim(),
      process.env.SESSION_SECRET?.trim(),
    ].filter((value): value is string => Boolean(value))));
  }

  private key(secret: string): Buffer { return createHash("sha256").update(secret).digest(); }

  private encrypt(apiKey: string, secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  private decrypt(payload: string): { apiKey: string; secretIndex: number } {
    const [version, ivB64, tagB64, ciphertextB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !ciphertextB64) throw new Error("Unsupported encrypted API key format");
    const secrets = this.secrets();
    if (secrets.length === 0) throw new Error("No encryption secret configured");
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const ciphertext = Buffer.from(ciphertextB64, "base64url");
    let lastError: unknown;
    for (let index = 0; index < secrets.length; index += 1) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key(secrets[index]), iv);
        decipher.setAuthTag(tag);
        const apiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
        return { apiKey, secretIndex: index };
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error("Unable to authenticate encrypted API-key data");
  }

  private fingerprint(apiKey: string): string { return createHash("sha256").update(apiKey).digest("hex"); }

  private environmentKeys(): Map<string, string> {
    const result = new Map<string, string>();
    const add = (value: string | undefined): void => {
      if (!value) return;
      for (const item of value.split(/[,\s\n]+/).map((part) => part.trim()).filter(Boolean)) {
        if (item.length >= 10) result.set(this.fingerprint(item), item);
      }
    };
    add(process.env.GEMINI_API_KEY);
    add(process.env.GEMINI_API_KEYS);
    for (let index = 1; index <= 20; index += 1) add(process.env[`GEMINI_API_KEY_${index}`]);
    return result;
  }

  async recover(): Promise<{ scanned: number; repaired: number; unrecoverable: number }> {
    const secrets = this.secrets();
    if (secrets.length === 0) return { scanned: 0, repaired: 0, unrecoverable: 0 };

    const envKeys = this.environmentKeys();
    const result = await db.execute(sql`SELECT id, fingerprint, secret_ciphertext FROM ${sql.raw(TABLE)} WHERE provider = 'gemini' AND deleted_at IS NULL ORDER BY created_at ASC`);
    let repaired = 0;
    let unrecoverable = 0;

    for (const row of result.rows as DbRow[]) {
      const id = asText(row.id);
      const ciphertext = asText(row.secret_ciphertext);
      if (!id || !ciphertext) continue;
      try {
        const decrypted = this.decrypt(ciphertext);
        if (decrypted.secretIndex > 0) {
          await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET secret_ciphertext = ${this.encrypt(decrypted.apiKey, secrets[0])}, updated_at = NOW() WHERE id = ${id} AND secret_ciphertext = ${ciphertext}`);
          repaired += 1;
          logger.info({ id }, "Re-encrypted Gemini API key with current encryption secret");
        }
      } catch (decryptError) {
        const fingerprint = asText(row.fingerprint);
        const rawEnvKey = envKeys.get(fingerprint);
        if (!rawEnvKey) {
          unrecoverable += 1;
          await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET enabled = FALSE, status = 'invalid', last_error = ${"decryption_failed"}, updated_at = NOW(), deleted_at = NOW() WHERE id = ${id} AND secret_ciphertext = ${ciphertext} AND deleted_at IS NULL`);
          logger.warn({ id }, "Gemini API key quarantined after decryption failed and no matching environment key was available");
          continue;
        }
        await db.execute(sql`UPDATE ${sql.raw(TABLE)} SET secret_ciphertext = ${this.encrypt(rawEnvKey, secrets[0])}, updated_at = NOW(), status = 'healthy', enabled = TRUE, last_error = NULL, deleted_at = NULL WHERE id = ${id} AND secret_ciphertext = ${ciphertext}`);
        repaired += 1;
        logger.info({ id }, "Recovered Gemini API key from matching environment fingerprint and repaired encrypted record");
      }
    }

    logger.info({ scanned: result.rows.length, repaired, unrecoverable }, "Gemini managed-key recovery completed");
    return { scanned: result.rows.length, repaired, unrecoverable };
  }
}

export const geminiKeyRecoveryService = new GeminiKeyRecoveryService();