import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { firstName, greetingFor } from '../src/lib/greeting';
import { ChatGreeting } from '../src/components/chat/chat-greeting';
import { render } from './render';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  [0, 'Good evening'],
  [4, 'Good evening'],
  [5, 'Good morning'],
  [11, 'Good morning'],
  [12, 'Good afternoon'],
  [17, 'Good afternoon'],
  [18, 'Good evening'],
])('greets hour %i with %s', (hour, expected) => {
  expect(greetingFor(hour)).toBe(expected);
});

it.each([
  ['Ayu Wardani', 'Ayu'],
  ['  Ayu  ', 'Ayu'],
  ['Ayu', 'Ayu'],
  ['', ''],
  ['李 明', '李'],
])('takes the first name of %j', (input, expected) => {
  expect(firstName(input)).toBe(expected);
});

it('renders a serif h2 with the local-time greeting and first name', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 9, 0, 0));
  const view = await render(<ChatGreeting displayName="Ayu Wardani" />);
  try {
    const heading = view.container.querySelector('h2');
    expect(heading?.className).toContain('font-serif');
    expect(heading?.textContent).toBe('Good morning, Ayu');
  } finally {
    await view.unmount();
  }
});

it('omits the comma when the name is empty', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 9, 0, 0));
  const view = await render(<ChatGreeting displayName="  " />);
  try {
    expect(view.container.querySelector('h2')?.textContent).toBe(
      'Good morning',
    );
  } finally {
    await view.unmount();
  }
});

it('server-renders the heading without time-dependent text and hydrates cleanly', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 20, 0, 0));
  const html = renderToString(<ChatGreeting displayName="Ayu Wardani" />);
  expect(html).toContain('<h2');
  expect(html).toContain('font-serif');
  expect(html).not.toMatch(/Good|Ayu/);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, <ChatGreeting displayName="Ayu Wardani" />);
  });
  try {
    expect(error).not.toHaveBeenCalled();
    expect(container.querySelector('h2')?.textContent).toBe(
      'Good evening, Ayu',
    );
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
