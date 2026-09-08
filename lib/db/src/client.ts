import { PrismaClient } from "@prisma/client";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import os from "node:os";
import * as schema from "./schema";

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;
let prismaInstance: PrismaClient | null = null;
let schemaInitPromise: Promise<void> | null = null;
let pgVectorAvailable = false;

/**
 * Dynamically computes optimal database connection pool parameters
 * based on available CPU cores, container resource constraints, and runtime memory limits.
 */
export function computeAdaptivePoolConfig(): {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
} {
  const cpuCount = Math.max(1, os.cpus()?.length || 2);
  const mem = process.memoryUsage();
  const memoryPressureRatio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0.5;

  // Compute adaptive max connections dynamically from CPU topology and container memory
  let calculatedMax = Math.max(4, cpuCount * 4);
  if (memoryPressureRatio > 0.8) {
    calculatedMax = Math.max(4, Math.floor(calculatedMax * 0.7));
  }

  // Adaptive idle timeout: dynamically balances connection reuse vs memory reclamation
  const calculatedIdleTimeout = memoryPressureRatio > 0.8
    ? 10000
    : Math.max(15000, Math.min(60000, 10000 * cpuCount));

  // Adaptive connection acquisition timeout
  const calculatedConnTimeout = Math.max(3000, Math.min(10000, 2000 * Math.max(1, Math.floor(cpuCount / 2))));

  return {
    max: calculatedMax,
    idleTimeoutMillis: calculatedIdleTimeout,
    connectionTimeoutMillis: calculatedConnTimeout,
  };
}

export function isPgVectorAvailable(): boolean {
  return pgVectorAvailable;
}

