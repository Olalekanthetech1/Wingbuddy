import { getPool } from "./lib/db/src/client";

async function migrate() {
  const pool = getPool();
  const sql = `
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS embedding_json TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'user_fact';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS structured_value TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'high';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS importance TEXT NOT NULL DEFAULT 'medium';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_session_id INTEGER;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_message_id INTEGER;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_conversation_id INTEGER;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS import_source TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS import_batch_id TEXT;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
    
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS import_batch_id TEXT;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_id TEXT;
  `;
  try {
    await pool.query(sql);
    console.log("Migration successful");
  } catch (err) {
    console.error("Migration failed:", err.message);
  }
}

migrate();
