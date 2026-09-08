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
    completed: [], // terminal
    failed: [], // terminal
    cancelled: [], // terminal
  };

  /**
   * Deterministically derives the current active step and completion status from task steps.
   */
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

  /**
   * Validates and enforces allowed state transitions in the task lifecycle.
   */
  validateStatusTransition(currentStatus: TaskStatus, newStatus: TaskStatus): void {
    if (currentStatus === newStatus) return;

    const allowed = TaskService.VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid task status transition from '${currentStatus}' to '${newStatus}'`,
      );
    }
  }

  /**
   * Creates a new multi-step task with optional initial step breakdown.
   */
  async createTask(options: {
    telegramUserId: number | bigint;
    title: string;
    goal: string;
    conversationId?: number;
    taskType?: string;
    steps?: Array<{ title: string; description?: string }>;
    contextData?: Record<string, unknown>;
  }): Promise<{ task: AgentTaskRecord; steps: AgentTaskStepRecord[] }> {
    const telegramUserId = Number(options.telegramUserId);

    logger.info({ telegramUserId, title: options.title, goal: options.goal }, "TASK_CREATED");

    const task = await chatDatabaseService.createTask({
      telegramUserId,
      conversationId: options.conversationId,
      title: options.title,
      goal: options.goal,
      taskType: options.taskType ?? "general",
      status: "active",
      contextJson: options.contextData ? JSON.stringify(options.contextData) : undefined,
    });

    const stepRecords: AgentTaskStepRecord[] = [];
    const stepList = options.steps || [
      { title: "Analyze requirements and prepare structure", description: "Initial setup step" },
      { title: "Execute core task actions", description: "Main generation step" },
      { title: "Review and refine output", description: "Verification step" },
    ];

    for (let i = 0; i < stepList.length; i++) {
      const s = stepList[i];
      const stepRecord = await chatDatabaseService.createTaskStep({
        taskId: task.id,
        stepOrder: i + 1,
        title: s.title,
        description: s.description,
        status: i === 0 ? "running" : "pending",
      });
      stepRecords.push(stepRecord);
    }

    return { task, steps: stepRecords };
  }

  /**
   * Updates task status with strict transition validation.
   */
  async updateTaskStatus(
    taskId: number,
    newStatus: TaskStatus,
  ): Promise<AgentTaskRecord | null> {
    const existing = await chatDatabaseService.getTaskById(taskId);
    if (!existing) {
      throw new Error(`Task #${taskId} not found`);
    }

    const currentStatus = existing.status as TaskStatus;
    this.validateStatusTransition(currentStatus, newStatus);

    const completedAt = newStatus === "completed" ? new Date() : undefined;

    logger.info(
      {
        taskId,
        telegramUserId: existing.telegramUserId,
        previousTaskStatus: currentStatus,
        newTaskStatus: newStatus,
        previousStep: existing.currentStep,
        newStep: existing.currentStep,
        transition: `${currentStatus} -> ${newStatus}`,
        result: "SUCCESS",
      },
      "TASK_STATUS_UPDATED",
    );

    return chatDatabaseService.updateTask(taskId, {
      status: newStatus,
      completedAt,
    });
  }

  /**
   * Advances a step in the multi-step task pipeline using atomic PostgreSQL transactions.
   */
  async completeStep(
    taskId: number,
    stepOrder: number,
    resultSummary: string,
  ): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const steps = await chatDatabaseService.getTaskSteps(taskId);
    const targetStep = steps.find((s) => s.stepOrder === stepOrder);
    const nextStep = steps.find((s) => s.stepOrder === stepOrder + 1);

    const stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }> = [];
    if (targetStep) {
      stepUpdates.push({ stepOrder, status: "completed", resultSummary });
    }

    if (nextStep) {
      stepUpdates.push({ stepOrder: stepOrder + 1, status: "running" });
    }

    const res = await chatDatabaseService.updateTaskAndStepsAtomic({
      taskId,
      stepUpdates,
      currentStep: nextStep ? stepOrder + 1 : stepOrder,
      taskStatus: nextStep ? "active" : "completed",
    });

    logger.info(
      {
        taskId,
        telegramUserId: res.task?.telegramUserId,
        previousTaskStatus: "active",
        newTaskStatus: res.task?.status,
        previousStep: stepOrder,
        newStep: res.task?.currentStep,
        stepId: stepOrder,
        transition: `Step ${stepOrder} COMPLETED -> Step ${res.task?.currentStep} ${res.task?.status === "completed" ? "COMPLETED" : "ACTIVE"}`,
        result: "SUCCESS",
      },
      "TASK_TRANSITION_COMPLETED",
    );

    return res;
  }

  /**
   * Atomically updates task step statuses and task currentStep/status.
   */
  async updateTaskAndStepsAtomic(options: {
    taskId: number;
    stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }>;
    taskStatus?: string;
    currentStep?: number;
  }): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    return chatDatabaseService.updateTaskAndStepsAtomic(options);
  }

  /**
   * Parses model response for step progress / completion indicators and atomically persists step/task state.
   */
  async syncTaskProgressFromResponse(
    taskId: number,
    responseText: string,
  ): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const existingTask = await chatDatabaseService.getTaskById(taskId);
    if (!existingTask) {
      return { task: null, steps: [] };
    }

    const steps = await chatDatabaseService.getTaskSteps(taskId);
    if (steps.length === 0) {
      return { task: existingTask, steps: [] };
    }

    const stepUpdates: Array<{ stepOrder: number; status: string; resultSummary?: string }> = [];
    let detectedTaskCompletion = false;

    // Check for explicit task completion markers
    if (
      /\[TASK_COMPLETED\]/i.test(responseText) ||
      /\btask\s+(?:#?\d+\s+)?(?:is\s+)?(?:completed|finished|done)\b/i.test(responseText) ||
      /\ball\s+steps?\s+(?:for\s+task\s+#?\d+\s+)?(?:are\s+)?(?:completed|finished|done)\b/i.test(responseText)
    ) {
      detectedTaskCompletion = true;
    }

    // 1. Regex search for step completions or running status in text
    for (const s of steps) {
      const stepNum = s.stepOrder;
      const completedPattern = new RegExp(
        `(?:step\\s*#?${stepNum}\\b.*?\\b(?:completed|done|finished)|completed\\s+step\\s*#?${stepNum}\\b|\\[step_completed:\\s*${stepNum}\\])`,
        "i",
      );
      const runningPattern = new RegExp(
        `(?:step\\s*#?${stepNum}\\b.*?\\b(?:in progress|running|active|working on)|\\[step_running:\\s*${stepNum}\\]|\\[step_in_progress:\\s*${stepNum}\\])`,
        "i",
      );

      if (completedPattern.test(responseText)) {
        stepUpdates.push({ stepOrder: stepNum, status: "completed" });
      } else if (runningPattern.test(responseText)) {
        stepUpdates.push({ stepOrder: stepNum, status: "running" });
      }
    }

    // 2. Fallback heuristic: If no step regex matched, but runtime performed execution for the current active step
    if (stepUpdates.length === 0) {
      const { currentStep } = this.deriveCurrentStep(steps);
      const currentStepObj = steps.find((s) => s.stepOrder === currentStep);

      if (currentStepObj) {
        stepUpdates.push({ stepOrder: currentStep, status: "completed" });
        const nextStepObj = steps.find((s) => s.stepOrder === currentStep + 1);
        if (nextStepObj) {
          stepUpdates.push({ stepOrder: currentStep + 1, status: "running" });
        }
      }
    }

    if (detectedTaskCompletion) {
      for (const s of steps) {
        if (!stepUpdates.some((u) => u.stepOrder === s.stepOrder)) {
          stepUpdates.push({ stepOrder: s.stepOrder, status: "completed" });
        }
      }
    }

    const previousStep = existingTask.currentStep;
    const previousStatus = existingTask.status;

    const res = await chatDatabaseService.updateTaskAndStepsAtomic({
      taskId,
      stepUpdates,
      taskStatus: detectedTaskCompletion ? "completed" : undefined,
    });

    logger.info(
      {
        taskId,
        telegramUserId: existingTask.telegramUserId,
        previousTaskStatus: previousStatus,
        newTaskStatus: res.task?.status,
        previousStep,
        newStep: res.task?.currentStep,
        transition: `Step ${previousStep} -> Step ${res.task?.currentStep} (${res.task?.status})`,
        result: "SUCCESS",
      },
      "TASK_STEP_SYNC_COMPLETED",
    );

    return res;
  }

  /**
   * Retrieves active, pending, waiting, or paused tasks for a user from persistent PostgreSQL DB.
   */
  async getActiveTasksForUser(telegramUserId: number | bigint): Promise<AgentTaskRecord[]> {
    return chatDatabaseService.getActiveTasksForUser(Number(telegramUserId));
  }

  /**
   * Resolves the target task for user input or prompts for disambiguation if multiple tasks are active.
   */
  async resolveTargetTask(
    telegramUserId: number | bigint,
    taskHint?: string | number,
  ): Promise<{
    status: "EXACT_MATCH" | "SINGLE_ACTIVE" | "AMBIGUOUS" | "NO_ACTIVE";
    task?: AgentTaskRecord;
    activeTasks?: AgentTaskRecord[];
  }> {
    const activeTasks = await this.getActiveTasksForUser(telegramUserId);

    if (activeTasks.length === 0) {
      return { status: "NO_ACTIVE" };
    }

    if (taskHint) {
      if (typeof taskHint === "number") {
        const found = activeTasks.find((t) => t.id === taskHint);
        if (found) return { status: "EXACT_MATCH", task: found };
      } else {
        const lowerHint = String(taskHint).toLowerCase().trim();
        const found = activeTasks.find(
          (t) =>
            t.id.toString() === lowerHint ||
            t.title.toLowerCase().includes(lowerHint) ||
            t.goal.toLowerCase().includes(lowerHint),
        );
        if (found) return { status: "EXACT_MATCH", task: found };
      }
    }

    if (activeTasks.length === 1) {
      return { status: "SINGLE_ACTIVE", task: activeTasks[0] };
    }

    return { status: "AMBIGUOUS", activeTasks };
  }

  /**
   * Detects whether user text is expressing task management intent.
   */
  detectTaskIntent(text: string): TaskIntentResult {
    const trimmed = text.trim();

    // View task dashboard command
    if (/^\/tasks?\b/i.test(trimmed) || /^(show|list|view|my)\s+tasks?\b/i.test(trimmed)) {
      return { intent: "VIEW_TASKS" };
    }

    // Cancel task
    if (/^\/(cancel_task|canceltask|stop_task)\b/i.test(trimmed) || /\b(cancel|abort|stop)\s+(the|this|my)?\s*task\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return {
        intent: "CANCEL_TASK",
        taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined,
      };
    }

    // Pause task
    if (/^\/(pause_task|pausetask)\b/i.test(trimmed) || /\b(pause|hold)\s+(the|this|my)?\s*task\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return {
        intent: "PAUSE_TASK",
        taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined,
      };
    }

    // Complete task
    if (/^\/(finish_task|completetask)\b/i.test(trimmed) || /\b(mark|set)\s+(the|this|my)?\s*task\s+(as\s+)?(complete|done|finished)\b/i.test(trimmed)) {
      const matchId = trimmed.match(/#?(\d+)/);
      return {
        intent: "COMPLETE_TASK",
        taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined,
      };
    }

    // Continue task
    if (
      /^\/(continue|resume)\b/i.test(trimmed) ||
      /\b(continue|resume|next step|keep going with)\s+(the|this|my)?\s*task\b/i.test(trimmed)
    ) {
      const matchId = trimmed.match(/#?(\d+)/);
      return {
        intent: "CONTINUE_TASK",
        taskIdHint: matchId ? parseInt(matchId[1], 10) : undefined,
      };
    }

    // Create new multi-step task request
    const newTaskMatch = trimmed.match(
      /\b(?:start|create|begin|draft|build|plan)\s+(?:a\s+)?(?:new\s+)?(?:task|project|workflow|plan|report|guide)\s*[:\s]*(.+)/i,
    );
    if (newTaskMatch && newTaskMatch[1]) {
      const goalStr = newTaskMatch[1].trim();
      return {
        intent: "NEW_TASK",
        taskTitle: goalStr.slice(0, 50),
        taskGoal: goalStr,
      };
    }

    return { intent: "NO_TASK" };
  }

  /**
   * Appends artifact link/reference to task context.
   */
  async linkArtifactToTask(taskId: number, artifactKey: string, artifactRef: string): Promise<void> {
    const task = await chatDatabaseService.getTaskById(taskId);
    if (!task) return;

    let contextData: Record<string, unknown> = {};
    if (task.contextJson) {
      try {
        contextData = JSON.parse(task.contextJson);
      } catch {
        contextData = {};
      }
    }

    const artifacts = (contextData.artifacts as Record<string, string>) || {};
    artifacts[artifactKey] = artifactRef;
    contextData.artifacts = artifacts;

    await chatDatabaseService.updateTask(taskId, {
      contextJson: JSON.stringify(contextData),
    });

    logger.info({ taskId, artifactKey, artifactRef }, "ARTIFACT_LINKED_TO_TASK");
  }

  /**
   * Formats active task details and steps into a prompt block.
   */
  formatTaskForPrompt(task: AgentTaskRecord, steps: AgentTaskStepRecord[]): string {
    const stepLines = steps.map((s) => {
      const icon = s.status === "completed" ? "✓" : s.status === "running" ? "➔" : "⏳";
      const summary = s.resultSummary ? ` - Output: ${s.resultSummary}` : "";
      return `  ${icon} Step ${s.stepOrder}: ${s.title} [${s.status.toUpperCase()}]${summary}`;
    });

    let contextSummary = "";
    if (task.contextJson) {
      try {
        const parsed = JSON.parse(task.contextJson);
        if (parsed.artifacts) {
          contextSummary = `\n  Linked Artifacts: ${JSON.stringify(parsed.artifacts)}`;
        }
      } catch {
        // ignore
      }
    }

    return `\n\n[ACTIVE TASK CONTEXT (PERSISTENT TASK #${task.id})]\nTask Title: ${task.title}\nTask Goal: ${task.goal}\nCurrent Status: ${task.status.toUpperCase()}\nCurrent Active Step: ${task.currentStep}\nExecution Steps:\n${stepLines.join("\n")}${contextSummary}\n\nTask Execution Instructions:\n- Focus on advancing the current active step in this task.\n- Update task progress clearly in your response.`;
  }
}

export const taskService = new TaskService();
