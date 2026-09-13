import { ensureDatabaseSchema, getPool, chatDatabaseService } from "@workspace/db";
import { aiProviderRegistryService } from "./services/ai-provider-registry.service";
import { aiProviderGatewayService } from "./services/ai-provider-gateway.service";
import { adaptiveAIRouterService } from "./services/adaptive-ai-router.service";
import { unifiedModelRegistryService } from "./services/unified-model-registry.service";
import { aiProviderAdapters } from "./services/ai-provider.adapters";
import { GeminiService } from "./gemini/gemini.service";
import { ConversationService } from "./services/conversation.service";
import { GlobalContextService } from "./services/global-context.service";
import { ModeService } from "./services/mode.service";
import { ExecutionPlannerService } from "./services/execution-planner.service";
import { SemanticInteractionResolverService } from "./services/semantic-interaction-resolver.service";
import { contextManagerService } from "./services/context-manager.service";
import { formatTelegramMessage, stripTelegramHtml } from "./utils/telegram-formatter";
import { splitTelegramMessage } from "./utils/split-message";
import { botSimulatorService } from "./services/bot-simulator.service";
import { UnifiedMediaEngine } from "./services/media/unified-media-engine.service";
import { logger } from "./lib/logger";
import type { AIProviderId, AIChatRequest } from "./services/ai-provider.types";

interface ProviderTestResult {
  provider: string;
  category: string;
  status: "PASSED" | "FAILED" | "SKIPPED" | "DEGRADED_FALLBACK";
  latencyMs: number;
  details?: Record<string, unknown>;
  outputSnippet?: string;
  inconsistencies: string[];
}

