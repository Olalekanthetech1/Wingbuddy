import {
  chatDatabaseService,
  type AgentTaskRecord,
  type AgentTaskStepRecord,
} from "@workspace/db";
import { logger } from "../lib/logger";
import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";

export type TaskStatus = "pending" | "active" | "paused" | "waiting" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TaskIntentResult {
  intent: "NEW_TASK" | "CONTINUE_TASK" | "PAUSE_TASK" | "COMPLETE_TASK" | "CANCEL_TASK" | "VIEW_TASKS" | "NO_TASK";
  taskTitle?: string;
  taskGoal?: string;
  taskIdHint?: number;
  steps?: string[];
}

export class TaskService {
  private static readonly VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: ["active", "cancelled", "failed"],
    active: ["paused", "waiting", "completed", "failed", "cancelled"],
    paused: ["active", "cancelled"],
    waiting: ["active", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };

  deriveCurrentStep(steps: AgentTaskStepRecord[]): { currentStep: number; activeStep?: AgentTaskStepRecord; isAllCompleted: boolean } {
    if (!steps || steps.length === 0) return { currentStep: 1, isAllCompleted: false };
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const running = sorted.find((s) => s.status === "running");
    if (running) return { currentStep: running.stepOrder, activeStep: running, isAllCompleted: false };
    const pending = sorted.find((s) => s.status === "pending");
    if (pending) return { currentStep: pending.stepOrder, activeStep: pending, isAllCompleted: false };
    const allCompleted = sorted.every((s) => s.status === "completed" || s.status === "skipped");
    if (allCompleted) return { currentStep: sorted[sorted.length - 1].stepOrder, activeStep: sorted[sorted.length - 1], isAllCompleted: true };
    return { currentStep: sorted[sorted.length - 1].stepOrder, activeStep: sorted[sorted.length - 1], isAllCompleted: false };
  }

