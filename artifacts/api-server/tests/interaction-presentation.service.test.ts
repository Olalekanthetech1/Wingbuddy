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

  it("selects media actions from capability metadata rather than user wording", () => {
    expect(service.decide({ state: "executing_tool", capability: "image_generation" }).chatAction).toBe("upload_photo");
    expect(service.decide({ state: "executing_tool", capability: "video_generation" }).chatAction).toBe("upload_video");
    expect(service.decide({ state: "executing_tool", capability: "document_generation" }).chatAction).toBe("upload_document");
  });

  it("does not present active progress UI after terminal states", () => {
    expect(service.decide({ state: "completed" })).toEqual({});
    expect(service.decide({ state: "failed" })).toEqual({});
  });

  it("is deterministic for the same trusted runtime state", () => {
    const first = service.decide({ state: "reasoning", capability: "reasoning" });
    const second = service.decide({ state: "reasoning", capability: "reasoning" });
    expect(first).toEqual(second);
  });
});
