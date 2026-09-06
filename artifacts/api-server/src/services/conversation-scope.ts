export function conversationScopeKey(telegramUserId: number, chatId: number): string {
  return `${telegramUserId}:${chatId}`;
}