import { describe, expect, it, vi } from "vitest";
import { TelegramWorkerQueueService } from "../src/services/worker-queue.service";
import type { Update } from "grammy/types";

describe("TelegramWorkerQueueService", () => {
  it("enqueues updates and calculates queue length immediately", () => {
    const queue = new TelegramWorkerQueueService();
    const update1: Update = {
      update_id: 1001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 555, type: "private" },
        from: { id: 777, is_bot: false, first_name: "Test" },
        text: "Hello",
      },
    };

    const res = queue.enqueue(update1);
    expect(res.taskId).toContain("task_1001");
    expect(res.queueLength).toBe(1);

    const metrics = queue.getMetrics();
    expect(metrics.enqueuedTotal).toBe(1);
    expect(metrics.maxConcurrency).toBeGreaterThanOrEqual(2);
  });

  it("processes updates asynchronously with per-user FIFO execution", async () => {
    const queue = new TelegramWorkerQueueService();
    const executionOrder: number[] = [];

    queue.setUpdateHandler(async (update) => {
      // Simulate slight processing delay
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push(update.update_id);
    });

    const user1UpdateA: Update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "User1" },
        text: "Msg 1",
      },
    };

    const user1UpdateB: Update = {
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 100, type: "private" },
        from: { id: 100, is_bot: false, first_name: "User1" },
        text: "Msg 2",
      },
    };

    queue.enqueue(user1UpdateA);
    queue.enqueue(user1UpdateB);

    await queue.drain(1000);

    expect(executionOrder).toEqual([1, 2]);
    const metrics = queue.getMetrics();
    expect(metrics.completedTotal).toBe(2);
    expect(metrics.failedTotal).toBe(0);
  });

  it("isolates errors so a failed task does not crash the queue", async () => {
    const queue = new TelegramWorkerQueueService();

    queue.setUpdateHandler(async (update) => {
      if (update.update_id === 99) {
        throw new Error("Simulated update handler crash");
      }
    });

    const failingUpdate: Update = {
      update_id: 99,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 200, type: "private" },
        from: { id: 200, is_bot: false, first_name: "User2" },
        text: "Bad msg",
      },
    };

    const successUpdate: Update = {
      update_id: 100,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 300, type: "private" },
        from: { id: 300, is_bot: false, first_name: "User3" },
        text: "Good msg",
      },
    };

    queue.enqueue(failingUpdate);
    queue.enqueue(successUpdate);

    await queue.drain(1000);

    const metrics = queue.getMetrics();
    expect(metrics.enqueuedTotal).toBe(2);
    expect(metrics.failedTotal).toBe(1);
    expect(metrics.completedTotal).toBe(1);
  });
});
