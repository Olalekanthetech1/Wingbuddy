import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/smoke-test-runner.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "grammy",
      "@google/genai",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      "cron-parser"
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    // Also normalize PostgreSQL SSL configuration before any bundled dependency parses DATABASE_URL.
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);

// PostgreSQL SSL policy is explicit and deployment-configurable.
// pg-connection-string currently warns when legacy sslmode values are used without
// libpq compatibility. The production-safe default is verify-full, which preserves
// the secure behavior the current runtime already applies while remaining explicit.
try {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (rawDatabaseUrl) {
    const databaseUrl = new URL(rawDatabaseUrl);
    const configuredMode = (process.env.DATABASE_SSL_MODE || process.env.PGSSLMODE || 'verify-full').trim().toLowerCase();
    const supportedModes = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);
    const sslMode = supportedModes.has(configuredMode) ? configuredMode : 'verify-full';

    // Keep the operator's explicit request, but remove the warning in modern pg
    // by making legacy modes use libpq-compatible parsing. Production defaults to
    // verify-full and therefore performs certificate and hostname verification.
    databaseUrl.searchParams.delete('sslmode');
    databaseUrl.searchParams.delete('uselibpqcompat');
    databaseUrl.searchParams.set('sslmode', sslMode);
    if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
      databaseUrl.searchParams.set('uselibpqcompat', 'true');
    }
    process.env.DATABASE_URL = databaseUrl.toString();
    if (!process.env.PGSSLMODE) process.env.PGSSLMODE = sslMode;
  }
} catch (sslBootstrapError) {
  console.warn('[DB] PostgreSQL SSL configuration normalization failed; retaining original DATABASE_URL.', sslBootstrapError instanceof Error ? sslBootstrapError.message : String(sslBootstrapError));
}
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});