  validateStatusTransition(currentStatus: TaskStatus, newStatus: TaskStatus): void {
    if (currentStatus === newStatus) return;
    const allowed = TaskService.VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) throw new Error(`Invalid task status transition from '${currentStatus}' to '${newStatus}'`);
  }

  async createTask(options: {
    telegramUserId: number | bigint;
    title: string;
    goal: string;
    conversationId?: number;
    taskType?: string;
    status?: TaskStatus;
    steps?: Array<{ title: string; description?: string }>;
    contextData?: Record<string, unknown>;
    metadataData?: Record<string, unknown>;
  }): Promise<{ task: AgentTaskRecord; steps: AgentTaskStepRecord[] }> {
    const telegramUserId = Number(options.telegramUserId);
    const status = options.status ?? "active";
    const task = await chatDatabaseService.createTask({
      telegramUserId,
      conversationId: options.conversationId,
      title: options.title,
      goal: options.goal,
      taskType: options.taskType ?? "general",
      status,
      contextJson: options.contextData ? JSON.stringify(options.contextData) : undefined,
      metadataJson: options.metadataData ? JSON.stringify(options.metadataData) : undefined,
    });

    const defaultSteps = [
      { title: "Analyze requirements and prepare structure", description: "Initial setup step" },
      { title: "Execute core task actions", description: "Main generation step" },
      { title: "Review and refine output", description: "Verification step" },
    ];
    const stepList = options.steps && options.steps.length > 0 ? options.steps : defaultSteps;
    const stepRecords: AgentTaskStepRecord[] = [];
    for (let i = 0; i < stepList.length; i++) {
      const step = stepList[i];
      stepRecords.push(await chatDatabaseService.createTaskStep({
        taskId: task.id,
        stepOrder: i + 1,
        title: step.title,
        description: step.description,
        status: status === "waiting" || status === "paused" ? "pending" : i === 0 ? "running" : "pending",
      }));
    }

    logger.info({ telegramUserId, taskId: task.id, title: task.title, status, stepCount: stepRecords.length }, "TASK_CREATED");
    return { task, steps: stepRecords };
  }

  async updateTaskStatus(taskId: number, newStatus: TaskStatus): Promise<AgentTaskRecord | null> {
    const existing = await chatDatabaseService.getTaskById(taskId);
    if (!existing) throw new Error(`Task #${taskId} not found`);
    const currentStatus = existing.status as TaskStatus;
    this.validateStatusTransition(currentStatus, newStatus);
    return chatDatabaseService.updateTask(taskId, { status: newStatus, completedAt: newStatus === "completed" ? new Date() : undefined });
  }

  async completeStep(taskId: number, stepOrder: number, resultSummary: string): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const steps = await chatDatabaseService.getTaskSteps(taskId);
    const target = steps.find((s) => s.stepOrder === stepOrder);
    const next = steps.find((s) => s.stepOrder === stepOrder + 1);
    const stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }> = [];
    if (target) stepUpdates.push({ stepOrder, status: "completed", resultSummary });
    if (next) stepUpdates.push({ stepOrder: stepOrder + 1, status: "running" });
    return chatDatabaseService.updateTaskAndStepsAtomic({ taskId, stepUpdates, currentStep: next ? stepOrder + 1 : stepOrder, taskStatus: next ? "active" : "completed" });
  }

  async updateTaskAndStepsAtomic(options: { taskId: number; stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }>; taskStatus?: string; currentStep?: number }): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    return chatDatabaseService.updateTaskAndStepsAtomic(options);
  }

  async syncTaskProgressFromResponse(taskId: number, responseText: string): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const existingTask = await chatDatabaseService.getTaskById(taskId);
    if (!existingTask) return { task: null, steps: [] };
    const steps = await chatDatabaseService.getTaskSteps(taskId);
    if (steps.length === 0) return { task: existingTask, steps: [] };

    const stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }> = [];
    const detectedTaskCompletion = /\[TASK_COMPLETED\]/i.test(responseText) || /\btask\s+(?:#?\d+\s+)?(?:is\s+)?(?:completed|finished|done)\b/i.test(responseText) || /\ball\s+steps?\s+(?:for\s+task\s+#?\d+\s+)?(?:are\s+)?(?:completed|finished|done)\b/i.test(responseText);

    for (const step of steps) {
      const n = step.stepOrder;
      const completed = new RegExp(`(?:step\\s*#?${n}\\b.*?\\b(?:completed|done|finished)|completed\\s+step\\s*#?${n}\\b|\\[step_completed:\\s*${n}\\])`, "i");
      const running = new RegExp(`(?:step\\s*#?${n}\\b.*?\\b(?:in progress|running|active|working on)|\\[step_running:\\s*${n}\\]|\\[step_in_progress:\\s*${n}\\])`, "i");
      if (completed.test(responseText)) stepUpdates.push({ stepOrder: n, status: "completed" });
      else if (running.test(responseText)) stepUpdates.push({ stepOrder: n, status: "running" });
    }

    if (stepUpdates.length === 0) {
      const { currentStep } = this.deriveCurrentStep(steps);
      const current = steps.find((s) => s.stepOrder === currentStep);
      if (current) {
        stepUpdates.push({ stepOrder: currentStep, status: "completed" });
        const next = steps.find((s) => s.stepOrder === currentStep + 1);
        if (next) stepUpdates.push({ stepOrder: currentStep + 1, status: "running" });
      }
    }

    if (detectedTaskCompletion) {
      for (const step of steps) if (!stepUpdates.some((u) => u.stepOrder === step.stepOrder)) stepUpdates.push({ stepOrder: step.stepOrder, status: "completed" });
    }

    return chatDatabaseService.updateTaskAndStepsAtomic({ taskId, stepUpdates, taskStatus: detectedTaskCompletion ? "completed" : undefined });
  }

  async getActiveTasksForUser(telegramUserId: number | bigint): Promise<AgentTaskRecord[]> {
    return chatDatabaseService.getActiveTasksForUser(Number(telegramUserId));
  }

  async resolveTargetTask(telegramUserId: number | bigint, taskHint?: string | number): Promise<{ status: "EXACT_MATCH" | "SINGLE_ACTIVE" | "AMBIGUOUS" | "NO_ACTIVE"; task?: AgentTaskRecord; activeTasks?: AgentTaskRecord[] }> {
    const activeTasks = await this.getActiveTasksForUser(telegramUserId);
    if (activeTasks.length === 0) return { status: "NO_ACTIVE" };
    if (taskHint !== undefined && taskHint !== null && taskHint !== "") {
      if (typeof taskHint === "number") {
        const found = activeTasks.find((t) => t.id === taskHint);
        if (found) return { status: "EXACT_MATCH", task: found };
      } else {
        const hint = String(taskHint).toLowerCase().trim();
        const found = activeTasks.find((t) => t.id.toString() === hint || t.title.toLowerCase().includes(hint) || t.goal.toLowerCase().includes(hint));
        if (found) return { status: "EXACT_MATCH", task: found };
      }
    }
    if (activeTasks.length === 1) return { status: "SINGLE_ACTIVE", task: activeTasks[0] };
    return { status: "AMBIGUOUS", activeTasks };
  }

  /**
   * Natural-language task routing is owned by SemanticInteractionResolverService.
   * This method remains as a compatibility boundary for explicit command handlers.
   */
  detectTaskIntent(_text: string, semantic?: SemanticInteractionDecision | null): TaskIntentResult {
    if (!semantic?.taskIntent) return { intent: "NO_TASK" };
    return {
      intent: semantic.taskIntent,
      taskTitle: semantic.taskTitle,
      taskGoal: semantic.taskGoal,
      taskIdHint: semantic.taskIdHint,
      steps: semantic.taskSteps,
    };
  }
}

export const taskService = new TaskService();
