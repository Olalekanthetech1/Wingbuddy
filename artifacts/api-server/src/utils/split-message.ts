import { AdaptiveEngineService } from "../services/adaptive-engine.service";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function splitTelegramMessage(
  text: string,
  maxLength = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  return AdaptiveEngineService.computeAdaptiveMessageSplit(text, {
    maxLimit: maxLength,
  });
}
