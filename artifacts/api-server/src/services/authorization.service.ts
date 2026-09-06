export function isAuthorizedTelegramUser(
  telegramUserId: number,
  allowedUserIds: ReadonlySet<number>,
): boolean {
  return allowedUserIds.size === 0 || allowedUserIds.has(telegramUserId);
}