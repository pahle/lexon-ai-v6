export async function navigateToSearchMatch(options: {
  chatId: string;
  messageId: string | null;
  resolve: (
    chatId: string,
    messageId: string,
  ) => Promise<{ messageId: string }>;
  remember: (chatId: string, messageId: string) => void;
  isCurrent: () => boolean;
  navigate: (chatId: string) => void;
}): Promise<void> {
  if (!options.isCurrent()) return;
  if (options.messageId) {
    let resolved: { messageId: string };
    try {
      resolved = await options.resolve(options.chatId, options.messageId);
    } catch {
      if (options.isCurrent()) options.navigate(options.chatId);
      return;
    }
    if (!options.isCurrent()) return;
    options.remember(options.chatId, resolved.messageId);
  }
  if (options.isCurrent()) options.navigate(options.chatId);
}
