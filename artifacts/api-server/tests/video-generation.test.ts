import { describe, expect, it } from "vitest";
import { VideoGenerationService } from "../src/services/video-generation.service";

describe("VideoGenerationService - Prompt Extraction & Handling", () => {
  it("cleans command prefixes from prompts", () => {
    expect(
      VideoGenerationService.extractVideoPrompt(
        "/video a futuristic train speeding across a cybernetic desert",
      ),
    ).toBe("a futuristic train speeding across a cybernetic desert");

    expect(
      VideoGenerationService.extractVideoPrompt(
        "/vid cinematic ocean sunset with soaring seagulls",
      ),
    ).toBe("cinematic ocean sunset with soaring seagulls");

    expect(
      VideoGenerationService.extractVideoPrompt(
        "/clip slow motion water drop creating ripples",
      ),
    ).toBe("slow motion water drop creating ripples");
  });

  it("extracts core visual prompt from natural video requests", () => {
    expect(
      VideoGenerationService.extractVideoPrompt(
        "Can you generate a video of a golden retriever running along a beach",
      ),
    ).toBe("a golden retriever running along a beach");

    expect(
      VideoGenerationService.extractVideoPrompt(
        "Please create a video about volcanic lava flowing into the ocean",
      ),
    ).toBe("volcanic lava flowing into the ocean");

    expect(
      VideoGenerationService.extractVideoPrompt(
        "make an animation showing a seedling sprouting and blooming into a flower",
      ),
    ).toBe("a seedling sprouting and blooming into a flower");
  });

  it("handles prompt enhancement fallback gracefully when gemini service is absent", async () => {
    const prompt = "drone flying through clouds";
    const result = await VideoGenerationService.enhanceVideoPrompt(prompt, undefined);
    expect(result).toBe("drone flying through clouds");
  });
});
