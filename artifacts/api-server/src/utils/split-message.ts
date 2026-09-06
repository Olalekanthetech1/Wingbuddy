export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function findSafeBreak(text: string, maxLength: number): number {
  const candidate = text.slice(0, maxLength);
  const codeFence = candidate.lastIndexOf("```");
  const newline = candidate.lastIndexOf("\n");
  const space = candidate.lastIndexOf(" ");
  const preferred = Math.max(newline, space);

  if (codeFence > 0 && codeFence > preferred - 32) {
    return codeFence;
  }
  return preferred > Math.floor(maxLength * 0.55) ? preferred : maxLength;
}

export function splitTelegramMessage(
  text: string,
  maxLength = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const breakAt = findSafeBreak(remaining, maxLength);
    const chunk = remaining.slice(0, breakAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}