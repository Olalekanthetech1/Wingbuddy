import { unifiedModelRegistryService } from "./artifacts/api-server/src/services/unified-model-registry.service.js";

async function run() {
  const models = await unifiedModelRegistryService.list();
  const veo = models.find(m => m.modelId.includes("veo"));
  console.log("Veo in DB:", JSON.stringify(veo, null, 2));
}

run();
