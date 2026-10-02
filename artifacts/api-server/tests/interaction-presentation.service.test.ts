import { describe, expect, it } from "vitest";
import { InteractionPresentationService } from "../src/telegram/interaction-presentation.service";
import { REACTION_THEMES } from "../src/services/reaction-theme.service";

describe("InteractionPresentationService", () => {
  const service = new InteractionPresentationService();
  const testTheme = REACTION_THEMES.friendly_attentive;

  it("acknowledges received messages with the theme intake reaction and typing", () => {
    expect(service.decide({ state: "received" }, testTheme)).toEqual({
      reaction: "👀",
      chatAction: "typing",
    });
  });

  it("honors explicit trusted chat-action metadata", () => {
    expect(service.decide({ state: "executing_tool", chatAction: "upload_photo" }, testTheme).chatAction).toBe("upload_photo");
    expect(service.decide({ state: "executing_tool", chatAction: "upload_video" }, testTheme).chatAction).toBe("upload_video");
    expect(service.decide({ state: "executing_tool", chatAction: "upload_document" }, testTheme).chatAction).toBe("upload_document");
  });

  it("uses runtime progress metadata instead of hard-coded state labels", () => {
    expect(
      service.decide({
        state: "searching",
        operationLabel: "current source retrieval",
        userFacingProgress: true,
      }, testTheme).visibleProgressText,
    ).toContain("current source retrieval");
  });

  it("does not present active progress UI after terminal states", () => {
    expect(service.decide({ state: "completed" }, testTheme)).toEqual({});
    expect(service.decide({ state: "failed" }, testTheme)).toEqual({});
  });

  it("is deterministic for the same trusted runtime state", () => {
    const first = service.decide({ state: "reasoning", chatAction: "typing" }, testTheme);
    const second = service.decide({ state: "reasoning", chatAction: "typing" }, testTheme);
    expect(first).toEqual(second);
  });
});
