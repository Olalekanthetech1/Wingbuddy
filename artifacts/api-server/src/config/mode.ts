export const MODE_KEYS = [
  "general",
  "study",
  "coder",
  "deep_research",
  "math",
  "creative",
  "auto",
] as const;

export type ModeKey = (typeof MODE_KEYS)[number];

export type Capability =
  | "tutoring"
  | "active_recall"
  | "socratic_questioning"
  | "code_generation"
  | "code_analysis"
  | "debugging"
  | "web_research"
  | "source_verification"
  | "document_analysis"
  | "mathematical_reasoning"
  | "image_analysis"
  | "file_generation"
  | "memory"
  | "calculator";

export interface ModeToolPermissions {
  searchAllowed: boolean;
  thinkingAllowed: boolean;
  imageGenAllowed: boolean;
  videoGenAllowed: boolean;
}

export interface ModeCapabilities {
  enableSearchDefault: boolean;
  thinkingLevelDefault?: "LOW" | "MEDIUM" | "HIGH" | undefined;
  responseStyle: string;
  formattingRules?: string;
  toolPermissions: ModeToolPermissions;
}

export interface ModeProfile {
  id: ModeKey;
  key: ModeKey; // Backward-compatible alias for id
  displayName: string;
  label: string; // Backward-compatible alias for displayName
  description: string;
  systemBehavior: string;
  instruction: string; // Backward-compatible alias for systemBehavior
  preferredResponseStyle: string;
  formattingProfile: string;
  capabilitiesList: Capability[];
  capabilities: ModeCapabilities; // Backward-compatible capabilities configuration
  preferredTools: string[];
  toolRestrictions: string[];
  reasoningProfile: string;
  researchPolicy: "on_demand" | "always" | "never";
  codingPolicy: "strict" | "general" | "none";
  tutoringPolicy: "socratic" | "direct" | "none";
}

