import { describe, expect, it } from "vitest";
import {
  reactionThemeService,
  REACTION_THEMES,
  ALLOWED_TELEGRAM_REACTIONS,
  type ReactionThemeDefinition,
} from "../src/services/reaction-theme.service";
import { InteractionPresentationService } from "../src/telegram/interaction-presentation.service";

describe("ReactionThemeService & Telegram Reaction Validation", () => {
  it("strictly validates that every built-in theme emoji belongs to Telegram's ALLOWED_TELEGRAM_REACTIONS", () => {
    for (const [themeKey, theme] of Object.entries(REACTION_THEMES)) {
      if (!theme.enabled) continue;
      const validation = reactionThemeService.validateThemeEmojis(theme);
      expect(
        validation.valid,
        `Theme '${themeKey}' contains invalid Telegram emojis: ${validation.invalidEmojis.join(", ")}`
      ).toBe(true);
      expect(validation.invalidEmojis).toHaveLength(0);

      // Verify all pill emojis are also valid
      for (const pill of theme.pills) {
        if (pill.emoji) {
          expect(
            ALLOWED_TELEGRAM_REACTIONS.has(pill.emoji),
            `Pill emoji '${pill.emoji}' in theme '${themeKey}' is not allowed by Telegram`
          ).toBe(true);
        }
      }
    }
  });

  it("rejects invalid emojis outside Telegram ReactionTypeEmoji set (such as ✨, 🧠, 🚀, 💡)", () => {
    const invalidTheme: ReactionThemeDefinition = {
      id: "invalid_test",
      name: "Invalid Theme",
      description: "Uses unsupported emojis",
      pills: [],
      emojis: {
        intake: "✨", // Invalid
        tasks: "🧠", // Invalid
        ideas_or_analysis: "💡", // Invalid
        done: "🚀", // Invalid
      },
      enabled: true,
    };

    const result = reactionThemeService.validateThemeEmojis(invalidTheme);
    expect(result.valid).toBe(false);
    expect(result.invalidEmojis).toContain("intake: ✨");
    expect(result.invalidEmojis).toContain("tasks: 🧠");
    expect(result.invalidEmojis).toContain("ideas_or_analysis: 💡");
    expect(result.invalidEmojis).toContain("done: 🚀");
  });

  it("zero-fallback: emits no reaction when reactions are disabled or unconfigured", () => {
    const service = new InteractionPresentationService();
    const disabledTheme = REACTION_THEMES.disabled;

    const decision = service.decide({ state: "received" }, disabledTheme);
    expect(decision.reaction).toBeUndefined();
    expect(decision.chatAction).toBe("typing");
  });

  it("dynamically routes contextual reaction states according to the active theme", () => {
    const service = new InteractionPresentationService();
    const modernTheme = REACTION_THEMES.modern_snappy;

    // Intake state
    const intakeDecision = service.decide({ state: "received" }, modernTheme);
    expect(intakeDecision.reaction).toBe("⚡");

    // Task / Tool execution state
    const taskDecision = service.decide({ state: "executing_tool" }, modernTheme);
    expect(taskDecision.reaction).toBe("✍️");

    // Analysis / Reasoning state
    const reasoningDecision = service.decide({ state: "reasoning" }, modernTheme);
    expect(reasoningDecision.reaction).toBe("🤔");

    // Friendly theme
    const friendlyTheme = REACTION_THEMES.friendly_attentive;
    expect(service.decide({ state: "received" }, friendlyTheme).reaction).toBe("👀");
    expect(service.decide({ state: "executing_tool" }, friendlyTheme).reaction).toBe("👌");

    // AI theme
    const aiTheme = REACTION_THEMES.ai_futuristic;
    expect(service.decide({ state: "received" }, aiTheme).reaction).toBe("👾");
    expect(service.decide({ state: "reasoning" }, aiTheme).reaction).toBe("🤓");
  });

  it("never returns reaction or visible UI for terminal states (completed / failed)", () => {
    const service = new InteractionPresentationService();
    const modernTheme = REACTION_THEMES.modern_snappy;

    expect(service.decide({ state: "completed" }, modernTheme)).toEqual({});
    expect(service.decide({ state: "failed" }, modernTheme)).toEqual({});
  });
});
