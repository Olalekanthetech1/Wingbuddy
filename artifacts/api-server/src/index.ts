import "./gemini/adaptive-runtime-patch";
import app, { telegramRuntime, setRuntimeHydrationReady } from "./app";
import { logger } from "./lib/logger";
import { getPool, ensureDatabaseSchema } from "@workspace/db";
import { hydrateEnvFromDatabase } from "./routes/env";
import { getExecutionConfig } from "./execution/config";
import { apiKeyPoolService } from "./services/api-key-pool.service";
import { geminiKeyRecoveryService } from "./services/gemini-key-recovery.service";
import { runtimeBehaviorConfigService } from "./services/runtime-behavior-config.service";
import { modelRegistryService } from "./services/model-registry.service";
import { aiProviderRegistryService } from "./services/ai-provider-registry.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { adaptiveAIRouterService } from "./services/adaptive-ai-router.service";
import { aiObservabilityService } from "./services/ai-observability.service";

const port = 3000;
let startupStateReady = false;

const server = app.listen(port, "0.0.0.0", async () => {
  logger.info({ port }, `Server listening on 0.0.0.0:${port}`);
  try {
    const pool = getPool();
    await ensureDatabaseSchema(pool);
    logger.info("Database schema verification and initialization completed");
    await hydrateEnvFromDatabase();
    await geminiKeyRecoveryService.recover();
    await apiKeyPoolService.initializeDb();
    await apiKeyPoolService.hydrateFromDatabase();
    await runtimeBehaviorConfigService.initialize();
    await aiObservabilityService.initialize();
    const providers = await aiProviderRegistryService.list();
    const registeredModels = await modelRegistryService.list();
    const unifiedModels = await unifiedModelRegistryService.initialize();
    const routingPolicy = await adaptiveAIRouterService.getPolicy();
    await adaptiveAIRouterService.initializeHealth();
    logger.info({
      providerCount: providers.length,
      enabledProviders: providers.filter((provider) => provider.enabled && provider.configured).map((provider) => provider.id),
      legacyGeminiModelRegistryCount: registeredModels.length,
      unifiedModelRegistryCount: unifiedModels.length,
      unifiedPrimaryModel: unifiedModels.find((model) => model.enabled && model.roles.includes("primary"))?.modelId || "",
      routingStrategy: routingPolicy.strategy,
      observabilityWindowStartedAt: aiObservabilityService.snapshot().windowStartedAt,
    }, "Unified AI model registry, adaptive routing, and observability hydrated before Telegram initialization");

    startupStateReady = true;
    setRuntimeHydrationReady(true);
    telegramRuntime.initOrReload();
    logger.info("Runtime configuration hydrated before Telegram initialization");
  } catch (err) {
    startupStateReady = false;
    setRuntimeHydrationReady(false);
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "CRITICAL_STARTUP_HYDRATION_FAILURE");
    logger.error("Telegram runtime will remain stopped until authoritative PostgreSQL state is available");
  }

  const execConfig = getExecutionConfig();
  logger.info({
    enabled: execConfig.enabled,
    maxConcurrency: execConfig.maxConcurrency,
    maxPerUser: execConfig.maxPerUser,
    maxPerGraph: execConfig.maxPerGraph,
    maxPerTool: execConfig.maxPerTool,
    leaseDurationMs: execConfig.leaseDurationMs,
    staleLeaseThresholdMs: execConfig.staleLeaseThresholdMs,
    defaultTimeoutMs: execConfig.defaultTimeoutMs,
    maxRetries: execConfig.maxRetries,
  }, "AUTONOMOUS_EXECUTION_ENGINE_STATUS");

  if (startupStateReady) {
    void telegramRuntime.start().catch((error: unknown) => logger.error({ err: error }, "Telegram bot failed to start"));
  } else {
    logger.error("Telegram bot startup skipped because authoritative PostgreSQL state did not complete hydration");
  }
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "Shutdown requested");
  void aiObservabilityService.flush().finally(() => telegramRuntime.stop().finally(() => server.close(() => process.exit(0))));
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
