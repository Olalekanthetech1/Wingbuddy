import { describe, it, expect, beforeEach } from "vitest";
import { taskService } from "../src/services/task.service";
import { chatDatabaseService } from "@workspace/db";

describe("Agent Task State & Step Progress Synchronization Regression Tests", () => {
  const testUserId = 888111000;
  const testUserId2 = 888111001;

  beforeEach(async () => {
    // Clear active tasks for test users if needed
    const tasks1 = await chatDatabaseService.getActiveTasksForUser(testUserId);
    for (const t of tasks1) {
      await chatDatabaseService.updateTask(t.id, { status: "cancelled" });
    }
    const tasks2 = await chatDatabaseService.getActiveTasksForUser(testUserId2);
    for (const t of tasks2) {
      await chatDatabaseService.updateTask(t.id, { status: "cancelled" });
    }
  });

  it("Test 1 — Step persistence: Step 1 COMPLETED, Step 2 COMPLETED, Step 3 ACTIVE", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Research Turbine Blade Materials",
      goal: "Analyze high temperature performance",
      steps: [
        { title: "Analyze requirements" },
        { title: "Execute core actions" },
        { title: "Review and refine output" },
      ],
    });

    // Sync response where Step 1 & 2 completed, Step 3 in progress
    const responseText = `
- Step 1 — Completed: Analyzed requirements.
- Step 2 — Completed: Executed core actions.
- Step 3 — In Progress: Reviewing and refining output.
    `;

    const synced = await taskService.syncTaskProgressFromResponse(task.id, responseText);

    expect(synced.task).toBeDefined();
    expect(synced.task?.currentStep).toBe(3);
    expect(synced.task?.status).toBe("active");

    const steps = await chatDatabaseService.getTaskSteps(task.id);
    expect(steps.find((s) => s.stepOrder === 1)?.status).toBe("completed");
    expect(steps.find((s) => s.stepOrder === 2)?.status).toBe("completed");
    expect(steps.find((s) => s.stepOrder === 3)?.status).toBe("running");
  });

  it("Test 2 — /tasks current step reports Step 3, not Step 1", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Research Turbine Blade Materials",
      goal: "Analyze high temperature performance",
    });

    await taskService.syncTaskProgressFromResponse(
      task.id,
      "Step 1 — Completed. Step 2 — Completed. Step 3 — In Progress.",
    );

    const activeTasks = await taskService.getActiveTasksForUser(testUserId);
    expect(activeTasks.length).toBe(1);

    const target = activeTasks[0];
    const steps = await chatDatabaseService.getTaskSteps(target.id);
    const derived = taskService.deriveCurrentStep(steps);

    expect(derived.currentStep).toBe(3);
    expect(target.currentStep).toBe(3);
  });

  it("Test 3 — Continue task loads authoritative Step 3", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Research Turbine Blade Materials",
      goal: "Analyze high temperature performance",
    });

    await taskService.syncTaskProgressFromResponse(
      task.id,
      "Step 1 — Completed. Step 2 — Completed. Step 3 — In Progress.",
    );

    const resolved = await taskService.resolveTargetTask(testUserId, task.id);
    expect(resolved.status).toBe("EXACT_MATCH");
    expect(resolved.task?.id).toBe(task.id);
    expect(resolved.task?.currentStep).toBe(3);

    const steps = await chatDatabaseService.getTaskSteps(task.id);
    const derived = taskService.deriveCurrentStep(steps);
    expect(derived.currentStep).toBe(3);
    expect(derived.activeStep?.title).toContain("Review");
  });

  it("Test 4 — Post-continuation persistence", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Research Turbine Blade Materials",
      goal: "Analyze high temperature performance",
    });

    await taskService.syncTaskProgressFromResponse(
      task.id,
      "Step 1 — Completed. Step 2 — Completed. Step 3 — In Progress.",
    );

    // Simulate continuing task and finishing review on Step 3
    await taskService.syncTaskProgressFromResponse(
      task.id,
      "Step 3 — Completed: Critically reviewed technical claims. Task completed!",
    );

    const updatedTask = await chatDatabaseService.getTaskById(task.id);
    expect(updatedTask?.status).toBe("completed");

    const steps = await chatDatabaseService.getTaskSteps(task.id);
    expect(steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("Test 5 — Restart recovery: persisted state survives reload", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Task for Restart Test",
      goal: "Verify state persistence",
    });

    await taskService.completeStep(task.id, 1, "Completed step 1");
    await taskService.completeStep(task.id, 2, "Completed step 2");

    // Simulate service restart by re-fetching directly from DB
    const reloadedTasks = await chatDatabaseService.getActiveTasksForUser(testUserId);
    expect(reloadedTasks.length).toBe(1);
    expect(reloadedTasks[0].currentStep).toBe(3);
    expect(reloadedTasks[0].status).toBe("active");
  });

  it("Test 6 — Completion: final step finishes task", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Final Completion Test",
      goal: "Complete all steps",
    });

    await taskService.completeStep(task.id, 1, "Done step 1");
    await taskService.completeStep(task.id, 2, "Done step 2");
    await taskService.completeStep(task.id, 3, "Done step 3");

    const finishedTask = await chatDatabaseService.getTaskById(task.id);
    expect(finishedTask?.status).toBe("completed");
    expect(finishedTask?.completedAt).toBeDefined();

    const activeTasks = await taskService.getActiveTasksForUser(testUserId);
    expect(activeTasks.find((t) => t.id === task.id)).toBeUndefined();
  });

  it("Test 7 — No premature completion: task stays ACTIVE while step 3 is running", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Premature Completion Prevention",
      goal: "Ensure active state maintained",
    });

    await taskService.completeStep(task.id, 1, "Done 1");
    await taskService.completeStep(task.id, 2, "Done 2");

    const current = await chatDatabaseService.getTaskById(task.id);
    expect(current?.status).toBe("active");
    expect(current?.currentStep).toBe(3);
  });

  it("Test 8 — Multiple tasks report their own correct step independently", async () => {
    const { task: taskA } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Task A",
      goal: "Goal A",
    });
    const { task: taskB } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Task B",
      goal: "Goal B",
    });

    await taskService.completeStep(taskA.id, 1, "Task A Step 1 Done");

    const active = await taskService.getActiveTasksForUser(testUserId);
    const fetchedA = active.find((t) => t.id === taskA.id);
    const fetchedB = active.find((t) => t.id === taskB.id);

    expect(fetchedA?.currentStep).toBe(2);
    expect(fetchedB?.currentStep).toBe(1);
  });

  it("Test 9 — Ambiguous task selection when multiple tasks active and no hint provided", async () => {
    await taskService.createTask({
      telegramUserId: testUserId,
      title: "Task 1",
      goal: "Goal 1",
    });
    await taskService.createTask({
      telegramUserId: testUserId,
      title: "Task 2",
      goal: "Goal 2",
    });

    const resolved = await taskService.resolveTargetTask(testUserId);
    expect(resolved.status).toBe("AMBIGUOUS");
    expect(resolved.activeTasks?.length).toBe(2);
  });

  it("Test 10 — Concurrent continuation remains atomic and consistent", async () => {
    const { task } = await taskService.createTask({
      telegramUserId: testUserId,
      title: "Concurrent Continuation Test",
      goal: "Atomic state updates",
    });

    await Promise.all([
      taskService.completeStep(task.id, 1, "Concurrent call 1"),
      taskService.syncTaskProgressFromResponse(task.id, "Step 1 — Completed. Step 2 — In Progress."),
    ]);

    const finalTask = await chatDatabaseService.getTaskById(task.id);
    const finalSteps = await chatDatabaseService.getTaskSteps(task.id);

    expect(finalTask).toBeDefined();
    expect(finalTask?.currentStep).toBeGreaterThanOrEqual(2);

    const step1 = finalSteps.find((s) => s.stepOrder === 1);
    expect(step1?.status).toBe("completed");
  });
});
