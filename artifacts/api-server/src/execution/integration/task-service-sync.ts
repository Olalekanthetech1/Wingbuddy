import { TaskService } from "../../services/task.service";
import { logger } from "../../lib/logger";
import type { GraphStatus } from "../../planner/types";

export class TaskServiceSync {
  constructor(private readonly taskService = new TaskService()) {}

  async syncGraphStatusToTask(
    taskId: number | undefined,
    status: GraphStatus,
    errorMessage?: string,
  ): Promise<void> {
    if (!taskId) return;

    try {
      switch (status) {
        case "executing":
          await this.taskService.updateTaskStatus(taskId, "active").catch(() => {});
          break;
        case "paused_for_approval":
          await this.taskService.updateTaskStatus(taskId, "waiting").catch(() => {});
          break;
        case "completed":
          await this.taskService.updateTaskStatus(taskId, "completed").catch(() => {});
          break;
        case "failed":
          await this.taskService.updateTaskStatus(taskId, "failed").catch(() => {});
          break;
        case "cancelled":
          await this.taskService.updateTaskStatus(taskId, "cancelled").catch(() => {});
          break;
      }
    } catch (err) {
      logger.warn(
        { taskId, status, err: String(err) },
        "TASK_SERVICE_STATUS_SYNC_FAILED",
      );
    }
  }

  async syncNodeCompletionToTask(
    taskId: number | undefined,
    stepOrder: number,
    nodeTitle: string,
  ): Promise<void> {
    if (!taskId) return;

    try {
      await this.taskService.completeStep(
        taskId,
        stepOrder,
        `Completed step ${stepOrder}: ${nodeTitle}`,
      );
    } catch (err) {
      logger.warn(
        { taskId, stepOrder, err: String(err) },
        "TASK_SERVICE_STEP_SYNC_FAILED",
      );
    }
  }
}

export const taskServiceSync = new TaskServiceSync();
