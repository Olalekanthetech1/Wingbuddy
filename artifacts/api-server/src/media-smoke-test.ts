import { ensureDatabaseSchema } from "@workspace/db";
import { UnifiedMediaEngine } from "./services/media/unified-media-engine.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { logger } from "./lib/logger";

interface MediaTestMetric {
  pipeline: string;
  provider: string;
  requestedModel: string;
  actualModel: string;
  route: string;
  latencyMs: number;
  bufferSizeBytes: number;
  mimeType: string;
  fallbackUsed: boolean;
  status: "PASSED" | "FAILED";
  details?: string;
}

async function runMediaRealtimeSmokeTest() {
  console.log("================================================================================");
  console.log("🎬 REAL-TIME MEDIA ENGINE SMOKE TEST (IMAGE DIFFUSION & MULTI-TIER VIDEO ENGINE)");
  console.log("================================================================================");
  console.log(`⏰ Timestamp: ${new Date().toISOString()}`);

  try {
    await ensureDatabaseSchema();
  } catch {
    // optional db check
  }

  const metrics: MediaTestMetric[] = [];
  const allModels = await unifiedModelRegistryService.list();

  // ----------------------------------------------------------------------------
  // TEST 1: Hugging Face Router with stabilityai/stable-diffusion-3-medium-diffusers
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("1️⃣ TESTING STABILITY AI SD3 (stabilityai/stable-diffusion-3-medium-diffusers)");
  console.log("--------------------------------------------------------------------------------");
  const imgStart = Date.now();
  try {
    const imgPrompt = "Cinematic photograph of a glowing sapphire crystal on obsidian rock, soft volumetric lighting, 8k";
    const imgResult = await UnifiedMediaEngine.execute({
      modality: "image",
      prompt: imgPrompt,
      providerOverride: "huggingface",
      modelOverride: "stabilityai/stable-diffusion-3-medium-diffusers",
      executionMode: "live",
      userId: 888777,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    const imgLatency = Date.now() - imgStart;
    const ok = imgResult.success && Boolean(imgResult.job?.artifactUrl) && (imgResult.job?.buffer?.length || 0) > 2000;

    if (ok) {
      const currentModels = await unifiedModelRegistryService.list();
      const existing = currentModels.find(
        (m) => m.provider === "huggingface" && m.modelId === "stabilityai/stable-diffusion-3-medium-diffusers"
      );
      if (existing) {
        await unifiedModelRegistryService.setPrimary(existing.id);
      } else {
        const added = await unifiedModelRegistryService.add({
          provider: "huggingface",
          modelId: "stabilityai/stable-diffusion-3-medium-diffusers",
          name: "Stable Diffusion 3 Medium Diffusers",
          roles: ["primary_image"],
          capabilities: ["image_generation", "generate"],
        });
        await unifiedModelRegistryService.setPrimary(added.id);
      }
      console.log("   🌟 Dynamically set 'stabilityai/stable-diffusion-3-medium-diffusers' as primary_image model in registry!");
    }

    metrics.push({
      pipeline: "Image Generation (SD3 Medium)",
      provider: imgResult.job?.actualProvider || "huggingface",
      requestedModel: "stabilityai/stable-diffusion-3-medium-diffusers",
      actualModel: imgResult.job?.actualModel || "stabilityai/stable-diffusion-3-medium-diffusers",
      route: imgResult.job?.route || "community",
      latencyMs: imgLatency,
      bufferSizeBytes: imgResult.job?.buffer?.length || 0,
      mimeType: imgResult.job?.mimeType || "image/jpeg",
      fallbackUsed: (imgResult.job?.failovers?.length || 0) > 0,
      status: ok ? "PASSED" : "FAILED",
      details: `Enhanced Prompt: "${imgResult.job?.enhancedPrompt?.slice(0, 70)}..." | Artifact: ${imgResult.job?.artifactUrl}`,
    });

    console.log(`   ✅ Image Result: ${ok ? "PASSED" : "FAILED"}`);
    console.log(`   ⏱️  Latency: ${imgLatency}ms`);
    console.log(`   📦 Buffer Size: ${(imgResult.job?.buffer?.length || 0).toLocaleString()} bytes (${imgResult.job?.mimeType})`);
    console.log(`   🤖 Resolved Provider: ${imgResult.job?.actualProvider} | Model: ${imgResult.job?.actualModel}`);
    console.log(`   🌐 Route: ${imgResult.job?.route}`);
  } catch (err: any) {
    console.error("   ❌ Image Generation Error:", err.message);
    metrics.push({
      pipeline: "Image Generation (SD3 Medium)",
      provider: "huggingface",
      requestedModel: "stabilityai/stable-diffusion-3-medium-diffusers",
      actualModel: "error",
      route: "error",
      latencyMs: Date.now() - imgStart,
      bufferSizeBytes: 0,
      mimeType: "none",
      fallbackUsed: false,
      status: "FAILED",
      details: err.message,
    });
  }

  // ----------------------------------------------------------------------------
  // TEST 2: Gemini Direct Video Engine (veo-3.1-lite-generate-preview)
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("2️⃣ TESTING GEMINI VEO VIDEO ENGINE (veo-3.1-lite-generate-preview)");
  console.log("--------------------------------------------------------------------------------");
  const veoStart = Date.now();
  try {
    const veoPrompt = "A dramatic cinematic drone flyover of emerald ocean waves crashing over black volcanic rock at sunrise";
    const veoResult = await UnifiedMediaEngine.execute({
      modality: "video",
      prompt: veoPrompt,
      providerOverride: "gemini",
      modelOverride: "veo-3.1-lite-generate-preview",
      executionMode: "live",
      userId: 888777,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    const veoLatency = Date.now() - veoStart;
    const ok = veoResult.success && Boolean(veoResult.job?.artifactUrl) && (veoResult.job?.buffer?.length || 0) > 2000;

    if (ok) {
      const currentModels = await unifiedModelRegistryService.list();
      const existingVeo = currentModels.find(
        (m) => m.provider === "gemini" && m.modelId === "veo-3.1-lite-generate-preview"
      );
      if (existingVeo) {
        await unifiedModelRegistryService.setPrimary(existingVeo.id);
      } else {
        const added = await unifiedModelRegistryService.add({
          provider: "gemini",
          modelId: "veo-3.1-lite-generate-preview",
          name: "Google Veo 3.1 Lite Video Preview",
          roles: ["primary_video"],
          capabilities: ["video_generation", "generate"],
        });
        await unifiedModelRegistryService.setPrimary(added.id);
      }
      console.log("   🌟 Dynamically registered & promoted 'veo-3.1-lite-generate-preview' as primary_video in registry!");
    }

    metrics.push({
      pipeline: "Video Generation (Veo 3.1)",
      provider: veoResult.job?.actualProvider || "gemini",
      requestedModel: "veo-3.1-lite-generate-preview",
      actualModel: veoResult.job?.actualModel || "veo-3.1-lite-generate-preview",
      route: veoResult.job?.videoTechnique || "direct_veo",
      latencyMs: veoLatency,
      bufferSizeBytes: veoResult.job?.buffer?.length || 0,
      mimeType: veoResult.job?.mimeType || "video/mp4",
      fallbackUsed: (veoResult.job?.failovers?.length || 0) > 0,
      status: ok ? "PASSED" : "FAILED",
      details: `Technique: ${veoResult.job?.videoTechnique} | Video Model: ${veoResult.job?.actualModel} | Artifact: ${veoResult.job?.artifactUrl}`,
    });

    console.log(`   ✅ Veo Video Result: ${ok ? "PASSED" : "FAILED"}`);
    console.log(`   ⏱️  Latency: ${veoLatency}ms`);
    console.log(`   📦 Buffer Size: ${(veoResult.job?.buffer?.length || 0).toLocaleString()} bytes (${veoResult.job?.mimeType})`);
    console.log(`   🤖 Resolved Provider: ${veoResult.job?.actualProvider} | Model: ${veoResult.job?.actualModel}`);
  } catch (err: any) {
    console.error("   ❌ Veo Video Error:", err.message);
    metrics.push({
      pipeline: "Video Generation (Veo 3.1)",
      provider: "gemini",
      requestedModel: "veo-3.1-lite-generate-preview",
      actualModel: "error",
      route: "error",
      latencyMs: Date.now() - veoStart,
      bufferSizeBytes: 0,
      mimeType: "none",
      fallbackUsed: false,
      status: "FAILED",
      details: err.message,
    });
  }

  // ----------------------------------------------------------------------------
  // TEST 3: Hugging Face Video Engine (TaoLiveAIGC/TaoMate-H3)
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("3️⃣ TESTING HUGGING FACE VIDEO ENGINE (TaoLiveAIGC/TaoMate-H3)");
  console.log("--------------------------------------------------------------------------------");
  const hfVidStart = Date.now();
  try {
    const hfVidPrompt = "A smooth aerial camera orbit around an ancient misty mountain temple at golden hour";
    const hfVidResult = await UnifiedMediaEngine.execute({
      modality: "video",
      prompt: hfVidPrompt,
      providerOverride: "huggingface",
      modelOverride: "TaoLiveAIGC/TaoMate-H3",
      executionMode: "live",
      userId: 888777,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    const hfVidLatency = Date.now() - hfVidStart;
    const ok = hfVidResult.success && Boolean(hfVidResult.job?.artifactUrl) && (hfVidResult.job?.buffer?.length || 0) > 2000;

    if (ok) {
      const currentModels = await unifiedModelRegistryService.list();
      const existingTao = currentModels.find(
        (m) => m.provider === "huggingface" && m.modelId === "TaoLiveAIGC/TaoMate-H3"
      );
      if (!existingTao) {
        await unifiedModelRegistryService.add({
          provider: "huggingface",
          modelId: "TaoLiveAIGC/TaoMate-H3",
          name: "TaoMate H3 Video Diffusion",
          roles: ["fast"],
          capabilities: ["video_generation", "generate"],
        });
      }
      console.log("   🌟 Dynamically registered 'TaoLiveAIGC/TaoMate-H3' in unified model registry!");
    }

    metrics.push({
      pipeline: "Video Generation (TaoMate-H3)",
      provider: hfVidResult.job?.actualProvider || "huggingface",
      requestedModel: "TaoLiveAIGC/TaoMate-H3",
      actualModel: hfVidResult.job?.actualModel || "TaoLiveAIGC/TaoMate-H3",
      route: hfVidResult.job?.videoTechnique || "video_diffusion",
      latencyMs: hfVidLatency,
      bufferSizeBytes: hfVidResult.job?.buffer?.length || 0,
      mimeType: hfVidResult.job?.mimeType || "video/mp4",
      fallbackUsed: (hfVidResult.job?.failovers?.length || 0) > 0,
      status: ok ? "PASSED" : "FAILED",
      details: `Technique: ${hfVidResult.job?.videoTechnique} | Video Model: ${hfVidResult.job?.actualModel} | Artifact: ${hfVidResult.job?.artifactUrl}`,
    });

    console.log(`   ✅ TaoMate Video Result: ${ok ? "PASSED" : "FAILED"}`);
    console.log(`   ⏱️  Latency: ${hfVidLatency}ms`);
    console.log(`   📦 Buffer Size: ${(hfVidResult.job?.buffer?.length || 0).toLocaleString()} bytes (${hfVidResult.job?.mimeType})`);
    console.log(`   🤖 Resolved Provider: ${hfVidResult.job?.actualProvider} | Model: ${hfVidResult.job?.actualModel}`);
  } catch (err: any) {
    console.error("   ❌ TaoMate Video Error:", err.message);
    metrics.push({
      pipeline: "Video Generation (TaoMate-H3)",
      provider: "huggingface",
      requestedModel: "TaoLiveAIGC/TaoMate-H3",
      actualModel: "error",
      route: "error",
      latencyMs: Date.now() - hfVidStart,
      bufferSizeBytes: 0,
      mimeType: "none",
      fallbackUsed: false,
      status: "FAILED",
      details: err.message,
    });
  }

  // ----------------------------------------------------------------------------
  // REAL-TIME SUMMARY & TELEMETRY REPORT
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("📊 REAL-TIME MEDIA GENERATION SMOKE TEST REPORT");
  console.log("================================================================================");
  console.log("| Pipeline | Provider | Resolved Model | Route / Technique | Status | Latency | Payload Size |");
  console.log("|---|---|---|---|---|---|---|");
  for (const m of metrics) {
    console.log(`| ${m.pipeline} | ${m.provider} | ${m.actualModel} | ${m.route} | ${m.status === "PASSED" ? "🟢 PASSED" : "🔴 FAILED"} | ${m.latencyMs}ms | ${(m.bufferSizeBytes / 1024).toFixed(1)} KB |`);
  }
  console.log("================================================================================");

  const passedCount = metrics.filter(m => m.status === "PASSED").length;
  console.log(`Total Media Tests: ${metrics.length} | Passed: ${passedCount} | Failed: ${metrics.length - passedCount}`);

  if (passedCount === metrics.length) {
    console.log("\n🎉 ALL MEDIA GENERATION PIPELINES VERIFIED OPERATIONAL IN REAL-TIME!");
    process.exit(0);
  } else {
    console.error("\n❌ Media generation test encountered failures.");
    process.exit(1);
  }
}

runMediaRealtimeSmokeTest().catch((err) => {
  console.error("Fatal error in media smoke test:", err);
  process.exit(1);
});
