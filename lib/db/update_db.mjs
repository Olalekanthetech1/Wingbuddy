import pg from "pg";
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS images_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS videos_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deep_reasoning_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS research_today INT NOT NULL DEFAULT 0;`);

    const tables = [
      'users', 'conversations', 'messages', 'user_memories', 'agent_tasks',
      'agent_task_steps', 'conversation_summaries', 'reminders', 'system_settings',
      'execution_graphs', 'graph_revisions', 'execution_sessions', 'node_executions',
      'execution_leases', 'execution_approvals'
    ];
    for (const t of tables) {
      try {
        const res = await client.query(`SELECT * FROM "${t}" LIMIT 1;`);
        console.log(`Table ${t}: OK (${res.fields.length} cols)`);
      } catch (err) {
        console.error(`Table ${t} ERROR:`, err.message);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
main();
