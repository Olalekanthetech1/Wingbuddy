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

    logger.info({ taskId, previousStatus: currentStatus, newStatus }, "TASK_STATUS_UPDATED");

    return chatDatabaseService.updateTask(taskId, {
      status: newStatus,
      completedAt,
    });
  }

  /**
   * Advances a step in the multi-step task pipeline.
   */
  async completeStep(
    taskId: number,
    stepOrder: number,
    resultSummary: string,
  ): Promise<{ task: AgentTaskRecord | null; steps: AgentTaskStepRecord[] }> {
    const steps = await chatDatabaseService.getTaskSteps(taskId);
    const targetStep = steps.find((s) => s.stepOrder === stepOrder);

    if (targetStep) {
      await chatDatabaseService.updateTaskStep(targetStep.id, {
        status: "completed",
        resultSummary,
      });
    }

    const nextStep = steps.find((s) => s.stepOrder === stepOrder + 1);
    let updatedTask: AgentTaskRecord | null = null;

    if (nextStep) {
      await chatDatabaseService.updateTaskStep(nextStep.id, { status: "running" });
      updatedTask = await chatDatabaseService.updateTask(taskId, {
        currentStep: stepOrder + 1,
      });
      logger.info({ taskId, stepOrder, nextStepOrder: stepOrder + 1 }, "TASK_STEP_ADVANCED");
    } else {
      // All steps completed -> mark task completed
      updatedTask = await this.updateTaskStatus(taskId, "completed");
      logger.info({ taskId }, "TASK_ALL_STEPS_COMPLETED");
    }

    const updatedSteps = await chatDatabaseService.getTaskSteps(taskId);
    return { task: updatedTask, steps: updatedSteps };
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
