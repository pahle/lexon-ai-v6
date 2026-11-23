import { afterEach, expect, test, vi } from 'vitest';
import { Ban, Mail, Trash2 } from 'lucide-react';
import { RowMenu } from '../../src/components/data-views';
import { render, settle } from '../render';
import { click, key } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const onResend = vi.fn();
const items = [
  { label: 'Disable account', icon: Ban, onSelect: vi.fn(), destructive: true },
  { label: 'Resend', icon: Mail, onSelect: onResend },
  { label: 'Remove', icon: Trash2, onSelect: vi.fn(), destructive: true },
];

test('trigger is a 28px icon button with an accessible name', async () => {
  const view = await render(
    <RowMenu label="Actions for Ayu Wardani" items={items} />,
  );
  const button = view.container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Actions for Ayu Wardani');
  expect(button.className.split(/\s+/)).toContain('size-7');
  expect(RowMenuDefault(view.container)).toBe(true);
});

function RowMenuDefault(root: HTMLElement) {
  return root.querySelector('svg') !== null;
}

test('default accessible name is Row actions', async () => {
  const view = await render(<RowMenu items={items} />);
  expect(
    view.container.querySelector('button')!.getAttribute('aria-label'),
  ).toBe('Row actions');
});

test('opens from the keyboard and lists destructive items last, each with an icon', async () => {
  const view = await render(<RowMenu items={items} />);
  const button = view.container.querySelector('button')!;
  button.focus();
  await key(button, 'Enter');
  await click(button);
  await settle();
  const menu = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
  expect(menu.map((m) => m.textContent)).toEqual([
    'Resend',
    'Disable account',
    'Remove',
  ]);
  expect(menu.every((m) => m.querySelector('svg'))).toBe(true);
  expect(menu.at(-1)!.getAttribute('data-variant')).toBe('destructive');
});

test('selecting an item calls it', async () => {
  const view = await render(<RowMenu items={items} />);
  await click(view.container.querySelector('button')!);
  await settle();
  await click(document.body.querySelector('[role="menuitem"]')!);
  expect(onResend).toHaveBeenCalledOnce();
});