const BASE_MODES: Record<ModeKey, ModeProfile> = {
  general: {
    id: "general",
    key: "general",
    displayName: "🤖 General Assistant",
    label: "🤖 General Assistant",
    description: "Versatile everyday assistant for general tasks and Q&A.",
    systemBehavior:
      "Act as a versatile general assistant. Adapt your answer to the user's goal, keeping simple requests simple and adding structure only when it helps.",
    instruction:
      "Act as a versatile general assistant. Adapt your answer to the user's goal, keeping simple requests simple and adding structure only when it helps.",
    preferredResponseStyle: "balanced, helpful, and direct",
    formattingProfile: "Clear conversational Markdown with standard headings and lists.",
    capabilitiesList: ["memory", "document_analysis"],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: undefined,
      responseStyle: "balanced, helpful, and direct",
      formattingRules: "Clear conversational Markdown with standard headings and lists.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: true,
        videoGenAllowed: true,
      },
    },
    preferredTools: ["search", "image_generation", "video_generation"],
    toolRestrictions: [],
    reasoningProfile: "Standard direct reasoning.",
    researchPolicy: "on_demand",
    codingPolicy: "general",
    tutoringPolicy: "none",
  },
  study: {
    id: "study",
    key: "study",
    displayName: "📚 Study Tutor",
    label: "📚 Study Tutor",
    description: "Socratic learning, active recall, and step-by-step guidance.",
    systemBehavior:
      "Act as a patient study tutor. Explain ideas clearly, teach the underlying reasoning, check understanding when useful, and guide the learner using Socratic questioning, formula LaTeX rendering, and structured study notes.",
    instruction:
      "Act as a patient study tutor. Explain ideas clearly, teach the underlying reasoning, check understanding when useful, and guide the learner using Socratic questioning, formula LaTeX rendering, and structured study notes.",
    preferredResponseStyle: "encouraging, educational, Socratic",
    formattingProfile:
      "Structured study notes, bold key terms, LaTeX formulas ($...$), ending with a quick comprehension check.",
    capabilitiesList: [
      "tutoring",
      "socratic_questioning",
      "active_recall",
      "mathematical_reasoning",
    ],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: undefined,
      responseStyle: "encouraging, educational, Socratic",
      formattingRules:
        "Use LaTeX for math/formulas ($...$), bold key terms, and end with a quick comprehension question.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: true,
        videoGenAllowed: false,
      },
    },
    preferredTools: ["calculator", "search"],
    toolRestrictions: ["video_generation"],
    reasoningProfile: "Pedagogical step-by-step decomposition.",
    researchPolicy: "on_demand",
    codingPolicy: "none",
    tutoringPolicy: "socratic",
  },
  coder: {
    id: "coder",
    key: "coder",
    displayName: "💻 Coder",
    label: "💻 Coder",
    description: "Technical code generation, debugging, and architecture analysis.",
    systemBehavior:
      "Act as an expert senior software engineer and coding assistant. Reason about edge cases, provide production-ready solutions with clean code blocks, and explicitly address concurrency, type safety, and verification.",
    instruction:
      "Act as an expert senior software engineer and coding assistant. Reason about edge cases, provide production-ready solutions with clean code blocks, and explicitly address concurrency, type safety, and verification.",
    preferredResponseStyle: "technical, precise, code-first",
    formattingProfile:
      "Clean markdown code blocks with explicit language tags, inline comments, and technical rationale.",
    capabilitiesList: [
      "code_generation",
      "code_analysis",
      "debugging",
      "document_analysis",
    ],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: "LOW",
      responseStyle: "technical, precise, code-first",
      formattingRules:
        "Use clean markdown code blocks with language tags and inline comments.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: false,
        videoGenAllowed: false,
      },
    },
    preferredTools: ["search"],
    toolRestrictions: ["image_generation", "video_generation"],
    reasoningProfile: "Invariant checking, edge case exploration, and stack trace analysis.",
    researchPolicy: "on_demand",
    codingPolicy: "strict",
    tutoringPolicy: "none",
  },
  deep_research: {
    id: "deep_research",
    key: "deep_research",
    displayName: "🌐 Deep Research",
    label: "🌐 Deep Research",
    description: "Fact grounding, web research, and source verification.",
    systemBehavior:
      "Act as an authoritative research specialist. Ground findings in verified up-to-date sources, cite authoritative links, compare multiple perspectives, and synthesize complex technical or contemporary information.",
    instruction:
      "Act as an authoritative research specialist. Ground findings in verified up-to-date sources, cite authoritative links, compare multiple perspectives, and synthesize complex technical or contemporary information.",
    preferredResponseStyle: "objective, well-sourced, synthesized",
    formattingProfile:
      "Citations, bulleted synthesis, clear evidence separation, and direct source links.",
    capabilitiesList: [
      "web_research",
      "source_verification",
      "document_analysis",
    ],
    capabilities: {
      enableSearchDefault: true,
      thinkingLevelDefault: undefined,
      responseStyle: "objective, well-sourced, synthesized",
      formattingRules: "Include citations, bullet points, and source links.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: true,
        videoGenAllowed: true,
      },
    },
    preferredTools: ["search"],
    toolRestrictions: [],
    reasoningProfile: "Evidence validation and source credibility assessment.",
    researchPolicy: "always",
    codingPolicy: "none",
    tutoringPolicy: "none",
  },
  math: {
    id: "math",
    key: "math",
    displayName: "🧮 Math & Reasoning",
    label: "🧮 Math & Reasoning",
    description: "Rigorous multi-step logic, mathematical proofs, and problem solving.",
    systemBehavior:
      "Act as an analytical mathematician, logic and reasoning specialist. Systematically solve problems step-by-step: 1) State invariants & definitions. 2) Show work with LaTeX equations. 3) Sanity-check edge cases. 4) State verified conclusion.",
    instruction:
      "Act as an analytical mathematician, logic and reasoning specialist. Systematically solve problems step-by-step: 1) State invariants & definitions. 2) Show work with LaTeX equations. 3) Sanity-check edge cases. 4) State verified conclusion.",
    preferredResponseStyle: "analytical, rigorous, step-by-step",
    formattingProfile:
      "Numbered logic steps, display LaTeX ($$...$$), and formal proofs.",
    capabilitiesList: ["mathematical_reasoning", "calculator"],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: "LOW",
      responseStyle: "analytical, rigorous, step-by-step",
      formattingRules:
        "Use clear numbered steps, logic blocks, and LaTeX math ($$...$$) where appropriate.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: false,
        videoGenAllowed: false,
      },
    },
    preferredTools: ["calculator"],
    toolRestrictions: ["image_generation", "video_generation"],
    reasoningProfile: "Formal deductive reasoning and self-correction.",
    researchPolicy: "never",
    codingPolicy: "none",
    tutoringPolicy: "direct",
  },
  creative: {
    id: "creative",
    key: "creative",
    displayName: "✨ Creative & Writing",
    label: "✨ Creative & Writing",
    description: "Brainstorming, ideation, drafting, and prose polishing.",
    systemBehavior:
      "Act as an energetic creative partner and editor. Generate imaginative ideas, refine written pieces while preserving author voice, and explore novel angles.",
    instruction:
      "Act as an energetic creative partner and editor. Generate imaginative ideas, refine written pieces while preserving author voice, and explore novel angles.",
    preferredResponseStyle: "creative, expansive, engaging",
    formattingProfile:
      "Actionable categorized lists, vivid metaphors, and polished prose blocks.",
    capabilitiesList: ["file_generation", "image_analysis"],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: undefined,
      responseStyle: "creative, expansive, engaging",
      formattingRules:
        "Group ideas into distinct categories with action-oriented headers.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: false,
        imageGenAllowed: true,
        videoGenAllowed: true,
      },
    },
    preferredTools: ["image_generation", "video_generation", "search"],
    toolRestrictions: [],
    reasoningProfile: "Lateral ideation and stylistic critique.",
    researchPolicy: "on_demand",
    codingPolicy: "none",
    tutoringPolicy: "none",
  },
  auto: {
    id: "auto",
    key: "auto",
    displayName: "⚡ Auto Adaptive",
    label: "⚡ Auto Adaptive",
    description:
      "Dynamically infers and executes the optimal behavioral profile for each request.",
    systemBehavior:
      "Act as an adaptive intelligent coordinator. Dynamically evaluate user intent to adopt the best behavioral stance (study, coder, deep_research, math, creative, general) per request.",
    instruction:
      "Act as an adaptive intelligent coordinator. Dynamically evaluate user intent to adopt the best behavioral stance (study, coder, deep_research, math, creative, general) per request.",
    preferredResponseStyle: "adaptive based on task",
    formattingProfile: "Adaptive depending on identified task.",
    capabilitiesList: [
      "tutoring",
      "code_generation",
      "web_research",
      "mathematical_reasoning",
      "memory",
    ],
    capabilities: {
      enableSearchDefault: false,
      thinkingLevelDefault: undefined,
      responseStyle: "adaptive based on task",
      formattingRules: "Adaptive formatting depending on task requirements.",
      toolPermissions: {
        searchAllowed: true,
        thinkingAllowed: true,
        imageGenAllowed: true,
        videoGenAllowed: true,
      },
    },
    preferredTools: ["search", "calculator", "image_generation", "video_generation"],
    toolRestrictions: [],
    reasoningProfile: "Dynamic task classification.",
    researchPolicy: "on_demand",
    codingPolicy: "general",
    tutoringPolicy: "direct",
  },
};

