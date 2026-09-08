import app, { telegramRuntime } from "./app";
import { logger } from "./lib/logger";
import { getPool, ensureDatabaseSchema } from "@workspace/db";

const port = 3000;

const server = app.listen(port, "0.0.0.0", async () => {
  logger.info({ port }, `Server listening on 0.0.0.0:${port}`);
  try {
    const pool = getPool();
    await ensureDatabaseSchema(pool);
    logger.info("Database schema verification and initialization completed");
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Database schema auto-init warning");
  }

  void telegramRuntime.start().catch((error: unknown) => {
    logger.error({ err: error }, "Telegram bot failed to start");
  });
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "Shutdown requested");
  void telegramRuntime.stop().finally(() => {
    server.close(() => process.exit(0));
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
