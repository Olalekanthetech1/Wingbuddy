import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const { Client } = pg;
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM system_settings WHERE key = 'user_access_policy'`);
    console.log("Deleted old policy cache");
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
main();
