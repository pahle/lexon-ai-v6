export function shouldOpenNewChatShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return false;
  if (event.key.toLowerCase() !== 'n' || !event.altKey || event.shiftKey)
    return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  return (
    !target.isContentEditable &&
    !target.closest(
      'input, textarea, select, [role="textbox"], [contenteditable="true"]',
    )
  );
}
