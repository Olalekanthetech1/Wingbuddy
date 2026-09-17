import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distEntry = resolve(__dirname, "artifacts/api-server/dist/index.mjs");

if (!existsSync(distEntry)) {
  console.log("[server.ts] Bundle not found at " + distEntry + ". Running build...");
  const buildResult = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
  if (buildResult.status !== 0) {
    console.error("[server.ts] Build failed with exit code", buildResult.status);
    process.exit(buildResult.status ?? 1);
  }
}

// Delegate execution to the bundled full-stack API and dashboard server
await import("./artifacts/api-server/dist/index.mjs");
