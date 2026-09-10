import { describe, expect, it } from "vitest";
import { TaskService } from "./task.service";
import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";

function decision(overrides: Partial<SemanticInteractionDecision> = {}): SemanticInteractionDecision {
  return {
    intent: "image_generation",
    promptTypes: ["DIRECT_COMMAND", "CONSTRAINT_DRIVEN", "ZERO_SHOT"],
    primaryPromptType: "DIRECT_COMMAND",
    executionProfile: "durable",
    effectiveMode: "creative",
    requiredCapabilities: ["file_generation"],
    enableSearch: false,
    isModeSwitch: false,
    isGreeting: false,
    complexity: "simple",
    confidence: 0.98,
    taskIntent: "NEW_TASK",
    taskTitle: "Generate Futuristic AI Companion Brand Visual",
    taskGoal: "Generate the requested image",
    taskSteps: ["Generate image", "Review image", "Deliver image"],
    durabilityEvidence: [],
    conversationOperation: "new_request",
    ...overrides,
  };
}

describe("TaskService.detectTaskIntent", () => {
  const service = new TaskService();

  it("suppresses a one-shot image request even when the classifier incorrectly marks it durable", () => {
    const result = service.detectTaskIntent(
      "Generate a detailed futuristic AI companion image with a transparent background.",
      decision(),
    );

    expect(result.intent).toBe("NO_TASK");
  });

  it("suppresses a one-shot video request without durability evidence", () => {
    const result = service.detectTaskIntent(
      "Generate a short cinematic video of a futuristic city at night.",
      decision({ intent: "video_generation" }),
    );

    expect(result.intent).toBe("NO_TASK");
  });

  it("preserves a genuinely durable image workflow when explicit durability evidence exists", () => {
    const result = service.detectTaskIntent(
      "Generate the image and keep the workflow active for future approved variations.",
      decision({
        durabilityEvidence: ["EXPLICIT_PERSISTENCE"],
      }),
    );

    expect(result.intent).toBe("NEW_TASK");
    expect(result.taskTitle).toBe("Generate Futuristic AI Companion Brand Visual");
  });

  it("continues allowing durable non-media tasks", () => {
    const result = service.detectTaskIntent(
      "Start a tracked research workflow for this project.",
      decision({
        intent: "deep_reasoning",
        executionProfile: "durable",
        taskIntent: "NEW_TASK",
        durabilityEvidence: [],
      }),
    );

    expect(result.intent).toBe("NEW_TASK");
  });

  it("does not create a task when the semantic resolver says NO_TASK", () => {
    const result = service.detectTaskIntent(
      "Generate an image of a cat.",
      decision({ taskIntent: "NO_TASK", taskTitle: undefined, taskGoal: undefined, taskSteps: undefined }),
    );

    expect(result.intent).toBe("NO_TASK");
  });
});
