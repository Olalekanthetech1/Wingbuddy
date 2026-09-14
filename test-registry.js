import { db, systemSettingsTable } from "./artifacts/api-server/dist/node_modules/@workspace/db/dist/index.js";
import { eq } from "drizzle-orm";

async function run() {
  const rows = await db.select({ value: systemSettingsTable.value }).from(systemSettingsTable).where(eq(systemSettingsTable.key, "unified_ai_model_registry")).limit(1);
  if (rows.length > 0) {
    const models = JSON.parse(rows[0].value);
    console.log("Total models:", models.length);
    const videoModels = models.filter(m => m.roles.includes("primary_video") || (m.modelId && m.modelId.includes("veo")));
    console.log("Video related models in DB:", JSON.stringify(videoModels, null, 2));
  } else {
    console.log("No registry found in DB");
  }
  process.exit(0);
}
run();
