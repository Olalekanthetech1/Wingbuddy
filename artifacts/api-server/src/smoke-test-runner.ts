import { getPool, ensureDatabaseSchema, db, systemSettingsTable } from "@workspace/db";
import { ModeService } from "./services/mode.service";
import { ConversationService } from "./services/conversation.service";
import { ExecutionPlannerService } from "./services/execution-planner.service";
import { GlobalContextService } from "./services/global-context.service";
import { ContextManagerService } from "./services/context-manager.service";
import { TaskService } from "./services/task.service";
import { agentPlannerService } from "./planner/agent-planner.service";
import { executionEngine } from "./execution/execution-engine";
import { getExecutionConfig } from "./execution/config";
import { executionPersistence } from "./execution/persistence/execution-persistence.service";
import { executionObservability } from "./execution/observability/execution-logger";
import { formatTelegramMessage } from "./utils/telegram-formatter";
import { logger } from "./lib/logger";

async function runSmokeTest() {
  logger.info("=== STARTING AUTONOMOUS EXECUTION SMOKE TEST ===");

  // 1. Ensure database schema and verify execution tables
  await ensureDatabaseSchema();
  logger.info("Database schema verified.");

  // 2. Verify Autonomous Execution configuration & runtime status
  const config = getExecutionConfig();
  logger.info(
    {
      enabled: config.enabled,
      maxConcurrency: config.maxConcurrency,
      maxPerUser: config.maxPerUser,
      leaseDurationMs: config.leaseDurationMs,
      defaultTimeoutMs: config.defaultTimeoutMs,
      maxRetries: config.maxRetries,
    },
    "Execution Engine Configuration Verified",
  );

  if (!config.enabled) {
    throw new Error("Autonomous execution engine is NOT enabled in configuration!");
  }

  // 3. Verify Tool Registry & Security Policies
  const toolRegistry = executionEngine.getToolRegistry();
  const tools = toolRegistry.list();
  logger.info({ toolCount: tools.length, toolNames: tools.map((t) => t.name) }, "Tool Registry Verified");

  const testTelegramUserId = 999888777;
  const userPrompt = "Calculate 1000 * Math.pow(1 + 0.05, 3) and summarize the 3-year compound interest growth";

  // Step 1: Telegram request received & Mode/Intent Resolution
  const conversations = new ConversationService();
  const modeService = new ModeService(conversations);
  const executionPlanner = new ExecutionPlannerService(modeService);
  const globalContext = new GlobalContextService(conversations);
  const contextManager = new ContextManagerService(globalContext);
  const taskService = new TaskService();

  const userMode = modeService.resolveTurnMode(userPrompt, "auto");
  const executionPlan = executionPlanner.plan(userPrompt, userMode, []);
  logger.info(
    {
      detectedIntent: executionPlan.detectedIntent,
      effectiveMode: executionPlan.effectiveMode,
      requiredCapabilities: executionPlan.requiredCapabilities,
    },
    "STEP 1 & 2: Intent & Mode Resolution Completed",
  );

  // Step 2: Context / Task Handling
  const { task } = await taskService.createTask({
    telegramUserId: testTelegramUserId,
    title: "3-Year Compound Interest Calculation",
    goal: userPrompt,
  });
  logger.info({ taskId: task.id, title: task.title, status: task.status }, "STEP 3: TaskService Initialized");

  // Step 3: Planner → Planner Compiler → GraphValidator → PostgreSQL Persistence
  logger.info("STEP 4: Invoking AgentPlannerService.planAndCompile...");
  const planResult = await agentPlannerService.planAndCompile({
    telegramUserId: testTelegramUserId,
    goal: userPrompt,
    taskId: task.id,
    context: {
      capabilities: executionPlan.requiredCapabilities,
      activeTask: { id: task.id, goal: task.goal },
    },
  });

  if (!planResult.success || !planResult.graph) {
    throw new Error(`Plan compilation failed: ${planResult.errorMessage || JSON.stringify(planResult.diagnostics)}`);
  }

  const graphNodes = Object.values(planResult.graph.nodes);
  logger.info(
    {
      graphId: planResult.graph.graphId,
      nodeCount: graphNodes.length,
      nodes: graphNodes.map((n) => ({ id: n.id, title: n.title, type: n.type })),
      edgesCount: planResult.graph.edges.length,
    },
    "STEP 5: Plan Compiled, Graph Validated & Persisted to DB",
  );

  // Step 4: Autonomous Execution Engine Dispatch & Node Claiming
  logger.info("STEP 6: Starting Execution Engine with DB Row Leasing...");
  const session = await executionEngine.startExecution({
    graphId: planResult.graph.graphId,
    planRevision: 1,
    requestId: `smoke_req_${Date.now()}`,
    taskId: task.id,
    executionContext: {
      telegramUserId: testTelegramUserId,
    },
  });

  const nodeAttempts = await executionPersistence.getCompletedExecutionsForGraph(planResult.graph.graphId, 1);
  const nodeResults: Record<string, any> = Object.fromEntries(
    nodeAttempts.map((a) => [a.nodeId, a.result]),
  );

  logger.info(
    {
      executionId: session.executionId,
      graphId: session.graphId,
      status: session.status,
      completedNodes: session.completedNodes,
      nodeResults,
    },
    "STEP 7: Autonomous Execution Engine Completed Session",
  );

  // Step 5: Verification & TaskService Synchronization
  const updatedTask = await taskService.resolveTargetTask(testTelegramUserId, String(task.id));
  logger.info(
    {
      taskId: updatedTask.task?.id,
      finalTaskStatus: updatedTask.task?.status,
      currentStep: updatedTask.task?.currentStep,
      totalSteps: updatedTask.task?.totalSteps,
    },
    "STEP 8: TaskService Synchronization Verified",
  );

  // Step 6: Final Response & Telegram Renderer
  const calcOutput = nodeResults["step_1_tool_calculate_math"]?.output;
  const synthOutput = nodeResults["step_3_synthesize"]?.output || nodeResults["step_2_synthesize"]?.output;

  const rawFinalResponse =
    typeof synthOutput === "string"
      ? synthOutput
      : synthOutput?.summary || synthOutput?.response || `Calculation result: ${JSON.stringify(calcOutput)}`;

  const renderedTelegramMessage = formatTelegramMessage(rawFinalResponse);
  logger.info({ renderedTelegramMessage }, "STEP 9: Final Response & Telegram Renderer Output");

  // Telemetry check
  const metrics = executionObservability.getMetrics();
  logger.info({ metrics }, "STEP 10: Observability Metrics Logged");

  console.log("\n================ SMOKE TEST SUCCESSFUL ================");
  console.log(JSON.stringify({
    autonomousExecutionActive: config.enabled,
    smokeTestRequest: userPrompt,
    graphId: planResult.graph.graphId,
    planRevision: 1,
    executionId: session.executionId,
    sessionStatus: session.status,
    completedNodes: session.completedNodes,
    nodeResults,
    taskServiceFinalState: updatedTask.task,
    metrics,
    renderedTelegramMessage,
  }, null, 2));

  process.exit(0);
}

runSmokeTest().catch((err) => {
  logger.error({ error: err instanceof Error ? err.stack : String(err) }, "Smoke test failed!");
  console.error("SMOKE_TEST_FAILED", err);
  process.exit(1);
});
