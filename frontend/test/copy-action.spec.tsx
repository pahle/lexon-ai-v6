import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopyAction } from '../src/components/chat/copy-action.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { render } from './render.js';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function mount(first = false) {
  return render(
    <TooltipProvider>
      <CopyAction
        label="answer"
        getText={() => 'Hello'}
        className="x"
        first={first}
      />
    </TooltipProvider>,
  );
}
const button = (c: HTMLElement) => c.querySelector('button')!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

it('a failed copy shows the alert icon, the failed name, and the failed tooltip', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  const { container } = await mount();
  await click(button(container));
  const b = button(container);
  expect(b.getAttribute('aria-label')).toBe('Could not copy. Try again');
  expect(b.textContent).toContain('Could not copy');
  expect(b.querySelector('.lucide-circle-alert')).not.toBeNull();
});

it('the next click with a resolving clipboard shows Copied', async () => {
  writeText.mockRejectedValueOnce(new Error('denied'));
  const { container } = await mount();
  await click(button(container));
  expect(button(container).getAttribute('aria-label')).toBe(
    'Could not copy. Try again',
  );
  writeText.mockResolvedValue(undefined);
  await click(button(container));
  expect(writeText).toHaveBeenLastCalledWith('Hello');
  expect(button(container).getAttribute('aria-label')).toBe('Copied');
  expect(button(container).querySelector('.lucide-check')).not.toBeNull();
});

it('a successful copy shows Copied', async () => {
  writeText.mockResolvedValue(undefined);
  const { container } = await mount();
  expect(button(container).getAttribute('aria-label')).toBe('Copy answer');
  await click(button(container));
  expect(button(container).getAttribute('aria-label')).toBe('Copied');
});

it('a missing clipboard counts as a failed copy', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  });
  const { container } = await mount();
  await click(button(container));
  expect(button(container).getAttribute('aria-label')).toBe(
    'Could not copy. Try again',
  );
});

it('first action tooltip is left-aligned on mobile', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  const first = await mount(true);
  expect(button(first.container).getAttribute('data-align')).toBe('start');
  vi.stubGlobal('innerWidth', 1024);
  const desktop = await mount(true);
  expect(button(desktop.container).getAttribute('data-align')).toBe('center');
});
