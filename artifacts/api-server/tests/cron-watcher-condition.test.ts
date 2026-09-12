import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class PrismaClient {
      agentTask = {
        update: vi.fn().mockResolvedValue({})
      };
    }
  };
});

import { CronTaskService } from "../src/services/cron-task.service";
import { agentPlannerService } from "../src/planner/agent-planner.service";
import { executionEngine } from "../src/planner/execution-engine.service";

vi.mock("../src/planner/agent-planner.service", () => ({
  agentPlannerService: { planAndCompile: vi.fn() }
}));

vi.mock("../src/planner/execution-engine.service", () => ({
  executionEngine: { startExecution: vi.fn() }
}));

vi.mock("../src/planner/execution-persistence.service", () => ({
  executionPersistence: { getCompletedExecutionsForGraph: vi.fn().mockResolvedValue([]) }
}));

vi.mock("../src/services/chat-database.service", () => ({
  chatDatabaseService: { getConversationMessages: vi.fn().mockResolvedValue([]), addMessage: vi.fn().mockResolvedValue({}) }
}));

vi.mock("../src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe("CronTaskService - Structured Watcher Conditions", () => {
  let cronService: CronTaskService;
  let mockBot: any;

  beforeEach(() => {
    vi.clearAllMocks();
    cronService = new CronTaskService();
    mockBot = { api: { sendMessage: vi.fn().mockResolvedValue({}) } };
    cronService.attachBot(mockBot);
  });

  it("should NOT send a telegram message if the structured output is silent", async () => {
    const task = { id: 1, title: "Crypto Watcher", goal: "Alert me if BTC drops", telegramUserId: 12345 };
    
    vi.mocked(agentPlannerService.planAndCompile).mockResolvedValueOnce({
      success: true,
      isDirectResponse: true,
      directResponse: JSON.stringify({ action: "silent", reason: "BTC is still high" }),
      diagnostics: []
    } as any);

    await (cronService as any).executeRecurringTask(task);

    expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("should send exactly ONE telegram message if the structured output is notify", async () => {
    const task = { id: 2, title: "Crypto Watcher", goal: "Alert me if BTC drops", telegramUserId: 12345 };
    
    vi.mocked(agentPlannerService.planAndCompile).mockResolvedValueOnce({
      success: true,
      isDirectResponse: true,
      directResponse: JSON.stringify({ action: "notify", reason: "BTC dropped", message: "🚨 BTC dropped below $50k" }),
      diagnostics: []
    } as any);

    await (cronService as any).executeRecurringTask(task);

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("🚨 BTC dropped below $50k"),
      expect.any(Object)
    );
  });
  
  it("should handle markdown-wrapped json output", async () => {
    const task = { id: 3, title: "News Watcher", goal: "Alert me on news", telegramUserId: 12345 };
    
    vi.mocked(agentPlannerService.planAndCompile).mockResolvedValueOnce({
      success: true,
      isDirectResponse: true,
      directResponse: "\`\`\`json\n{ \"action\": \"notify\", \"message\": \"News alert!\" }\n\`\`\`",
      diagnostics: []
    } as any);

    await (cronService as any).executeRecurringTask(task);

    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("News alert!"),
      expect.any(Object)
    );
  });
});
