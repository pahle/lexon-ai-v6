import { act } from 'react';
import { expect, test, vi } from 'vitest';
import { render, settle } from './render';
import { ThemeProvider } from '../src/components/theme-provider';
import { AppearanceSettings } from '../src/components/settings/appearance-settings';

function installMatchMedia(initialDark = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: (listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return {
    setDark(matches: boolean) {
      Object.defineProperty(media, 'matches', { configurable: true, value: matches });
      const event = { matches, media: media.media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

test('appearance selection stores and applies light and dark themes locally', async () => {
  localStorage.clear();
  document.documentElement.className = '';
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  installMatchMedia();
  const view = await render(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );
  await settle();

  expect(view.container.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(view.container.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe('System');

  await act(async () => {
    (view.container.querySelector('[aria-label="Dark"]') as HTMLElement).click();
  });
  await settle();
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);

  await act(async () => {
    (view.container.querySelector('[aria-label="Light"]') as HTMLElement).click();
  });
  await settle();
  expect(localStorage.getItem('theme')).toBe('light');
  expect(document.documentElement.classList.contains('light')).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();
  await view.unmount();
  fetchSpy.mockRestore();
});

test('system selection follows operating system changes and uses rectangular previews', async () => {
  localStorage.clear();
  document.documentElement.className = '';
  const os = installMatchMedia(false);
  const view = await render(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );
  await settle();

  expect(view.container.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe('System');
  await act(async () => {
    os.setDark(true);
  });
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await act(async () => {
    os.setDark(false);
  });
  expect(document.documentElement.classList.contains('light')).toBe(true);

  const indicator = view.container.querySelector('[data-slot="radio-indicator"]');
  const preview = view.container.querySelector('[data-slot="appearance-preview"]');
  expect(indicator?.className).toContain('rounded-full');
  expect(preview?.className).not.toContain('rounded-full');
  expect(preview?.className).toContain('rounded-[var(--radius)]');
  await view.unmount();
});
