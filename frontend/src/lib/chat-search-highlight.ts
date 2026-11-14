let pending: { chatId: string; messageId: string; expiresAt: number } | null =
  null;

export function rememberChatSearchHighlight(chatId: string, messageId: string) {
  pending = { chatId, messageId, expiresAt: Date.now() + 10_000 };
}

export function consumeChatSearchHighlight(chatId: string): string | null {
  const value = pending;
  pending = null;
  if (!value || value.chatId !== chatId || value.expiresAt < Date.now())
    return null;
  return value.messageId;
}
