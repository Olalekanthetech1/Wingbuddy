import {
  chatDatabaseService,
  type AgentTaskRecord,
  type AgentTaskStepRecord,
} from "@workspace/db";
import { logger } from "../lib/logger";

export type TaskStatus =
  | "pending"
  | "active"
  | "paused"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TaskIntentResult {
  intent:
    | "NEW_TASK"
    | "CONTINUE_TASK"
    | "PAUSE_TASK"
    | "COMPLETE_TASK"
    | "CANCEL_TASK"
    | "VIEW_TASKS"
    | "NO_TASK";
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

  deriveCurrentStep(steps: AgentTaskStepRecord[]): {
    currentStep: number;
    activeStep?: AgentTaskStepRecord;
    isAllCompleted: boolean;
  } {
    if (!steps || steps.length === 0) {
      return { currentStep: 1, isAllCompleted: false };
    }
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const running = sorted.find((s) => s.status === "running");
    if (running) {
      return { currentStep: running.stepOrder, activeStep: running, isAllCompleted: false };
    }
    const pending = sorted.find((s) => s.status === "pending");
    if (pending) {
      return { currentStep: pending.stepOrder, activeStep: pending, isAllCompleted: false };
    }
    const allCompleted = sorted.every((s) => s.status === "completed" || s.status === "skipped");
    if (allCompleted) {
      const last = sorted[sorted.length - 1];
      return { currentStep: last.stepOrder, activeStep: last, isAllCompleted: true };
    }
    const last = sorted[sorted.length - 1];
    return { currentStep: last.stepOrder, activeStep: last, isAllCompleted: false };
  }

  validateStatusTransition(currentStatus: TaskStatus, newStatus: TaskStatus): void {
    if (currentStatus === newStatus) return;
    const allowed = TaskService.VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid task status transition from '${currentStatus}' to '${newStatus}'`);
    }
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
    logger.info({ telegramUserId, title: options.title, goal: options.goal, status }, "TASK_CREATED");

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

    const stepList = options.steps || [
      { title: "Analyze requirements and prepare structure", description: "Initial setup step" },
      { title: "Execute core task actions", description: "Main generation step" },
      { title: "Review and refine output", description: "Verification step" },
    ];

    const stepRecords: AgentTaskStepRecord[] = [];
    for (let i = 0; i < stepList.length; i++) {
      const s = stepList[i];
      stepRecords.push(await chatDatabaseService.createTaskStep({
        taskId: task.id,
        stepOrder: i + 1,
        title: s.title,
        description: s.description,
        status: status === "waiting" || status === "paused"
          ? "pending"
          : i === 0 ? "running" : "pending",
      }));
    }

    return { task, steps: stepRecords };
  }

  async updateTaskStatus(taskId: number, newStatus: TaskStatus): Promise<AgentTaskRecord | null> {
    const existing = await chatDatabaseService.getTaskById(taskId);
    if (!existing) throw new Error(`Task #${taskId} not found`);
    const currentStatus = existing.status as TaskStatus;
    this.validateStatusTransition(currentStatus, newStatus);
    const completedAt = newStatus === "completed" ? new Date() : undefined;
    logger.info({
      taskId,
      telegramUserId: existing.telegramUserId,
      previousTaskStatus: currentStatus,
      newTaskStatus: newStatus,
      previousStep: existing.currentStep,
      newStep: existing.currentStep,
      transition: `${currentStatus} -> ${newStatus}`,
      result: "SUCCESS",
    }, "TASK_STATUS_UPDATED");
    return chatDatabaseService.updateTask(taskId, { status: newStatus, completedAt });
  }

  async completeStep(taskId: number, stepOrder: number, resultSummary: string): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const steps = await chatDatabaseService.getTaskSteps(taskId);
    const targetStep = steps.find((s) => s.stepOrder === stepOrder);
    const nextStep = steps.find((s) => s.stepOrder === stepOrder + 1);
    const stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }> = [];
    if (targetStep) stepUpdates.push({ stepOrder, status: "completed", resultSummary });
    if (nextStep) stepUpdates.push({ stepOrder: stepOrder + 1, status: "running" });
    const res = await chatDatabaseService.updateTaskAndStepsAtomic({
      taskId,
      stepUpdates,
      currentStep: nextStep ? stepOrder + 1 : stepOrder,
      taskStatus: nextStep ? "active" : "completed",
    });
    logger.info({
      taskId,
      telegramUserId: res.task?.telegramUserId,
      previousTaskStatus: "active",
      newTaskStatus: res.task?.status,
      previousStep: stepOrder,
      newStep: res.task?.currentStep,
      stepId: stepOrder,
      transition: `Step ${stepOrder} COMPLETED -> Step ${res.task?.currentStep} ${res.task?.status === "completed" ? "COMPLETED" : "ACTIVE"}`,
      result: "SUCCESS",
    }, "TASK_TRANSITION_COMPLETED");
    return res;
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
    let detectedTaskCompletion = false;
    if (/[TASK_COMPLETED]/i.test(responseText) || /\btask\s+(?:#?\d+\s+)?(?:is\s+)?(?:completed|finished|done)\b/i.test(responseText) || /\ball\s+steps?\s+(?:for\s+task\s+#?\d+\s+)?(?:are\s+)?(?:completed|finished|done)\b/i.test(responseText)) {
      detectedTaskCompletion = true;
    }

    for (const s of steps) {
      const stepNum = s.stepOrder;
      const completedPattern = new RegExp(`(?:step\\s*#?${stepNum}\\b.*?\\b(?:completed|done|finished)|completed\\s+step\\s*#?${stepNum}\\b|\\[step_completed:\\s*${stepNum}\\])`, "i");
      const runningPattern = new RegExp(`(?:step\\s*#?${stepNum}\\b.*?\\b(?:in progress|running|active|working on)|\\[step_running:\\s*${stepNum}\\]|\\[step_in_progress:\\s*${stepNum}\\])`, "i");
      if (completedPattern.test(responseText)) stepUpdates.push({ stepOrder: stepNum, status: "completed" });
      else if (runningPattern.test(responseText)) stepUpdates.push({ stepOrder: stepNum, status: "running" });
    }

    if (stepUpdates.length === 0) {
      const { currentStep } = this.deriveCurrentStep(steps);
      const currentStepObj = steps.find((s) => s.stepOrder === currentStep);
      if (currentStepObj) {
        stepUpdates.push({ stepOrder: currentStep, status: "completed" });
        const nextStepObj = steps.find((s) => s.stepOrder === currentStep + 1);
        if (nextStepObj) stepUpdates.push({ stepOrder: currentStep + 1, status: "running" });
      }
    }

    if (detectedTaskCompletion) {
      for (const s of steps) {
        if (!stepUpdates.some((u) => u.stepOrder === s.stepOrder)) stepUpdates.push({ stepOrder: s.stepOrder, status: "completed" });
      }
    }

    const previousStep = existingTask.currentStep;
    const previousStatus = existingTask.status;
    const res = await chatDatabaseService.updateTaskAndStepsAtomic({
      taskId,
      stepUpdates,
      taskStatus: detectedTaskCompletion ? "completed" : undefined,
    });
    logger.info({
      taskId,
      telegramUserId: existingTask.telegramUserId,
      previousTaskStatus: previousStatus,
      newTaskStatus: res.task?.status,
      previousStep,
      newStep: res.task?.currentStep,
      transition: `Step ${previousStep} -> ${res.task?.currentStep} (${res.task?.status})`,
      result: "SUCCESS",
    }, "TASK_STEP_SYNC_COMPLETED");
    return res;
  }

  async getActiveTasksForUser(telegramUserId: number | bigint): Promise<AgentTaskRecord[]> {
    return chatDatabaseService.getActiveTasksForUser(Number(telegramUserId));
  }

  async resolveTargetTask(telegramUserId: number | bigint, taskHint?: string | number): Promise<{ status: "EXACT_MATCH" | "SINGLE_ACTIVE" | "AMBIGUOUS" | "NO_ACTIVE"; task?: AgentTaskRecord; activeTasks?: AgentTaskRecord[] }> {
    const activeTasks = await this.getActiveTasksForUser(telegramUserId);
    if (activeTasks.length === 0) return { status: "NO_ACTIVE" };
    if (taskHint) {
      if (typeof taskHint === "number") {
        const found = activeTasks.find((t) => t.id === taskHint);
        if (found) return { status: "EXACT_MATCH", task: found };
      } else {
        const lowerHint = String(taskHint).toLowerCase().trim();
        const found = activeTasks.find((t) => t.id.toString() === lowerHint || t.title.toLowerCase().includes(lowerHint) || t.goal.toLowerCase().includes(lowerHint));
        if (found) return { status: "EXACT_MATCH", task: found };
      }
    }
    if (activeTasks.length === 1) return { status: "SINGLE_ACTIVE", task: activeTasks[0] };
    return { status: "AMBIGUOUS", activeTasks };
  }

  detectTaskIntent(text: string): TaskIntentResult {
    const trimmed = text.trim();
    if (/^\/tasks?\b/i.test(trimmed) || /^(show|list|view|my)\s+tasks?\b/i.test(trimmed)) return { intent: "VIEW_TASKS" };
    if (/^\/(cancel_task|canceltask|stop_task)\b/i.test(trimmed) || /\b(cancel|abort|stop)\s+(the|this|my)?\s*task\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return { intent: "CANCEL_TASK", taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined };
    }
    if (/^\/(pause_task|pausetask)\b/i.test(trimmed) || /\b(pause|hold)\s+(the|this|my)?\s*task\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return { intent: "PAUSE_TASK", taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined };
    }
    if (/^\/(finish_task|completetask)\b/i.test(trimmed) || /\b(mark|set)\s+(the|this|my)?\s*task\s+(as\s+)?(complete|done|finished)\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return { intent: "COMPLETE_TASK", taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined };
    }
    if (/^\/(continue|resume)\b/i.test(trimmed) || /\b(continue|resume|pick up|carry on)\s+(the|this|my)?\s*(task|plan|work|project)?\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return { intent: "CONTINUE_TASK", taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined };
    }
    const newTaskMatch = trimmed.match(/^(?:create|start|begin|make)\s+(?:a\s+)?(?:new\s+)?(?:task|project|workflow)\b(?:\s*[:\-]?\s*)(.*)$/i);
    if (newTaskMatch) {
      const title = newTaskMatch[1].trim() || "New Task";
      return { intent: "NEW_TASK", taskTitle: title, taskGoal: title };
    }
    return { intent: "NO_TASK" };
  }
}

export const taskService = new TaskService();
