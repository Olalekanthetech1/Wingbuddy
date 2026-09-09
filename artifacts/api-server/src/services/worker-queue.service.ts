import type { Update } from "grammy/types";
import { logger } from "../lib/logger";
import { safeErrorMetadata } from "../utils/safe-error";
import { apiKeyPoolService } from "./api-key-pool.service";

export interface QueueTask {
  id: string;
  update: Update;
  receivedAt: number;
  userId?: number;
  chatId?: number;
  retries: number;
}

export interface QueueMetrics {
  enqueuedTotal: number;
  completedTotal: number;
  failedTotal: number;
  activeWorkers: number;
  maxConcurrency: number;
  pendingQueueLength: number;
  avgProcessingTimeMs: number;
  userQueuesCount: number;
}

export class TelegramWorkerQueueService {
  private readonly userQueues: Map<string, QueueTask[]> = new Map();
  private readonly processingUsers: Set<string> = new Set();
  private readonly processedUpdates: Map<number, { taskId: string; status: 'queued' | 'processing' | 'completed' | 'failed'; timestamp: number }> = new Map();
  private activeWorkers = 0;
  private enqueuedTotal = 0;
  private completedTotal = 0;
  private failedTotal = 0;
  private totalProcessingTimeMs = 0;
  private isShuttingDown = false;
  private handler?: (update: Update) => Promise<void>;

  setUpdateHandler(handler: (update: Update) => Promise<void>): void {
    this.handler = handler;
    // Drain updates that may have arrived while runtime hydration/handler wiring was completing.
    this.scheduleProcessing();
  }

  computeAdaptiveConcurrency(): number {
    try {
      const summary = apiKeyPoolService.getSummary();
      const healthyKeys = Math.max(1, summary.healthyKeys || 1);
      const inCooldown = summary.inCooldownKeys || 0;
      const baseConcurrency = healthyKeys * 3;
      const effectiveConcurrency = Math.max(2, baseConcurrency - inCooldown);
      return Math.min(20, effectiveConcurrency);
    } catch {
      return 3;
    }
  }

  enqueue(update: Update): { taskId: string; queueLength: number } {
    if (this.isShuttingDown) {
      logger.warn({ updateId: update.update_id }, "Worker queue is shutting down; update rejected");
      throw new Error("Worker queue is stopping");
    }

    const existing = this.processedUpdates.get(update.update_id);
    if (existing && (existing.status === 'queued' || existing.status === 'processing' || existing.status === 'completed')) {
      logger.info({ updateId: update.update_id, existingTaskId: existing.taskId, status: existing.status }, "Duplicate Telegram update delivery deduplicated idempotently");
      return { taskId: existing.taskId, queueLength: this.getPendingCount() };
    }

    const taskId = `task_${update.update_id}`;
    const userOrChatKey = this.extractRoutingKey(update);
    const task: QueueTask = {
      id: taskId,
      update,
      receivedAt: Date.now(),
      userId: this.extractUserId(update),
      chatId: this.extractChatId(update),
      retries: 0,
    };

    this.processedUpdates.set(update.update_id, { taskId, status: 'queued', timestamp: Date.now() });
    if (!this.userQueues.has(userOrChatKey)) this.userQueues.set(userOrChatKey, []);
    this.userQueues.get(userOrChatKey)!.push(task);
    this.enqueuedTotal += 1;
    this.scheduleProcessing();
    return { taskId, queueLength: this.getPendingCount() };
  }

  private extractRoutingKey(update: Update): string {
    const userId = this.extractUserId(update);
    if (userId) return `user_${userId}`;
    const chatId = this.extractChatId(update);
    if (chatId) return `chat_${chatId}`;
    return `update_${update.update_id}`;
  }

  private extractUserId(update: Update): number | undefined {
    return update.message?.from?.id || update.callback_query?.from?.id || update.edited_message?.from?.id || update.inline_query?.from?.id;
  }

  private extractChatId(update: Update): number | undefined {
    return update.message?.chat?.id || update.callback_query?.message?.chat?.id || update.edited_message?.chat?.id;
  }

  private scheduleProcessing(): void {
    if (!this.handler || this.isShuttingDown) return;
    const maxConcurrency = this.computeAdaptiveConcurrency();

    for (const [userKey, queue] of this.userQueues.entries()) {
      if (this.activeWorkers >= maxConcurrency) break;
      if (this.processingUsers.has(userKey)) continue;
      if (queue.length === 0) {
        this.userQueues.delete(userKey);
        continue;
      }

      const nextTask = queue.shift()!;
      this.processingUsers.add(userKey);
      this.activeWorkers += 1;
      void this.executeTask(userKey, nextTask);
    }
  }

  private async executeTask(userKey: string, task: QueueTask): Promise<void> {
    const start = Date.now();
    this.processedUpdates.set(task.update.update_id, { taskId: task.id, status: 'processing', timestamp: start });
    try {
      if (this.handler) await this.handler(task.update);
      this.completedTotal += 1;
      const duration = Date.now() - start;
      this.totalProcessingTimeMs += duration;
      this.processedUpdates.set(task.update.update_id, { taskId: task.id, status: 'completed', timestamp: Date.now() });
      logger.debug({ taskId: task.id, userKey, updateId: task.update.update_id, durationMs: duration, waitTimeMs: start - task.receivedAt }, "Worker completed Telegram update task");
    } catch (error) {
      this.failedTotal += 1;
      this.processedUpdates.set(task.update.update_id, { taskId: task.id, status: 'failed', timestamp: Date.now() });
      logger.error({ taskId: task.id, userKey, updateId: task.update.update_id, error: safeErrorMetadata(error) }, "Worker failed executing Telegram update task");
    } finally {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.processingUsers.delete(userKey);
      const currentQueue = this.userQueues.get(userKey);
      if (currentQueue && currentQueue.length === 0) this.userQueues.delete(userKey);
      setImmediate(() => this.scheduleProcessing());
    }
  }

  private getPendingCount(): number {
    let count = 0;
    for (const q of this.userQueues.values()) count += q.length;
    return count;
  }

  getMetrics(): QueueMetrics {
    const avgProcessingTimeMs = this.completedTotal > 0 ? Math.round(this.totalProcessingTimeMs / this.completedTotal) : 0;
    return { enqueuedTotal: this.enqueuedTotal, completedTotal: this.completedTotal, failedTotal: this.failedTotal, activeWorkers: this.activeWorkers, maxConcurrency: this.computeAdaptiveConcurrency(), pendingQueueLength: this.getPendingCount(), avgProcessingTimeMs, userQueuesCount: this.userQueues.size };
  }

  async drain(timeoutMs = 5000): Promise<void> {
    this.isShuttingDown = true;
    const deadline = Date.now() + timeoutMs;
    while ((this.activeWorkers > 0 || this.getPendingCount() > 0) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export const telegramWorkerQueue = new TelegramWorkerQueueService();
