import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { render, settle } from './render';
import { ThemeProvider } from '../src/components/theme-provider';
import { AppearanceSettings } from '../src/components/settings/appearance-settings';

const mountedViews: Array<{ unmount: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(mountedViews.splice(0).map((view) => view.unmount()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = '';
});

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
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return {
    setDark(matches: boolean) {
      Object.defineProperty(media, 'matches', {
        configurable: true,
        value: matches,
      });
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
  mountedViews.push(view);
  await settle();

  expect(view.container.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(
    view.container
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.getAttribute('aria-label'),
  ).toBe('System');
  const group = view.container.querySelector('[data-slot="radio-group"]');
  expect(group?.className).toContain('max-w-[35.75rem]');
  expect(group?.className).toContain('grid-cols-1');
  expect(group?.className).toContain('min-[768px]:grid-cols-3');
  const previews = [
    ...view.container.querySelectorAll('[data-slot="appearance-preview"]'),
  ];
  expect(
    previews.map((preview) => preview.getAttribute('data-theme-preview')),
  ).toEqual(['light', 'dark', 'system']);
  expect(
    previews.map((preview) => preview.getAttribute('data-selected')),
  ).toEqual(['false', 'false', 'true']);
  const options = [
    ...view.container.querySelectorAll('[data-slot="appearance-option"]'),
  ];
  expect(options).toHaveLength(3);
  expect(
    new Set(
      previews.map((preview) => preview.getAttribute('data-theme-preview')),
    ).size,
  ).toBe(3);
  for (const preview of previews) {
    expect(preview.className).toContain('h-24');
    expect(preview.className).toContain('border');
    expect(preview.parentElement?.className).not.toContain(
      'rounded-[var(--radius)] border',
    );
    expect(preview.parentElement?.className).not.toContain(
      'bg-[var(--surface-raised)]',
    );
    const radio = preview.parentElement?.querySelector('[role="radio"]');
    expect(radio).not.toBeNull();
    expect(
      preview.compareDocumentPosition(radio!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }

  await act(async () => {
    (
      view.container.querySelector('[aria-label="Dark"]') as HTMLElement
    ).click();
  });
  await settle();
  expect(localStorage.getItem('theme')).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(
    previews.map((preview) => preview.getAttribute('data-selected')),
  ).toEqual(['false', 'true', 'false']);

  await act(async () => {
    (
      view.container.querySelector('[aria-label="Light"]') as HTMLElement
    ).click();
  });
  await settle();
  expect(localStorage.getItem('theme')).toBe('light');
  expect(document.documentElement.classList.contains('light')).toBe(true);
  expect(
    previews.map((preview) => preview.getAttribute('data-selected')),
  ).toEqual(['true', 'false', 'false']);
  expect(fetchSpy).not.toHaveBeenCalled();
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
  mountedViews.push(view);
  await settle();

  expect(
    view.container
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.getAttribute('aria-label'),
  ).toBe('System');
  await act(async () => {
    os.setDark(true);
  });
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await act(async () => {
    os.setDark(false);
  });
  expect(document.documentElement.classList.contains('light')).toBe(true);

  const indicator = view.container.querySelector(
    '[data-slot="radio-indicator"]',
  );
  const preview = view.container.querySelector(
    '[data-slot="appearance-preview"]',
  );
  expect(indicator?.className).toContain('rounded-full');
  expect(preview?.className).not.toContain('rounded-full');
  expect(preview?.className).toContain('h-24');
});

test('does not render a theme selection before the client mount', () => {
  installMatchMedia();
  const markup = renderToString(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );

  expect(markup).not.toContain('role="radio"');
});
