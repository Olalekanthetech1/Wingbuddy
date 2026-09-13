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
  // TEST 2: Gemini Direct & Multi-Tier Video Motion Engine
  // ----------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("2️⃣ TESTING GEMINI & MULTI-TIER VIDEO MOTION ENGINE (Veo + FFmpeg Motion Engine)");
  console.log("--------------------------------------------------------------------------------");
  const vidStart = Date.now();
  try {
    const vidPrompt = "A dramatic drone flyover of emerald ocean waves crashing over black volcanic rock at sunrise";
    const vidResult = await UnifiedMediaEngine.execute({
      modality: "video",
      prompt: vidPrompt,
      executionMode: "live",
      userId: 888777,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    const vidLatency = Date.now() - vidStart;
    const ok = vidResult.success && Boolean(vidResult.job?.artifactUrl) && (vidResult.job?.buffer?.length || 0) > 2000;

    metrics.push({
      pipeline: "Video Generation",
      provider: vidResult.job?.actualProvider || "local_ffmpeg_engine",
      requestedModel: "veo-3.1-lite-generate-preview",
      actualModel: vidResult.job?.actualModel || "synthetic_motion_renderer",
      route: vidResult.job?.videoTechnique || "synthetic_motion",
      latencyMs: vidLatency,
      bufferSizeBytes: vidResult.job?.buffer?.length || 0,
      mimeType: vidResult.job?.mimeType || "video/mp4",
      fallbackUsed: (vidResult.job?.failovers?.length || 0) > 0,
      status: ok ? "PASSED" : "FAILED",
      details: `Technique: ${vidResult.job?.videoTechnique} | Video Model: ${vidResult.job?.actualModel} | Artifact: ${vidResult.job?.artifactUrl}`,
    });

    console.log(`   ✅ Video Result: ${ok ? "PASSED" : "FAILED"}`);
    console.log(`   ⏱️  Latency: ${vidLatency}ms`);
    console.log(`   📦 Buffer Size: ${(vidResult.job?.buffer?.length || 0).toLocaleString()} bytes (${vidResult.job?.mimeType})`);
    console.log(`   🤖 Resolved Provider: ${vidResult.job?.actualProvider} | Model: ${vidResult.job?.actualModel}`);
    console.log(`   🎥 Technique: ${vidResult.job?.videoTechnique}`);
  } catch (err: any) {
    console.error("   ❌ Video Generation Error:", err.message);
    metrics.push({
      pipeline: "Video Generation",
      provider: "gemini/local_ffmpeg_engine",
      requestedModel: "veo-3.1-lite-generate-preview",
      actualModel: "error",
      route: "error",
      latencyMs: Date.now() - vidStart,
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