export async function ensureDatabaseSchema(pgPool: pg.Pool): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      personality TEXT NOT NULL DEFAULT 'playful',
      mode TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_user_id_idx ON users(telegram_user_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      chat_id BIGINT NOT NULL,
      title TEXT,
      summary TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_chat_idx ON conversations(telegram_user_id, chat_id);
    CREATE INDEX IF NOT EXISTS conversations_chat_id_idx ON conversations(chat_id);
    CREATE INDEX IF NOT EXISTS conversations_user_active_idx ON conversations(telegram_user_id, is_active);

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS user_memories (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      type TEXT NOT NULL DEFAULT 'user_fact',
      structured_value TEXT,
      confidence TEXT NOT NULL DEFAULT 'high',
      importance TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      embedding_json TEXT,
      source_session_id INTEGER,
      source_message_id INTEGER,
      source_conversation_id INTEGER,
      expires_at TIMESTAMPTZ,
      last_accessed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_memories_user_key_idx ON user_memories(telegram_user_id, key);
    CREATE INDEX IF NOT EXISTS user_memories_user_category_idx ON user_memories(telegram_user_id, category);
    CREATE INDEX IF NOT EXISTS user_memories_user_status_idx ON user_memories(telegram_user_id, status);

    -- Ensure upgraded columns exist for user_memories
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS embedding_json TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'user_fact';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS structured_value TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'high';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS importance TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_message_id INTEGER;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_conversation_id INTEGER;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      conversation_id INTEGER,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'pending',
      current_step INTEGER NOT NULL DEFAULT 1,
      context_json TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS agent_tasks_user_status_idx ON agent_tasks(telegram_user_id, status);
    CREATE INDEX IF NOT EXISTS agent_tasks_user_updated_idx ON agent_tasks(telegram_user_id, updated_at);

    CREATE TABLE IF NOT EXISTS agent_task_steps (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agent_task_steps_task_step_idx ON agent_task_steps(task_id, step_order);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      conversation_id INTEGER NOT NULL,
      summary TEXT NOT NULL,
      key_takeaways_json TEXT,
      artifact_refs_json TEXT,
      message_count_summarized INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS conversation_summaries_user_conv_idx ON conversation_summaries(telegram_user_id, conversation_id);

    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      chat_id BIGINT NOT NULL,
      prompt TEXT NOT NULL,
      due_at TIMESTAMPTZ NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS reminders_user_completed_idx ON reminders(telegram_user_id, is_completed);
    CREATE INDEX IF NOT EXISTS reminders_due_completed_idx ON reminders(due_at, is_completed);

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- CDC PostgreSQL Trigger for reminders
    CREATE OR REPLACE FUNCTION notify_reminders_cdc() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify(
        'reminders_cdc',
        json_build_object(
          'action', TG_OP,
          'id', COALESCE(NEW.id, OLD.id),
          'telegramUserId', COALESCE(NEW.telegram_user_id, OLD.telegram_user_id),
          'chatId', COALESCE(NEW.chat_id, OLD.chat_id),
          'isCompleted', COALESCE(NEW.is_completed, OLD.is_completed),
          'dueAt', COALESCE(NEW.due_at, OLD.due_at),
          'prompt', COALESCE(NEW.prompt, OLD.prompt)
        )::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_reminders_cdc ON reminders;
    CREATE TRIGGER trg_reminders_cdc
    AFTER INSERT OR UPDATE OR DELETE ON reminders
    FOR EACH ROW EXECUTE FUNCTION notify_reminders_cdc();

    -- CDC PostgreSQL Trigger for users
    CREATE OR REPLACE FUNCTION notify_users_cdc() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify(
        'users_cdc',
        json_build_object(
          'action', TG_OP,
          'id', COALESCE(NEW.id, OLD.id),
          'telegramUserId', COALESCE(NEW.telegram_user_id, OLD.telegram_user_id),
          'personality', COALESCE(NEW.personality, OLD.personality),
          'mode', COALESCE(NEW.mode, OLD.mode)
        )::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_users_cdc ON users;
    CREATE TRIGGER trg_users_cdc
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION notify_users_cdc();
  `;

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN;");
    // Acquire transaction-level advisory lock to serialize concurrent schema initializations
    await client.query("SELECT pg_advisory_xact_lock(987654321);");
    await client.query(schemaSql);
    await client.query("COMMIT;");

    // Check and initialize pgvector extension dynamically
    try {
      await pgPool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      await pgPool.query(`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS embedding vector(768);`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS user_memories_embedding_idx ON user_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`);
      pgVectorAvailable = true;
    } catch {
      // Graceful fallback if PostgreSQL instance does not have the compiled pgvector extension
      pgVectorAvailable = false;
    }
  } catch (err) {
    await client.query("ROLLBACK;").catch(() => {});
    console.error("Database schema initialization note:", err instanceof Error ? err.message : String(err));
  } finally {
    client.release();
  }
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }
    const poolConfig = computeAdaptivePoolConfig();

    poolInstance = new Pool({
      connectionString,
      max: poolConfig.max,
      idleTimeoutMillis: poolConfig.idleTimeoutMillis,
      connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
      allowExitOnIdle: false,
    });

    if (!schemaInitPromise) {
      schemaInitPromise = ensureDatabaseSchema(poolInstance);
    }
  }
  return poolInstance;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const pool = getPool();
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    const accelerateUrl = process.env.PRISMA_ACCELERATE_URL || process.env.DATABASE_URL;
    prismaInstance = new PrismaClient({
      datasources: accelerateUrl ? { db: { url: accelerateUrl } } : undefined,
    });
  }
  return prismaInstance;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop, receiver) {
    const realPool = getPool();
    const value = Reflect.get(realPool, prop, receiver);
    if (typeof value === "function") {
      return value.bind(realPool);
    }
    return value;
  },
});

export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const realDb = getDb();
      const value = Reflect.get(realDb, prop, receiver);
      if (typeof value === "function") {
        return value.bind(realDb);
      }
      return value;
    },
  },
);

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const realPrisma = getPrisma();
    const value = Reflect.get(realPrisma, prop, receiver);
    if (typeof value === "function") {
      return value.bind(realPrisma);
    }
    return value;
  },
});
