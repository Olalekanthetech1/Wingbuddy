import app, { telegramRuntime } from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void telegramRuntime.start().catch((error: unknown) => {
    logger.error({ err: error }, "Telegram bot failed to start");
    process.exit(1);
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