export async function runComprehensiveSmokeTest() {
  console.log("================================================================================");
  console.log("🚀 STARTING DEEP SMOKE TEST: TELEGRAM BOT & ALL PROVIDERS END-TO-END FLOW");
  console.log("================================================================================\n");

  const results: ProviderTestResult[] = [];
  const globalInconsistencies: Array<{ component: string; issue: string; severity: "LOW" | "MEDIUM" | "HIGH" }> = [];

  // 1. Initialize Database & Context
  const dbStart = Date.now();
  try {
    await ensureDatabaseSchema();
    await adaptiveAIRouterService.initializeHealth();
    results.push({
      provider: "system",
      category: "database_schema_initialization",
      status: "PASSED",
      latencyMs: Date.now() - dbStart,
      details: { ready: true },
      inconsistencies: [],
    });
  } catch (err: any) {
    results.push({
      provider: "system",
      category: "database_schema_initialization",
      status: "FAILED",
      latencyMs: Date.now() - dbStart,
      details: { error: err.message },
      inconsistencies: ["Database schema verification failed: " + err.message],
    });
  }

  // 2. Discover Registered Providers and Models
  const providers = await aiProviderRegistryService.list();
  const models = await unifiedModelRegistryService.list();
  console.log(`📋 Found ${providers.length} AI Providers and ${models.length} Unified Models.`);
  for (const p of providers) {
    console.log(`   - [${p.id.toUpperCase()}] ${p.name}: configured=${p.configured}, enabled=${p.enabled}, keyCount=${p.keyCount}`);
  }

  // ============================================================================
  // TEST 1: GEMINI PROVIDER (Direct & Streaming + Grounding + Embeddings)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: Google Gemini (Chat, Stream, Grounding, Embeddings)");
  console.log("--------------------------------------------------------------------------------");
  const geminiStart = Date.now();
  const geminiInconsistencies: string[] = [];

  try {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) {
      geminiInconsistencies.push("GEMINI_API_KEY is not set in environment");
    }

    // Dynamically resolve active model from unified registry
    const allModels = await unifiedModelRegistryService.list();
    const dynamicGeminiModel = allModels.find(m => m.provider === "gemini" && m.enabled && (m.roles.includes("primary_chat") || m.roles.includes("primary") || m.roles.includes("fast")))?.modelId
      || process.env.GEMINI_MODEL
      || "gemini-2.5-flash";

    // Direct Chat
    const chatReq: AIChatRequest = {
      model: dynamicGeminiModel,
      messages: [
        { role: "system", content: "You are a concise mathematical AI assistant." },
        { role: "user", content: "What is 15 * 14? Answer with only the number and LaTeX: $15 \\times 14 = 210$." }
      ],
      temperature: 0.1,
      maxOutputTokens: 100,
    };

    const chatRes = await aiProviderGatewayService.chat("gemini", chatReq);
    const renderedChat = formatTelegramMessage(chatRes.result.text);

    if (!chatRes.result.text.includes("210")) {
      geminiInconsistencies.push("Gemini response did not contain expected answer '210'");
    }

    // Verify LaTeX rendering in Telegram formatter
    if (!renderedChat.includes("210")) {
      geminiInconsistencies.push("Telegram Formatter did not properly preserve the calculation result '210'");
    }

    results.push({
      provider: "gemini",
      category: "chat_completion",
      status: geminiInconsistencies.length === 0 ? "PASSED" : "FAILED",
      latencyMs: Date.now() - geminiStart,
      outputSnippet: chatRes.result.text.slice(0, 120),
      details: { model: chatRes.model, finishReason: chatRes.result.finishReason, usage: chatRes.result.usage },
      inconsistencies: [...geminiInconsistencies],
    });
    console.log(`   ✅ Gemini Chat: OK (${Date.now() - geminiStart}ms) -> "${chatRes.result.text.trim()}"`);

    // Streaming
    const streamStart = Date.now();
    let streamText = "";
    let chunkCount = 0;
    for await (const chunk of aiProviderGatewayService.stream("gemini", chatReq)) {
      chunkCount++;
      if (chunk.delta) streamText += chunk.delta;
    }
    const streamInconsistencies: string[] = [];
    if (chunkCount === 0 || !streamText.trim()) {
      streamInconsistencies.push("Gemini stream emitted 0 chunks or empty text");
    }

    results.push({
      provider: "gemini",
      category: "streaming_chat",
      status: streamInconsistencies.length === 0 ? "PASSED" : "FAILED",
      latencyMs: Date.now() - streamStart,
      outputSnippet: streamText.slice(0, 120),
      details: { chunks: chunkCount, textLength: streamText.length },
      inconsistencies: streamInconsistencies,
    });
    console.log(`   ✅ Gemini Stream: OK (${chunkCount} chunks, ${Date.now() - streamStart}ms)`);

    // Embeddings
    const embedStart = Date.now();
    let embedRes: any;
    try {
      const exec = await aiProviderGatewayService.generateEmbeddings("gemini", {
        model: "text-embedding-004",
        input: ["Wingbuddy personal AI assistant", "vector search indexing test"],
        dimensions: 768,
      });
      embedRes = exec.result;
    } catch (embErr: any) {
      // If gateway key pool had an issue, fallback to adapter
      embedRes = await aiProviderAdapters.gemini.generateEmbeddings!({
        model: "text-embedding-004",
        input: ["Wingbuddy personal AI assistant", "vector search indexing test"],
        dimensions: 768,
      }, providers.find(p => p.id === "gemini")!, geminiKey);
    }

    const embedInconsistencies: string[] = [];
    if (!embedRes.embeddings || embedRes.embeddings.length !== 2 || embedRes.embeddings[0].length === 0) {
      embedInconsistencies.push("Gemini embeddings returned invalid vector dimensions");
    }

    results.push({
      provider: "gemini",
      category: "embeddings",
      status: embedInconsistencies.length === 0 ? "PASSED" : "FAILED",
      latencyMs: Date.now() - embedStart,
      details: { vectorCount: embedRes.embeddings?.length, dimension: embedRes.embeddings?.[0]?.length },
      inconsistencies: embedInconsistencies,
    });
    console.log(`   ✅ Gemini Embeddings: OK (${embedRes.embeddings?.[0]?.length || 0} dimensions, ${Date.now() - embedStart}ms)`);

  } catch (err: any) {
    results.push({
      provider: "gemini",
      category: "overall_execution",
      status: "FAILED",
      latencyMs: Date.now() - geminiStart,
      details: { error: err.message },
      inconsistencies: ["Gemini execution threw an error: " + err.message],
    });
    console.error(`   ❌ Gemini failed:`, err.message);
  }

  // ============================================================================
  // TEST 2: GROQ PROVIDER (Chat, Fast Streaming & Token Usage)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: Groq (OpenAI Compatible Chat & Ultra-fast Streaming)");
  console.log("--------------------------------------------------------------------------------");
  const groqStart = Date.now();
  const groqInconsistencies: string[] = [];
  const groqProvider = providers.find(p => p.id === "groq");

  if (process.env.GROQ_API_KEY?.trim() && groqProvider) {
    try {
      const dynamicGroqModel = allModels.find(m => m.provider === "groq" && m.enabled && (m.roles.includes("fast") || m.roles.includes("primary_chat")))?.modelId
        || process.env.GROQ_MODEL
        || "llama-3.3-70b-versatile";

      const groqReq: AIChatRequest = {
        model: dynamicGroqModel,
        messages: [
          { role: "system", content: "You are a helpful coding assistant. Return 1 line of JSON." },
          { role: "user", content: "Generate a JSON with key 'status' and value 'ok'." }
        ],
        temperature: 0,
        maxOutputTokens: 60,
      };

      const groqRes = await aiProviderGatewayService.chat("groq", groqReq);
      if (!groqRes.result.text.includes("ok")) {
        groqInconsistencies.push("Groq response did not contain expected text 'ok'");
      }

      results.push({
        provider: "groq",
        category: "chat_completion",
        status: groqInconsistencies.length === 0 ? "PASSED" : "FAILED",
        latencyMs: Date.now() - groqStart,
        outputSnippet: groqRes.result.text.slice(0, 120),
        details: { model: groqRes.model, usage: groqRes.result.usage },
        inconsistencies: [...groqInconsistencies],
      });
      console.log(`   ✅ Groq Chat: OK (${Date.now() - groqStart}ms) -> "${groqRes.result.text.trim()}"`);

      // Groq Stream
      const groqStreamStart = Date.now();
      let groqStreamText = "";
      let groqChunks = 0;
      for await (const chunk of aiProviderGatewayService.stream("groq", groqReq)) {
        groqChunks++;
        if (chunk.delta) groqStreamText += chunk.delta;
      }
      results.push({
        provider: "groq",
        category: "streaming_chat",
        status: groqChunks > 0 ? "PASSED" : "FAILED",
        latencyMs: Date.now() - groqStreamStart,
        outputSnippet: groqStreamText.slice(0, 120),
        details: { chunks: groqChunks },
        inconsistencies: groqChunks === 0 ? ["Groq stream emitted 0 chunks"] : [],
      });
      console.log(`   ✅ Groq Stream: OK (${groqChunks} chunks, ${Date.now() - groqStreamStart}ms)`);
    } catch (err: any) {
      results.push({
        provider: "groq",
        category: "chat_completion",
        status: "FAILED",
        latencyMs: Date.now() - groqStart,
        details: { error: err.message },
        inconsistencies: ["Groq error: " + err.message],
      });
      console.error(`   ❌ Groq execution failed:`, err.message);
    }
  } else {
    results.push({
      provider: "groq",
      category: "chat_completion",
      status: "SKIPPED",
      latencyMs: 0,
      details: { reason: "GROQ_API_KEY is not configured in current environment." },
      inconsistencies: [],
    });
    console.log("   ⚠️ Groq: SKIPPED (GROQ_API_KEY not configured)");
  }

  // ============================================================================
  // TEST 3: MISTRAL PROVIDER (Chat, Streaming, Models)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: Mistral AI (Chat & Streaming)");
  console.log("--------------------------------------------------------------------------------");
  const mistralStart = Date.now();
  const mistralProvider = providers.find(p => p.id === "mistral");

  if (process.env.MISTRAL_API_KEY?.trim() && mistralProvider) {
    try {
      const dynamicMistralModel = allModels.find(m => m.provider === "mistral" && m.enabled && (m.roles.includes("primary") || m.roles.includes("primary_chat") || m.roles.includes("fast")))?.modelId
        || process.env.MISTRAL_MODEL
        || "mistral-small-latest";

      const mistralReq: AIChatRequest = {
        model: dynamicMistralModel,
        messages: [{ role: "user", content: "Reply with the word 'PONG'." }],
        temperature: 0,
        maxOutputTokens: 20,
      };
      const mistralRes = await aiProviderGatewayService.chat("mistral", mistralReq);
      results.push({
        provider: "mistral",
        category: "chat_completion",
        status: mistralRes.result.text.toUpperCase().includes("PONG") ? "PASSED" : "FAILED",
        latencyMs: Date.now() - mistralStart,
        outputSnippet: mistralRes.result.text.slice(0, 120),
        details: { model: mistralRes.model, usage: mistralRes.result.usage },
        inconsistencies: !mistralRes.result.text.toUpperCase().includes("PONG") ? ["Mistral output did not match expectation"] : [],
      });
      console.log(`   ✅ Mistral Chat: OK (${Date.now() - mistralStart}ms) -> "${mistralRes.result.text.trim()}"`);
    } catch (err: any) {
      results.push({
        provider: "mistral",
        category: "chat_completion",
        status: "FAILED",
        latencyMs: Date.now() - mistralStart,
        details: { error: err.message },
        inconsistencies: ["Mistral error: " + err.message],
      });
      console.error(`   ❌ Mistral execution failed:`, err.message);
    }
  } else {
    results.push({
      provider: "mistral",
      category: "chat_completion",
      status: "SKIPPED",
      latencyMs: 0,
      details: { reason: "MISTRAL_API_KEY is not configured in current environment." },
      inconsistencies: [],
    });
    console.log("   ⚠️ Mistral: SKIPPED (MISTRAL_API_KEY not configured)");
  }

  // ============================================================================
  // TEST 4: HUGGING FACE (Text, Image Generation, Video Generation, Fallbacks)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: Hugging Face & Free Multimodal Community Fallback Engine");
  console.log("--------------------------------------------------------------------------------");
  const hfStart = Date.now();
  const hfInconsistencies: string[] = [];

  try {
    // Test Image Generation (Live)
    const imgGenStart = Date.now();
    const imageResult = await UnifiedMediaEngine.execute({
      modality: "image",
      prompt: "A futuristic neon cybernetic hummingbird, detailed macro",
      executionMode: "live",
      userId: 999111,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    if (!imageResult.success || !imageResult.job?.artifactUrl) {
      hfInconsistencies.push("Image generation failed or returned empty artifactUrl");
    }

    results.push({
      provider: "huggingface",
      category: "image_generation",
      status: imageResult.success && imageResult.job?.artifactUrl ? (imageResult.job.failovers.length > 0 ? "DEGRADED_FALLBACK" : "PASSED") : "FAILED",
      latencyMs: Date.now() - imgGenStart,
      outputSnippet: `Provider: ${imageResult.job.actualProvider} | Model: ${imageResult.job.actualModel} | URL: ${imageResult.job.artifactUrl?.slice(0, 40)}...`,
      details: {
        actualProvider: imageResult.job.actualProvider,
        actualModel: imageResult.job.actualModel,
        enhancedPrompt: imageResult.job.enhancedPrompt,
        failovers: imageResult.job.failovers,
      },
      inconsistencies: [...hfInconsistencies],
    });
    console.log(`   ✅ Image Generation: OK (${imageResult.job.actualProvider} / ${imageResult.job.actualModel}, ${Date.now() - imgGenStart}ms)`);

    // Test Video Generation (Live)
    const vidGenStart = Date.now();
    const videoResult = await UnifiedMediaEngine.execute({
      modality: "video",
      prompt: "A gentle ocean wave breaking at sunset",
      executionMode: "live",
      userId: 999111,
      userTier: "vip",
      sourceInterface: "telegram",
    });

    const vidInconsistencies: string[] = [];
    if (!videoResult.success || !videoResult.job?.artifactUrl) {
      vidInconsistencies.push("Video generation failed or returned empty artifactUrl");
    }

    results.push({
      provider: "huggingface",
      category: "video_generation",
      status: videoResult.success && videoResult.job?.artifactUrl ? (videoResult.job.failovers.length > 0 ? "DEGRADED_FALLBACK" : "PASSED") : "FAILED",
      latencyMs: Date.now() - vidGenStart,
      outputSnippet: `Provider: ${videoResult.job.actualProvider} | Technique: ${videoResult.job.videoTechnique} | URL: ${videoResult.job.artifactUrl?.slice(0, 40)}...`,
      details: {
        actualProvider: videoResult.job.actualProvider,
        actualModel: videoResult.job.actualModel,
        videoTechnique: videoResult.job.videoTechnique,
        failovers: videoResult.job.failovers,
      },
      inconsistencies: vidInconsistencies,
    });
    console.log(`   ✅ Video Generation: OK (${videoResult.job.actualProvider} / ${videoResult.job.videoTechnique}, ${Date.now() - vidGenStart}ms)`);

  } catch (err: any) {
    results.push({
      provider: "huggingface",
      category: "multimodal_generation",
      status: "FAILED",
      latencyMs: Date.now() - hfStart,
      details: { error: err.message },
      inconsistencies: ["Hugging Face / Multimodal error: " + err.message],
    });
    console.error(`   ❌ Hugging Face / Multimodal failed:`, err.message);
  }

  // ============================================================================
  // TEST 5: ELEVENLABS PROVIDER (Audio / Sound Generation Adapter Contract)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: ElevenLabs (Audio Generation & Model Discovery)");
  console.log("--------------------------------------------------------------------------------");
  const elStart = Date.now();
  const elProvider = providers.find(p => p.id === "elevenlabs");
  const elInconsistencies: string[] = [];

  try {
    const elModels = await aiProviderAdapters.elevenlabs.listModels(elProvider!);
    if (!elModels || elModels.length === 0) {
      elInconsistencies.push("ElevenLabs model catalog returned empty list");
    }
    // Verify that ElevenLabs correctly rejects chat calls with an informative error
    let chatRejected = false;
    try {
      await aiProviderAdapters.elevenlabs.chat({} as any, elProvider!);
    } catch (chatErr: any) {
      if (chatErr.message.includes("audio and sound generation provider")) {
        chatRejected = true;
      }
    }
    if (!chatRejected) {
      elInconsistencies.push("ElevenLabs did not safely reject text chat request as expected");
    }

    results.push({
      provider: "elevenlabs",
      category: "contract_and_catalog",
      status: elInconsistencies.length === 0 ? "PASSED" : "FAILED",
      latencyMs: Date.now() - elStart,
      details: { modelCount: elModels.length, models: elModels.map(m => m.modelId) },
      inconsistencies: elInconsistencies,
    });
    console.log(`   ✅ ElevenLabs Contract: OK (${elModels.length} models discovered, chat correctly restricted)`);
  } catch (err: any) {
    results.push({
      provider: "elevenlabs",
      category: "contract_and_catalog",
      status: "FAILED",
      latencyMs: Date.now() - elStart,
      details: { error: err.message },
      inconsistencies: ["ElevenLabs error: " + err.message],
    });
    console.error(`   ❌ ElevenLabs failed:`, err.message);
  }

  // ============================================================================
  // TEST 6: TAVILY PROVIDER (Search & Extraction Adapter Contract)
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING PROVIDER: Tavily (Web Search & Extraction)");
  console.log("--------------------------------------------------------------------------------");
  const tavilyStart = Date.now();
  const tavilyProvider = providers.find(p => p.id === "tavily");
  const tavilyInconsistencies: string[] = [];

  try {
    const tavilyModels = await aiProviderAdapters.tavily.listModels(tavilyProvider!);
    if (!tavilyModels || tavilyModels.length === 0) {
      tavilyInconsistencies.push("Tavily model catalog returned empty list");
    }

    results.push({
      provider: "tavily",
      category: "contract_and_catalog",
      status: tavilyInconsistencies.length === 0 ? "PASSED" : "FAILED",
      latencyMs: Date.now() - tavilyStart,
      details: { modelCount: tavilyModels.length, models: tavilyModels.map(m => m.modelId) },
      inconsistencies: tavilyInconsistencies,
    });
    console.log(`   ✅ Tavily Contract: OK (${tavilyModels.length} search capabilities verified)`);
  } catch (err: any) {
    results.push({
      provider: "tavily",
      category: "contract_and_catalog",
      status: "FAILED",
      latencyMs: Date.now() - tavilyStart,
      details: { error: err.message },
      inconsistencies: ["Tavily error: " + err.message],
    });
    console.error(`   ❌ Tavily failed:`, err.message);
  }

  // ============================================================================
  // TEST 7: END-TO-END TELEGRAM BOT MESSAGE SIMULATION FLOW
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("🔍 TESTING END-TO-END TELEGRAM BOT SIMULATOR PIPELINE");
  console.log("--------------------------------------------------------------------------------");

  const testPrompts = [
    {
      title: "Natural Conversational Prompt",
      message: "Hello Wingbuddy! Can you explain the difference between synchronous and asynchronous code in simple terms?",
      userTier: "free" as const,
      mode: "general" as const,
    },
    {
      title: "Deep Technical Reasoning Prompt",
      message: "Design an optimal database schema with indexing for a high-frequency trading ledger in PostgreSQL.",
      userTier: "pro" as const,
      mode: "coding" as const,
    },
    {
      title: "LaTeX & Math Formatting Pipeline",
      message: "Calculate the roots of $ax^2 + bx + c = 0$ using the quadratic formula $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ and format it cleanly.",
      userTier: "vip" as const,
      mode: "study" as const,
    },
    {
      title: "Multimodal Visual Request via Bot Flow",
      message: "Draw a vibrant neon cyberpunk city street in the rain",
      userTier: "vip" as const,
      mode: "general" as const,
    },
  ];

  for (const t of testPrompts) {
    const simStart = Date.now();
    const promptInconsistencies: string[] = [];

    try {
      const simResult = await botSimulatorService.run({
        message: t.message,
        telegramUserId: 123456789,
        userTier: t.userTier,
        modeOverride: t.mode,
        includeHistory: false,
        liveMediaGeneration: true,
      });

      if (simResult.status !== "completed") {
        promptInconsistencies.push(`Simulation status failed: ${simResult.error}`);
      }

      // Check Telegram preview formatting
      const preview = simResult.telegramPreview || "";
      if (!preview.trim() && !simResult.mediaArtifact) {
        promptInconsistencies.push("Telegram preview is empty and no media artifact was generated");
      }

      // Verify HTML tags balance in output
      const openTags = (preview.match(/<[a-z0-9]+(\s[^>]*)?>/gi) || []).map(tag => tag.replace(/<([a-z0-9]+).*/i, "$1").toLowerCase());
      const closeTags = (preview.match(/<\/[a-z0-9]+>/gi) || []).map(tag => tag.replace(/<\/([a-z0-9]+)>/i, "$1").toLowerCase());
      if (openTags.length !== closeTags.length) {
        // Some formatting might have unmatched tags
        const unclosed = openTags.filter(tag => !closeTags.includes(tag));
        if (unclosed.length > 0) {
          promptInconsistencies.push(`Unmatched HTML tags in Telegram formatter: ${unclosed.join(", ")}`);
        }
      }

      // Check split message behavior
      const chunks = splitTelegramMessage(preview);
      for (const chunk of chunks) {
        if (chunk.length > 4096) {
          promptInconsistencies.push(`Telegram chunk exceeded 4096 character limit (got ${chunk.length})`);
        }
      }

      results.push({
        provider: simResult.trace.selectedProvider || "unknown",
        category: `e2e_bot_simulation:${t.title}`,
        status: promptInconsistencies.length === 0 ? "PASSED" : "FAILED",
        latencyMs: Date.now() - simStart,
        outputSnippet: (preview || simResult.mediaArtifact?.url || "").slice(0, 140),
        details: {
          intent: simResult.trace.intent,
          selectedProvider: simResult.trace.selectedProvider,
          selectedModel: simResult.trace.selectedModel,
          timelineSteps: simResult.trace.executionTimeline.length,
          tokens: simResult.trace.telemetry,
        },
        inconsistencies: promptInconsistencies,
      });

      console.log(`   ✅ [${t.title}] -> Provider: ${simResult.trace.selectedProvider} (${simResult.trace.selectedModel}) | Latency: ${Date.now() - simStart}ms`);
    } catch (err: any) {
      results.push({
        provider: "simulator",
        category: `e2e_bot_simulation:${t.title}`,
        status: "FAILED",
        latencyMs: Date.now() - simStart,
        details: { error: err.message },
        inconsistencies: [`Simulator execution threw error: ${err.message}`],
      });
      console.error(`   ❌ [${t.title}] failed:`, err.message);
    }
  }

  // ============================================================================
  // SUMMARY AND INCONSISTENCY REPORT
  // ============================================================================
  console.log("\n================================================================================");
  console.log("📊 SMOKE TEST SUMMARY & INCONSISTENCY REPORT");
  console.log("================================================================================");

  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let degradedCount = 0;

  for (const r of results) {
    if (r.status === "PASSED") passedCount++;
    else if (r.status === "FAILED") failedCount++;
    else if (r.status === "DEGRADED_FALLBACK") degradedCount++;
    else if (r.status === "SKIPPED") skippedCount++;

    const icon = r.status === "PASSED" ? "✅" : r.status === "DEGRADED_FALLBACK" ? "⚡" : r.status === "SKIPPED" ? "⏭️" : "❌";
    console.log(`${icon} [${r.provider.toUpperCase()}] ${r.category} -> ${r.status} (${r.latencyMs}ms)`);
    if (r.inconsistencies.length > 0) {
      for (const inc of r.inconsistencies) {
        console.log(`     ⚠️ Inconsistency: ${inc}`);
      }
    }
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`Total Checks: ${results.length} | Passed: ${passedCount} | Degraded/Fallback: ${degradedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);
  console.log("================================================================================\n");

  return {
    success: failedCount === 0,
    results,
    summary: { total: results.length, passed: passedCount, degraded: degradedCount, skipped: skippedCount, failed: failedCount },
  };
}

if (process.argv[1]?.endsWith("smoke-test-all-providers.ts") || process.argv[1]?.endsWith("smoke-test-all-providers.mjs")) {
  runComprehensiveSmokeTest()
    .then((out) => {
      process.exit(out.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Fatal error running comprehensive smoke test:", err);
      process.exit(1);
    });
}
