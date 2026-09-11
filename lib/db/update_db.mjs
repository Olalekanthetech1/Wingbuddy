import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const db = drizzle(client);
  try {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS images_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS videos_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deep_reasoning_today INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS research_today INT NOT NULL DEFAULT 0;`);
    console.log("Success");
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
main();
