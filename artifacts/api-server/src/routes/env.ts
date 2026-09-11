import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { db, getPool, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { modelRegistryService } from "../services/model-registry.service";

const router: IRouter = Router();

const MODEL_REGISTRY_MANAGED_KEYS = new Set([
  "GEMINI_MODEL",
  "GEMINI_DEFAULT_MODEL",
  "GEMINI_MODEL_POOL",
  "GEMINI_MODEL_FALLBACKS",
  "GEMINI_MODEL_FAST",
  "GEMINI_MODEL_REASONING",
  "GEMINI_MODEL_EXTRACTION",
  "GEMINI_EMBEDDING_MODEL",
]);

// Hydrate process.env from PostgreSQL database on startup
export async function hydrateEnvFromDatabase(): Promise<void> {
  try {
    const rows = await db.select().from(systemSettingsTable);
    if (rows && rows.length > 0) {
      let geminiKeyUpdated = false;
      for (const row of rows) {
        if (row.key && row.value) {
          process.env[row.key] = row.value;
          if (row.key === "GEMINI_API_KEY") {
            geminiKeyUpdated = true;
          }
        }
      }
      if (geminiKeyUpdated && process.env.GEMINI_API_KEY) {
        apiKeyPoolService.reloadFromEnv(process.env.GEMINI_API_KEY);
      }
      logger.info({ loadedKeysCount: rows.length }, "Hydrated environment variables directly from PostgreSQL database");
    }
  } catch (err) {
    logger.warn({ error: String(err) }, "Could not hydrate env variables from database (will use process.env)");
  }
}

// Initial hydration trigger
hydrateEnvFromDatabase().catch(() => {});

export interface EnvVariableSpec {
  key: string;
  category: "core" | "webhook" | "access" | "performance" | "custom";
  isSensitive: boolean;
  description: string;
  required: boolean;
  defaultValue?: string;
}

const ENV_SPECS: EnvVariableSpec[] = [
  {
    key: "TELEGRAM_BOT_TOKEN",
    category: "core",
    isSensitive: true,
    description: "Telegram Bot API Token from @BotFather",
    required: true,
  },
  {
    key: "GEMINI_API_KEY",
    category: "core",
    isSensitive: true,
    description: "Google Gemini API key or comma-separated key pool (key1,key2...)",
    required: true,
  },
  {
    key: "DATABASE_URL",
    category: "core",
    isSensitive: true,
    description: "PostgreSQL database connection string (URL)",
    required: true,
  },
  {
    key: "TELEGRAM_WEBHOOK_URL",
    category: "webhook",
    isSensitive: false,
    description: "Public HTTPS webhook endpoint (Leave empty for zero-config Long Polling)",
    required: false,
  },
  {
    key: "TELEGRAM_WEBHOOK_SECRET",
    category: "webhook",
    isSensitive: true,
    description: "Secret token for validating webhook requests (X-Telegram-Bot-Api-Secret-Token)",
    required: false,
  },
  {
    key: "ALLOWED_TELEGRAM_USER_IDS",
    category: "access",
    isSensitive: false,
    description: "Comma-separated Telegram user IDs allowed to interact with the bot",
    required: false,
  },
  {
    key: "ADMIN_USER_IDS",
    category: "access",
    isSensitive: false,
    description: "Comma-separated administrator Telegram user IDs with privileged controls",
    required: false,
  },
  {
    key: "GEMINI_MODEL",
    category: "access",
    isSensitive: false,
    description: "Runtime-managed Gemini primary model. Configure it from Model Registry; environment value is bootstrap-only.",
    required: false,
    defaultValue: "",
  },
  {
    key: "KEY_ROTATION_MODE",
    category: "access",
    isSensitive: false,
    description: "API Key pool rotation strategy ('round_robin' or 'failover')",
    required: false,
    defaultValue: "round_robin",
  },
  {
    key: "HF_TOKEN",
    category: "access",
    isSensitive: true,
    description: "Optional Hugging Face User Access Token for image & video synthesis",
    required: false,
  },
  {
    key: "PRISMA_ACCELERATE_URL",
    category: "performance",
    isSensitive: true,
    description: "Optional Prisma Accelerate endpoint for serverless connection pooling & edge caching",
    required: false,
  },
  {
    key: "PORT",
    category: "performance",
    isSensitive: false,
    description: "Server listening port",
    required: false,
    defaultValue: "3000",
  },
  {
    key: "NODE_ENV",
    category: "performance",
    isSensitive: false,
    description: "Runtime environment mode (production, development, test)",
    required: false,
    defaultValue: "production",
  },
  {
    key: "EXECUTION_ENGINE_ENABLED",
    category: "performance",
    isSensitive: false,
    description: "Autonomous Execution Engine feature flag ('true' to enable, 'false' to disable)",
    required: false,
    defaultValue: "true",
  },
  {
    key: "EXECUTION_MAX_CONCURRENCY",
    category: "performance",
    isSensitive: false,
    description: "Maximum global concurrent node execution limit",
    required: false,
    defaultValue: "10",
  },
  {
    key: "EXECUTION_MAX_PER_USER",
    category: "performance",
    isSensitive: false,
    description: "Maximum concurrent execution sessions per user",
    required: false,
    defaultValue: "3",
  },
  {
    key: "EXECUTION_LEASE_DURATION_MS",
    category: "performance",
    isSensitive: false,
    description: "Database row lease duration in milliseconds for claimed nodes",
    required: false,
    defaultValue: "30000",
  },
  {
    key: "EXECUTION_DEFAULT_TIMEOUT_MS",
    category: "performance",
    isSensitive: false,
    description: "Default execution timeout per node in milliseconds",
    required: false,
    defaultValue: "60000",
  },
  {
    key: "EXECUTION_MAX_RETRIES",
    category: "performance",
    isSensitive: false,
    description: "Maximum automated retry attempts for transient node errors",
    required: false,
    defaultValue: "3",
  },
];

function maskValue(val: string): string {
  if (!val) return "";
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

function updateDotEnvFile(key: string, value: string): void {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    let content = "";
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, "utf-8");
    const keyRegex = new RegExp(`^${key}=.*$`, "m");
    if (keyRegex.test(content)) content = content.replace(keyRegex, `${key}=${value}`);
    else {
      if (content && !content.endsWith("\n")) content += "\n";
      content += `${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
    logger.info({ key }, "Successfully persisted variable to .env file");
  } catch (err) {
    logger.warn({ error: String(err), key }, "Could not write to .env file (non-fatal)");
  }
}

// GET /api/env - Retrieve environment variables schema & runtime status
router.get("/env", (_req: Request, res: Response) => {
  const IGNORED_SYSTEM_PREFIXES = [
    "npm_", "BUN_", "PATH", "PWD", "HOME", "SHLVL", "_", "CNB_", "K_", "NGINX_",
    "CONTROL_PLANE_", "APPLET_", "NODE_", "YARN_", "LANG", "LC_", "COLOR", "EDITOR",
    "INIT_CWD", "GOMEMLIMIT", "NEXT_TELEMETRY_DISABLED", "CSP_HEADER_VALUE",
    "AUTHORIZED_SERVICE_ACCOUNT_EMAIL", "CLOUD_RUN_", "GOOGLE_RUNTIME", "NO_UPDATE_NOTIFIER", "HOST"
  ];
  const customKeys = Object.keys(process.env).filter((k) =>
    !ENV_SPECS.some((spec) => spec.key === k) &&
    !IGNORED_SYSTEM_PREFIXES.some((prefix) => k.startsWith(prefix) || k === prefix),
  );
  const variables = ENV_SPECS.map((spec) => {
    const rawValue = process.env[spec.key] || "";
    const isSet = Boolean(rawValue.trim());
    return {
      ...spec,
      isSet,
      value: MODEL_REGISTRY_MANAGED_KEYS.has(spec.key) ? "" : rawValue,
      maskedValue: MODEL_REGISTRY_MANAGED_KEYS.has(spec.key) ? "Runtime-managed" : spec.isSensitive ? maskValue(rawValue) : rawValue,
    };
  });
  const customVariables = customKeys.map((k) => {
    const rawValue = process.env[k] || "";
    const isSensitive = k.includes("KEY") || k.includes("TOKEN") || k.includes("SECRET") || k.includes("PASS");
    return {
      key: k,
      category: "custom" as const,
      isSensitive,
      description: "Custom Environment Variable",
      required: false,
      isSet: Boolean(rawValue.trim()),
      value: rawValue,
      maskedValue: isSensitive ? maskValue(rawValue) : rawValue,
    };
  });
  res.json({
    timestamp: new Date().toISOString(),
    totalConfigured: variables.filter((v) => v.isSet).length + customVariables.filter((v) => v.isSet).length,
    variables: [...variables, ...customVariables],
  });
});

// POST /api/env - Bulk or single variable update with dynamic persistence
router.post("/env", async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;
    if (!updates || typeof updates !== "object") {
      res.status(400).json({ error: "Missing required 'updates' object" });
      return;
    }
    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== "string") continue;
      const trimmedKey = key.trim();
      if (MODEL_REGISTRY_MANAGED_KEYS.has(trimmedKey)) {
        throw new Error(`${trimmedKey} is managed by the Gemini Model Registry. Change it from the Model Registry, not Environment Variables.`);
      }
      const trimmedVal = value.trim();
      process.env[trimmedKey] = trimmedVal;
      updateDotEnvFile(trimmedKey, trimmedVal);
      try {
        await db.insert(systemSettingsTable).values({ key: trimmedKey, value: trimmedVal, updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettingsTable.key, set: { value: trimmedVal, updatedAt: new Date() } });
      } catch (dbErr) {
        logger.warn({ key: trimmedKey, error: String(dbErr) }, "Failed to persist setting to systemSettingsTable (non-fatal)");
      }
      updatedKeys.push(trimmedKey);
      if (trimmedKey === "GEMINI_API_KEY") {
        apiKeyPoolService.reloadFromEnv(trimmedVal);
        import("../app").then((m) => m.initOrReloadTelegramBotAsync?.()).catch(() => {});
      } else if (trimmedKey === "KEY_ROTATION_MODE") {
        if (trimmedVal === "round_robin" || trimmedVal === "failover") apiKeyPoolService.setRotationMode(trimmedVal);
      } else if (trimmedKey === "TELEGRAM_BOT_TOKEN" || trimmedKey === "TELEGRAM_WEBHOOK_URL" || trimmedKey === "TELEGRAM_WEBHOOK_SECRET") {
        import("../app").then((m) => m.initOrReloadTelegramBotAsync?.()).catch(() => {});
      }
    }
    res.json({ message: "Environment variables saved to database and runtime successfully", updatedKeys, timestamp: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, "Failed to update environment variables");
    res.status(400).json({ error: msg });
  }
});

// POST /api/env/test - Dynamic connection test endpoint for credentials
router.post("/env/test", async (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "Missing 'key' parameter" });
    return;
  }
  const testVal = (typeof value === "string" && value.trim()) ? value.trim() : process.env[key] || "";
  if (!testVal) {
    res.status(400).json({ ok: false, error: `No value set for ${key}` });
    return;
  }
  const startTime = Date.now();
  try {
    if (key === "GEMINI_API_KEY") {
      const result = await apiKeyPoolService.testRawKey(testVal);
      res.json({ ok: result.valid, latencyMs: Date.now() - startTime, message: result.valid ? "Gemini API connection healthy!" : result.error, details: result });
      return;
    }
    if (key === "GEMINI_MODEL") {
      const models = await modelRegistryService.list();
      const target = models.find((m) => m.modelId === testVal);
      if (!target) {
        res.status(400).json({ ok: false, error: "Model is not registered. Add it through Model Registry first." });
        return;
      }
      const result = await modelRegistryService.test(target.modelId);
      res.json({ ...result, managedBy: "model-registry" });
      return;
    }
    if (MODEL_REGISTRY_MANAGED_KEYS.has(key)) {
      res.status(400).json({ ok: false, error: `${key} is managed by the Gemini Model Registry.` });
      return;
    }
    if (key === "TELEGRAM_BOT_TOKEN") {
      const response = await fetch(`https://api.telegram.org/bot${testVal}/getMe`);
      const data = (await response.json()) as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };
      const latencyMs = Date.now() - startTime;
      if (data.ok && data.result) res.json({ ok: true, latencyMs, message: `Telegram Bot connected: @${data.result.username || "bot"} (${data.result.first_name || "Bot"})`, details: data.result });
      else res.json({ ok: false, latencyMs, error: data.description || "Invalid Telegram Bot Token" });
      return;
    }
    if (key === "DATABASE_URL") {
      try {
        const pool = getPool();
        const startDb = Date.now();
        const result = await pool.query("SELECT NOW() as now, current_database() as db_name;");
        res.json({ ok: true, latencyMs: Date.now() - startDb, message: `PostgreSQL connection healthy! Database: ${result.rows[0]?.db_name || "active"}`, details: result.rows[0] });
      } catch (dbErr) {
        res.json({ ok: false, latencyMs: Date.now() - startTime, error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
      }
      return;
    }
    res.json({ ok: true, latencyMs: Date.now() - startTime, message: `Variable '${key}' exists and is set (${testVal.length} chars)` });
  } catch (err) {
    res.status(500).json({ ok: false, latencyMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /api/env/:key - Delete a custom or optional variable
router.delete("/env/:key", async (req: Request, res: Response) => {
  const rawKey = req.params.key;
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (!key) {
    res.status(400).json({ error: "Missing key" });
    return;
  }
  if (MODEL_REGISTRY_MANAGED_KEYS.has(key)) {
    res.status(400).json({ error: `${key} is managed by the Gemini Model Registry. Remove or change it through Model Registry.` });
    return;
  }
  delete process.env[key];
  updateDotEnvFile(key, "");
  try {
    await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, key));
    res.json({ message: `Environment variable '${key}' removed`, key });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
