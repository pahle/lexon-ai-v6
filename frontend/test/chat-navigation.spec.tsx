import { expect, it } from 'vitest';
import { shouldOpenNewChatShortcut } from '../src/lib/chat-navigation';

it('accepts Ctrl/Cmd+Alt+N outside text entry and preserves input and IME typing', () => {
  const key = new KeyboardEvent('keydown', {
    key: 'n',
    ctrlKey: true,
    altKey: true,
  });
  expect(shouldOpenNewChatShortcut(key)).toBe(true);
  expect(
    shouldOpenNewChatShortcut(
      new KeyboardEvent('keydown', { key: 'n', metaKey: true, altKey: true }),
    ),
  ).toBe(true);
  const input = document.createElement('input');
  const inInput = new KeyboardEvent('keydown', {
    key: 'n',
    ctrlKey: true,
    altKey: true,
  });
  Object.defineProperty(inInput, 'target', { value: input });
  expect(shouldOpenNewChatShortcut(inInput)).toBe(false);
  const composing = new KeyboardEvent('keydown', {
    key: 'n',
    ctrlKey: true,
    altKey: true,
    isComposing: true,
  });
  expect(shouldOpenNewChatShortcut(composing)).toBe(false);
  expect(
    shouldOpenNewChatShortcut(
      new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true }),
    ),
  ).toBe(false);
});
