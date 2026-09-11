const fs = require('fs');
const file = 'artifacts/api-server/src/services/video-generation.service.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /const capability = await huggingFaceCapabilityService\.resolveModel\("text-to-video", preferredModel\);[\s\S]*?metadata: { originalPrompt, capabilityDiscovery: capability\.discovered, preferredModelAvailable: capability\.preferredAvailable },\s*}\);/;

const replacement = `const allModels = await unifiedModelRegistryService.list();
    const primaryVideo = allModels.find(m => m.enabled && m.roles.includes("primary_video"));
    
    let targetProvider = "huggingface";
    let targetModel = "";
    let orderedModels: string[] = [];
    let discovery = false;
    let preferredAvail = false;

    if (primaryVideo) {
      targetProvider = primaryVideo.provider;
      targetModel = primaryVideo.modelId;
      orderedModels = [targetModel];
      preferredAvail = true;
    } else {
      const capability = await huggingFaceCapabilityService.resolveModel("text-to-video", preferredModel);
      discovery = capability.discovered;
      preferredAvail = capability.preferredAvailable;
      
      const discoveredModels = capability.candidates.map((candidate) => candidate.id).filter(Boolean);
      orderedModels = [
        capability.model,
        ...discoveredModels,
      ].filter((model, index, all) => Boolean(model) && all.indexOf(model) === index).slice(0, 6);
    }

    if (!orderedModels.length) throw new Error("No live Hugging Face text-to-video model is available");
    let lastError: unknown;
    for (const model of orderedModels) {
      try {
        logger.info({ originalPrompt, enhancedPrompt, model, discovered: discovery, preferredAvailable: preferredAvail }, "Generating video through adaptive model selection");
        const execution = await aiProviderGatewayService.generateVideo(targetProvider as any, {
          model,
          prompt: enhancedPrompt,
          metadata: { originalPrompt, capabilityDiscovery: discovery, preferredModelAvailable: preferredAvail },
        });`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync(file, code);
  console.log("Updated successfully via regex");
} else {
  console.log("Regex Target not found");
}
