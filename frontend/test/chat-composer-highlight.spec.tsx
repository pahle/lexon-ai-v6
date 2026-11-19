import { expect, test } from 'vitest';
import { PlaceholderHighlightTextarea } from '../src/components/chat/placeholder-highlight-textarea';
import { render } from './render';

test('mirrors each [placeholder] as a muted 4px-radius highlight behind the real textarea', async () => {
  const view = await render(
    <PlaceholderHighlightTextarea
      aria-label="Message input"
      value="Explain Article [number] of [law or regulation] in plain language."
      onChange={() => {}}
    />,
  );
  const textarea = view.container.querySelector('textarea')!;
  expect(textarea.value).toContain('[number]');
  const marks = [
    ...view.container.querySelectorAll('[data-slot="placeholder-mark"]'),
  ];
  expect(marks.map((mark) => mark.textContent)).toEqual([
    '[number]',
    '[law or regulation]',
  ]);
  for (const mark of marks) {
    expect(mark.className).toContain('bg-muted');
    expect(mark.className).toContain('rounded-[4px]');
  }
  const mirror = marks[0]!.closest('[aria-hidden="true"]')!;
  expect(mirror).not.toBeNull();
  expect(mirror.contains(textarea)).toBe(false);
  expect(textarea.getAttribute('aria-hidden')).toBeNull();
  await view.unmount();
});

test('renders no highlight for text without a placeholder', async () => {
  const view = await render(
    <PlaceholderHighlightTextarea
      aria-label="Message input"
      value="Plain text [unclosed"
      onChange={() => {}}
    />,
  );
  expect(
    view.container.querySelector('[data-slot="placeholder-mark"]'),
  ).toBeNull();
  await view.unmount();
});
