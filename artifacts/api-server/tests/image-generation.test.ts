import { describe, expect, it } from "vitest";
import { ImageGenerationService } from "../src/services/image-generation.service";

describe("ImageGenerationService - Prompt Extraction & Handling", () => {
  it("cleans command prefixes from prompts", () => {
    expect(ImageGenerationService.extractImagePrompt("/image a cybernetic tiger")).toBe(
      "a cybernetic tiger",
    );
    expect(ImageGenerationService.extractImagePrompt("/draw cozy cabin in winter")).toBe(
      "cozy cabin in winter",
    );
    expect(ImageGenerationService.extractImagePrompt("/img futuristic city at sunset")).toBe(
      "futuristic city at sunset",
    );
  });

  it("extracts core visual prompt from conversational requests", () => {
    expect(
      ImageGenerationService.extractImagePrompt(
        "Can you generate an image of an astronaut playing guitar on Mars",
      ),
    ).toBe("an astronaut playing guitar on Mars");

    expect(
      ImageGenerationService.extractImagePrompt(
        "Please draw me a picture of a cute golden retriever wearing glasses",
      ),
    ).toBe("a cute golden retriever wearing glasses");

    expect(
      ImageGenerationService.extractImagePrompt(
        "create an illustration of a medieval library full of floating books",
      ),
    ).toBe("a medieval library full of floating books");
  });

  it("handles prompt enhancement fallback gracefully when gemini service is absent", async () => {
    const prompt = "sunset over ocean";
    const result = await ImageGenerationService.enhancePrompt(prompt, undefined);
    expect(result).toBe("sunset over ocean");
  });
});
