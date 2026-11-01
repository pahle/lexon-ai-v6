import { afterEach, expect, test, vi } from 'vitest';
import { act, useRef, useState, type ReactNode } from 'react';
import { render, settle } from './render';
import { RightPanel } from '../src/components/shell/right-panel';

const panelHost = vi.hoisted(() => ({ element: null as HTMLElement | null }));
vi.mock('../src/components/shell/workspace-shell', () => ({
  usePanelHost: () => panelHost.element,
}));

function button(name: string): HTMLButtonElement {
  return [...document.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === name ||
      candidate.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
}

function Page({ page = 'first' }: { page?: string }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} onClick={() => setOpen(true)}>
        Open {page} details
      </button>
      <button>Outside control</button>
      <RightPanel
        open={open}
        onOpenChange={setOpen}
        title="Details"
        triggerRef={opener}
      >
        <button>Panel action</button>
      </RightPanel>
    </>
  );
}

function PageWithRemovedOpener() {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <main tabIndex={-1}>
      {showOpener ? (
        <button
          ref={opener}
          onClick={() => {
            setOpen(true);
            setShowOpener(false);
          }}
        >
          Open details
        </button>
      ) : null}
      <RightPanel
        open={open}
        onOpenChange={setOpen}
        title="Details"
        triggerRef={opener}
      >
        <button>Panel action</button>
      </RightPanel>
    </main>
  );
}

afterEach(() => {
  panelHost.element?.remove();
  vi.restoreAllMocks();
  window.innerWidth = 1024;
});

async function renderPageContent(node: ReactNode) {
  panelHost.element = document.createElement('div');
  panelHost.element.dataset.panelHost = '';
  document.body.append(panelHost.element);
  return render(node);
}

async function renderPage(page = 'first') {
  return renderPageContent(<Page page={page} />);
}

test('desktop panel is a controlled named aside at the design token width', async () => {
  window.innerWidth = 768;
  const view = await renderPage();

  expect(document.querySelector('aside[aria-label="Details"]')).toBeNull();
  await act(async () => button('Open first details').click());
  await settle();
  const panel = document.querySelector('aside[aria-label="Details"]');
  expect(panel).not.toBeNull();
  expect(panel?.getAttribute('style')).toContain('var(--right-panel-width)');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(document.querySelector('[data-resize-handle]')).toBeNull();

  await act(async () => button('Close panel').click());
  expect(document.querySelector('aside[aria-label="Details"]')).toBeNull();
  await view.unmount();
});

test('mobile panel is one named modal dialog and returns focus when closed', async () => {
  window.innerWidth = 767;
  const view = await renderPage();
  const opener = button('Open first details');
  await act(async () => opener.click());
  await settle();

  expect(
    document.querySelector('[role="dialog"][aria-labelledby]'),
  ).toBeTruthy();
  expect(document.querySelectorAll('aside[aria-label="Details"]')).toHaveLength(
    0,
  );
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')?.className).toContain(
    '!w-screen',
  );
  const close = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close panel"]',
  );
  close?.focus();
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
  });
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await view.unmount();
});

test('switching between desktop and mobile while open keeps one usable surface', async () => {
  window.innerWidth = 1024;
  const view = await renderPage();
  await act(async () => button('Open first details').click());
  await settle();
  expect(document.querySelectorAll('aside[aria-label="Details"]')).toHaveLength(
    1,
  );

  window.innerWidth = 767;
  await act(async () => window.dispatchEvent(new Event('resize')));
  await settle();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelectorAll('aside[aria-label="Details"]')).toHaveLength(
    0,
  );
  expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();

  window.innerWidth = 768;
  await act(async () => window.dispatchEvent(new Event('resize')));
  await settle();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  expect(document.querySelectorAll('aside[aria-label="Details"]')).toHaveLength(
    1,
  );
  await view.unmount();
});

test('mobile close uses the shell main landmark when its opener unmounts', async () => {
  window.innerWidth = 767;
  const view = await renderPageContent(<PageWithRemovedOpener />);
  await act(async () => button('Open details').click());
  await settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button('Close panel').click());
  await settle();
  expect(document.activeElement).toBe(
    document.querySelector('main[tabindex="-1"]'),
  );
  await view.unmount();
});

test('page unmount disposes panel state and a new page starts closed without persistence', async () => {
  const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem');
  const historyWrite = vi.spyOn(History.prototype, 'pushState');
  window.innerWidth = 1024;
  const view = await renderPage();
  await act(async () => button('Open first details').click());
  await settle();
  await view.unmount();
  expect(document.querySelector('aside[aria-label="Details"]')).toBeNull();

  const nextPage = await renderPage('second');
  expect(document.querySelector('aside[aria-label="Details"]')).toBeNull();
  expect(localStorageWrite).not.toHaveBeenCalled();
  expect(historyWrite).not.toHaveBeenCalled();
  await nextPage.unmount();
});