export const MODES: Record<string, ModeProfile> = new Proxy(BASE_MODES as any, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    const canonical = canonicalizeModeKey(prop);
    if (canonical && canonical in target) return target[canonical];
    return target.general;
  },
});

export function isModeKey(value: string | null | undefined): value is ModeKey {
  if (!value || typeof value !== "string") return false;
  return MODE_KEYS.includes(value as ModeKey);
}

/**
 * Maps legacy or alias mode strings to canonical ModeKey
 */
export function canonicalizeModeKey(input: string): ModeKey | null {
  if (!input || typeof input !== "string") return null;

  const sanitized = input
    .trim()
    .toLowerCase()
    .replace(/^[\/:\s]+/, "")
    .replace(/\s+_+\s+/g, "_")
    .replace(/\s+/g, "_");

  if (isModeKey(sanitized)) {
    return sanitized;
  }

  const aliases: Record<string, ModeKey> = {
    // Coding aliases -> coder
    coding: "coder",
    coder: "coder",
    code: "coder",
    developer: "coder",
    dev: "coder",
    programming: "coder",
    software: "coder",
    coding_assistant: "coder",
    developer_mode: "coder",

    // Research aliases -> deep_research
    research: "deep_research",
    deep_research: "deep_research",
    researcher: "deep_research",
    web_research: "deep_research",
    web_search: "deep_research",
    search: "deep_research",
    web_researcher: "deep_research",

    // Math & Reasoning aliases -> math
    math: "math",
    mathematics: "math",
    reasoning: "math",
    reasoning_mode: "math",
    deep_reasoning: "math",
    logic: "math",
    analytical: "math",
    thinking: "math",
    think: "math",

    // Creative & Writing aliases -> creative
    creative: "creative",
    writing: "creative",
    brainstorming: "creative",
    brainstorm: "creative",
    writer: "creative",
    editor: "creative",
    drafting: "creative",
    ideation: "creative",
    ideas: "creative",

    // Study aliases -> study
    study: "study",
    tutor: "study",
    teacher: "study",
    learning: "study",
    academic: "study",
    student: "study",
    study_tutor: "study",

    // General & Auto aliases
    general: "general",
    normal: "general",
    default: "general",
    standard: "general",
    casual: "general",
    reset: "general",

    travel: "general",
    travel_planner: "general",
    planner: "general",
    assistant: "general",

    auto: "auto",
    adaptive: "auto",
    automatic: "auto",
    auto_mode: "auto",
  };

  if (aliases[sanitized]) {
    return aliases[sanitized];
  }

  for (const modeKey of MODE_KEYS) {
    if (sanitized === `${modeKey}_mode` || sanitized === `mode_${modeKey}`) {
      return modeKey;
    }
  }

  return null;
}
