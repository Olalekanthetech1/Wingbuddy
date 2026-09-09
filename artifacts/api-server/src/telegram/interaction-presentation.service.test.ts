import { describe, expect, it } from "vitest";
import { InteractionPresentationService } from "./interaction-presentation.service";

describe("InteractionPresentationService", () => {
  const service = new InteractionPresentationService({ defaultReaction: "👀" });

  it("uses trusted runtime metadata instead of capability-name inference", () => {
    const imageEvent = service.decide({
      state: "executing_tool",
      toolName: "image_generation",
      chatAction: "upload_photo",
    });
    const videoEvent = service.decide({
      state: "executing_tool",
      toolName: "video_generation",
      chatAction: "upload_video",
    });

    expect(imageEvent.chatAction).toBe("upload_photo");
    expect(videoEvent.chatAction).toBe("upload_video");
  });

  it("does not infer tool behavior from user-facing words", () => {
    const decision = service.decide({
      state: "reasoning",
      operationLabel: "Analyze the screenshot",
    });

    expect(decision.chatAction).toBe("typing");
    expect(decision.reaction).toBe("👀");
  });

  it("keeps completed and failed states silent", () => {
    expect(service.decide({ state: "completed" })).toEqual({});
    expect(service.decide({ state: "failed" })).toEqual({});
  });

  it("builds progress from execution stage and trusted operation metadata", () => {
    expect(
      service.decide({
        state: "executing_tool",
        toolName: "web_search",
        userFacingProgress: true,
      }).visibleProgressText,
    ).toBe("Running tool: web_search…");
  });

  it("adds elapsed time only for long-running operations", () => {
    expect(
      service.decide({
        state: "generating",
        operationLabel: "video_generation",
        userFacingProgress: true,
        expectsLongRunning: true,
        elapsedMs: 11_000,
      }).visibleProgressText,
    ).toBe("Generating: video_generation (11s)" );
  });

  it("allows the runtime to suppress acknowledgement reactions", () => {
    expect(
      service.decide({
        state: "received",
        reaction: null,
      }).reaction,
    ).toBeUndefined();
  });
});
