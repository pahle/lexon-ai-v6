import { expect, test } from 'vitest';
import { Button } from '../src/components/ui/button';
import { render } from './render';

// LEX-DS-001 §2: red is the primary, so a destructive action cannot be told
// apart by color. Triggers are outline buttons with explicit text; only the
// confirm button inside a confirmation dialog is filled with Merah Segel Deep.

test('the destructive button is a solid Merah Segel Deep fill with white text', async () => {
  const view = await render(<Button variant="destructive">Delete chat</Button>);
  const button = view.container.querySelector('button')!;
  expect(button.classList.contains('bg-(--lexon-destructive-fill)')).toBe(true);
  expect(button.classList.contains('text-white')).toBe(true);
  // Not the translucent tint shadcn publishes, and not the error-text color.
  expect(button.className).not.toContain('bg-destructive');
  expect(button.className).not.toContain('text-destructive');
  await view.unmount();
});

test('an outline trigger carries no destructive color', async () => {
  const view = await render(<Button variant="outline">Remove</Button>);
  const button = view.container.querySelector('button')!;
  expect(button.classList.contains('border-input')).toBe(true);
  expect(button.classList.contains('bg-transparent')).toBe(true);
  expect(button.className).not.toContain('destructive-fill');
  expect(button.className).not.toContain('text-destructive');
  await view.unmount();
});
