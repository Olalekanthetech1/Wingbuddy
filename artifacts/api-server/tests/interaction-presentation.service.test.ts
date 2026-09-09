import { describe, expect, it } from "vitest";
import { InteractionPresentationService } from "../src/telegram/interaction-presentation.service";

describe("InteractionPresentationService", () => {
  const service = new InteractionPresentationService({ refreshMs: 1500, defaultReaction: "👀" });

  it("acknowledges unknown/normal work with a neutral reaction and typing", () => {
    expect(service.decide({ state: "received" })).toEqual({
      reaction: "👀",
      chatAction: "typing",
    });
  });

  it("honors explicit trusted chat-action metadata", () => {
    expect(service.decide({ state: "executing_tool", chatAction: "upload_photo" }).chatAction).toBe("upload_photo");
    expect(service.decide({ state: "executing_tool", chatAction: "upload_video" }).chatAction).toBe("upload_video");
    expect(service.decide({ state: "executing_tool", chatAction: "upload_document" }).chatAction).toBe("upload_document");
  });

  it("uses runtime progress metadata instead of hard-coded state labels", () => {
    expect(
      service.decide({
        state: "searching",
        operationLabel: "current source retrieval",
        userFacingProgress: true,
      }).visibleProgressText,
    ).toContain("current source retrieval");
    expect(
      service.decide({
        state: "searching",
        operationLabel: "current source retrieval",
        userFacingProgress: true,
      }).visibleProgressText,
    ).not.toContain("Searching:");
  });

  it("does not present active progress UI after terminal states", () => {
    expect(service.decide({ state: "completed" })).toEqual({});
    expect(service.decide({ state: "failed" })).toEqual({});
  });

  it("is deterministic for the same trusted runtime state", () => {
    const first = service.decide({ state: "reasoning", chatAction: "typing" });
    const second = service.decide({ state: "reasoning", chatAction: "typing" });
    expect(first).toEqual(second);
  });
});
