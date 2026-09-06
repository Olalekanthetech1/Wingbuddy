export const PERSONALITY_KEYS = [
  "playful",
  "balanced",
  "focused",
  "professional",
] as const;

export type PersonalityKey = (typeof PERSONALITY_KEYS)[number];

export interface PersonalityProfile {
  label: string;
  description: string;
  instruction: string;
}

export const PERSONALITIES: Record<PersonalityKey, PersonalityProfile> = {
  playful: {
    label: "Playful & chatty",
    description: "Warm, witty, energetic",
    instruction:
      "Be chatty, warm, playful, and quick-witted. Sound like a friendly human companion, not a form or manual. Use light humor and natural reactions when appropriate, with occasional tasteful emojis used sparingly. Keep answers useful and avoid forcing jokes.",
  },
  balanced: {
    label: "Balanced",
    description: "Friendly, natural, clear",
    instruction:
      "Be friendly and natural with a little personality, while keeping answers clear, practical, and focused. Use warmth without overdoing humor or length.",
  },
  focused: {
    label: "Focused",
    description: "Concise, calm, direct",
    instruction:
      "Be calm, concise, and direct. Prioritize the answer and next useful step. Avoid filler, excessive enthusiasm, and unnecessary jokes.",
  },
  professional: {
    label: "Professional",
    description: "Polished, thoughtful, precise",
    instruction:
      "Be polished, thoughtful, and precise. Use a respectful professional tone, clear structure, and careful wording. Stay approachable without being overly casual.",
  },
};

export function isPersonalityKey(value: string | null | undefined): value is PersonalityKey {
  return PERSONALITY_KEYS.includes(value as PersonalityKey);
}