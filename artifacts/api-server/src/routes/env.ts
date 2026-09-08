import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import { apiKeyPoolService } from "../services/api-key-pool.service";
import { getPool } from "@workspace/db";

const router: IRouter = Router();

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
    description: "Gemini model override (e.g. gemini-2.5-flash, gemini-2.5-pro)",
    required: false,
    defaultValue: "gemini-2.5-flash",
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
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf-8");
    }

    const keyRegex = new RegExp(`^${key}=.*$`, "m");
    if (keyRegex.test(content)) {
      content = content.replace(keyRegex, `${key}=${value}`);
    } else {
      if (content && !content.endsWith("\n")) {
        content += "\n";
      }
      content += `${key}=${value}\n`;
    }

    fs.writeFileSync(envPath, content, "utf-8");
    logger.info({ key }, "Successfully persisted variable to .env file");
  } catch (err) {
    logger.warn({ error: String(err), key }, "Could not write to .env file (non-fatal)");
  }
}

// GET /api/env - Retrieve full environment variables schema & runtime status
router.get("/env", (_req: Request, res: Response) => {
  const IGNORED_SYSTEM_PREFIXES = [
    "npm_", "BUN_", "PATH", "PWD", "HOME", "SHLVL", "_", "CNB_", "K_", "NGINX_",
    "CONTROL_PLANE_", "APPLET_", "NODE_", "YARN_", "LANG", "LC_", "COLOR", "EDITOR",
    "INIT_CWD", "GOMEMLIMIT", "NEXT_TELEMETRY_DISABLED", "CSP_HEADER_VALUE",
    "AUTHORIZED_SERVICE_ACCOUNT_EMAIL", "CLOUD_RUN_", "GOOGLE_RUNTIME", "NO_UPDATE_NOTIFIER", "HOST"
  ];

  const customKeys = Object.keys(process.env).filter(
    (k) => !ENV_SPECS.some((spec) => spec.key === k) && !IGNORED_SYSTEM_PREFIXES.some((prefix) => k.startsWith(prefix) || k === prefix),
  );

  const variables = ENV_SPECS.map((spec) => {
    const rawValue = process.env[spec.key] || "";
    const isSet = Boolean(rawValue.trim());
    return {
      ...spec,
      isSet,
      value: rawValue,
      maskedValue: spec.isSensitive ? maskValue(rawValue) : rawValue,
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

// POST /api/env - Bulk or single variable update with dynamic hot-reload
router.post("/env", (req: Request, res: Response) => {
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
      const trimmedVal = value.trim();

      process.env[trimmedKey] = trimmedVal;
      updateDotEnvFile(trimmedKey, trimmedVal);
      updatedKeys.push(trimmedKey);

      // Hot-reload specific services
      if (trimmedKey === "GEMINI_API_KEY") {
        apiKeyPoolService.reloadFromEnv(trimmedVal);
      } else if (trimmedKey === "KEY_ROTATION_MODE") {
        if (trimmedVal === "round_robin" || trimmedVal === "failover") {
          apiKeyPoolService.setRotationMode(trimmedVal);
        }
      }
    }

    res.json({
      message: "Environment variables updated successfully",
      updatedKeys,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, "Failed to update environment variables");
    res.status(500).json({ error: msg });
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
      res.json({
        ok: result.healthy,
        latencyMs: Date.now() - startTime,
        message: result.healthy ? "Gemini API connection healthy!" : result.error,
        details: result,
      });
      return;
    }

    if (key === "TELEGRAM_BOT_TOKEN") {
      const response = await fetch(`https://api.telegram.org/bot${testVal}/getMe`);
      const data = (await response.json()) as { ok: boolean; result?: { username?: string; first_name?: string }; description?: string };
      const latencyMs = Date.now() - startTime;

      if (data.ok && data.result) {
        res.json({
          ok: true,
          latencyMs,
          message: `Telegram Bot connected: @${data.result.username || "bot"} (${data.result.first_name || "Bot"})`,
          details: data.result,
        });
      } else {
        res.json({
          ok: false,
          latencyMs,
          error: data.description || "Invalid Telegram Bot Token",
        });
      }
      return;
    }

    if (key === "DATABASE_URL") {
      try {
        const pool = getPool();
        const startDb = Date.now();
        const result = await pool.query("SELECT NOW() as now, current_database() as db_name;");
        const latencyMs = Date.now() - startDb;
        res.json({
          ok: true,
          latencyMs,
          message: `PostgreSQL connection healthy! Database: ${result.rows[0]?.db_name || "active"}`,
          details: result.rows[0],
        });
      } catch (dbErr) {
        res.json({
          ok: false,
          latencyMs: Date.now() - startTime,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
      return;
    }

    res.json({
      ok: true,
      latencyMs: Date.now() - startTime,
      message: `Variable '${key}' exists and is set (${testVal.length} chars)`,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// DELETE /api/env/:key - Delete a custom or optional variable
router.delete("/env/:key", (req: Request, res: Response) => {
  const { key } = req.params;
  if (!key) {
    res.status(400).json({ error: "Missing key" });
    return;
  }

  delete process.env[key];
  updateDotEnvFile(key, "");

  res.json({ message: `Variable ${key} removed from runtime process`, key });
});

export default router;
