import app, { telegramRuntime } from "./app";
import { logger } from "./lib/logger";
import { getPool, ensureDatabaseSchema } from "@workspace/db";
import { hydrateEnvFromDatabase } from "./routes/env";
import { getExecutionConfig } from "./execution/config";
import { apiKeyPoolService } from "./services/api-key-pool.service";

const port = 3000;
let startupStateReady = false;

const server = app.listen(port, "0.0.0.0", async () => {
  logger.info({ port }, `Server listening on 0.0.0.0:${port}`);
  try {
    const pool = getPool();
    await ensureDatabaseSchema(pool);
    logger.info("Database schema verification and initialization completed");
    await hydrateEnvFromDatabase();
    await apiKeyPoolService.initializeDb();
    await apiKeyPoolService.hydrateFromDatabase();

    startupStateReady = true;
    telegramRuntime.initOrReload();
    logger.info("Runtime configuration hydrated before Telegram initialization");
  } catch (err) {
    startupStateReady = false;
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "CRITICAL_STARTUP_HYDRATION_FAILURE");
    logger.error("Telegram runtime will remain stopped until authoritative PostgreSQL state is available");
  }

  const execConfig = getExecutionConfig();
  logger.info({ enabled: execConfig.enabled, maxConcurrency: execConfig.maxConcurrency, maxPerUser: execConfig.maxPerUser, maxPerGraph: execConfig.maxPerGraph, maxPerTool: execConfig.maxPerTool, leaseDurationMs: execConfig.leaseDurationMs, staleLeaseThresholdMs: execConfig.staleLeaseThresholdMs, defaultTimeoutMs: execConfig.defaultTimeoutMs, maxRetries: execConfig.maxRetries }, "AUTONOMOUS_EXECUTION_ENGINE_STATUS");

  if (startupStateReady) {
    void telegramRuntime.start().catch((error: unknown) => logger.error({ err: error }, "Telegram bot failed to start"));
  } else {
    logger.error("Telegram bot startup skipped because authoritative runtime hydration did not complete");
  }
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "Shutdown requested");
  void telegramRuntime.stop().finally(() => server.close(() => process.exit(0)));
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
