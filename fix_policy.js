import { db } from './lib/db/src/index.js';
import { sql } from 'drizzle-orm';
async function main() {
  await db.execute(sql`DELETE FROM system_settings WHERE key = 'user_access_policy'`);
  console.log("Deleted old policy cache");
}
main();
