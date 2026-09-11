import { db } from './lib/db/src/index.ts';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS images_today INT NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS videos_today INT NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deep_reasoning_today INT NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS research_today INT NOT NULL DEFAULT 0;`);
    console.log("Success");
  } catch (e) {
    console.error(e);
  }
}
main();
