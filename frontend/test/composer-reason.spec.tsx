import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatTree } from '@lexon/contracts';
import { ChatView } from '../src/components/chat/chat-view.js';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import {
  ComposerReason,
  sendLabel,
} from '../src/components/chat/composer-reason.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { render, settle } from './render.js';

const workspace = vi.hoisted(() => ({
  setChatTitle: vi.fn(),
  chatTitleRefreshVersion: 0,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: vi.fn(() => vi.fn()),
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => workspace,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const originalFetch = globalThis.fetch;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

const wrapped = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);

const chatId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const doneId = '33333333-3333-4333-8333-333333333333';
const runningId = '66666666-6666-4666-8666-666666666666';

function tree(active: boolean): ChatTree {
  return {
    id: chatId,
    title: 'Fixture',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Question',
        effort: 'high',
        createdAt: '2026-11-11T00:00:00.000Z',
      },
      {
        id: doneId,
        role: 'assistant',
        parentId: userId,
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Done answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:01.000Z',
      },
      {
        id: runningId,
        role: 'assistant',
        parentId: userId,
        runId: '77777777-7777-4777-8777-777777777777',
        text: active ? '' : 'Other',
        status: active ? 'running' : 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        createdAt: '2026-11-11T00:00:02.000Z',
      },
    ],
    viewedLeafId: doneId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:02.000Z',
  };
}

function stubStream() {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/events'))
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function mountRunning(active = true) {
  stubStream();
  const t = tree(active);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={t.id} tree={t}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  await settle();
  return view;
}

async function mountLoading() {
  stubStream();
  const client = { get: vi.fn(() => new Promise<never>(() => {})) };
  const view = await render(
    wrapped(
      <ChatView
        client={client as never}
        actorScope="tenant-1:user-1"
        chatId={chatId}
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />,
    ),
  );
  await settle();
  return view;
}

const input = (c: HTMLElement) =>
  c.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')!;

async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enter(el: HTMLTextAreaElement) {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
async function paste(el: HTMLTextAreaElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      items: [],
      getData: (type: string) => (type === 'text' ? text : ''),
    },
  });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event;
}
const status = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('p.text-xs[role="status"]');

it('ComposerReason renders the loading line, the blocked line, and the disclaimer', async () => {
  const view = await render(
    <>
      <ComposerReason reason="loading" />
      <ComposerReason reason="running-blocked" />
      <ComposerReason reason={null} />
    </>,
  );
  const lines = [...view.container.querySelectorAll('p')];
  expect(lines.map((l) => l.textContent)).toEqual([
    'Loading this chat…',
    'Wait for the answer to finish, or stop it.',
    'Lexon can make mistakes. Verify important legal information.',
  ]);
  expect(lines[0]!.getAttribute('role')).toBe('status');
  expect(lines[0]!.className).toContain('text-muted-foreground');
  expect(lines[1]!.className).toContain('text-foreground');
  await view.unmount();
});

it('loading: the reason line is a status and Send names the reason', async () => {
  const view = await mountLoading();
  try {
    const line = status(view.container)!;
    expect(line.textContent).toBe('Loading this chat…');
    expect(
      view.container.querySelector(
        '[aria-label="Send (unavailable: the chat is loading)"]',
      ),
    ).not.toBeNull();
    expect(input(view.container).disabled).toBe(true);
  } finally {
    await view.unmount();
  }
});

it('loading: Enter with text sends nothing', async () => {
  const view = await mountLoading();
  try {
    const fetch = vi.mocked(globalThis.fetch as typeof globalThis.fetch);
    await type(input(view.container), 'hello');
    await enter(input(view.container));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it('running: the disclaimer stays and Send names the reason', async () => {
  const view = await mountRunning();
  try {
    expect(status(view.container)!.textContent).toBe(
      'Lexon can make mistakes. Verify important legal information.',
    );
    // Revision 15 swaps Send for Stop while an answer runs, so the running
    // name is carried by the label helper Send uses whenever it renders.
    expect(sendLabel('running')).toBe(
      'Send (unavailable: an answer is still arriving)',
    );
    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Stop generating"]',
      )!.disabled,
    ).toBe(false);
  } finally {
    await view.unmount();
  }
});

it('running plus Enter with text shows the wait line in foreground and sends nothing', async () => {
  const view = await mountRunning();
  try {
    const fetch = vi.mocked(globalThis.fetch as typeof globalThis.fetch);
    const before = fetch.mock.calls.length;
    await type(input(view.container), 'Another question');
    await enter(input(view.container));
    const line = status(view.container)!;
    expect(line.textContent).toBe('Wait for the answer to finish, or stop it.');
    expect(line.className).toContain('text-foreground');
    expect(fetch.mock.calls.length).toBe(before);
    expect(input(view.container).value).toBe('Another question');
  } finally {
    await view.unmount();
  }
});

it('the wait line clears when the run ends', async () => {
  stubStream();
  const running = tree(true);
  const done = tree(false);
  const view = await render(
    wrapped(
      <ChatRuntime
        actorScope="tenant-1:user-1"
        chatId={chatId}
        tree={running}
        onTreeRefresh={async () => done}
      >
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    await type(input(view.container), 'Another question');
    await enter(input(view.container));
    expect(status(view.container)!.textContent).toContain('Wait for');
    // The 1 s reconcile (before any stream frame) finds the run finished.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(status(view.container)!.textContent).toContain('Lexon can make');
  } finally {
    vi.useRealTimers();
    await view.unmount();
  }
});

it('a whitespace-only paste is ignored and a multi-line paste is kept', async () => {
  const view = await mountRunning(false);
  try {
    const el = input(view.container);
    const blank = await paste(el, '  \n ');
    expect(blank.defaultPrevented).toBe(true);
    const lines = await paste(el, 'a\nb');
    expect(lines.defaultPrevented).toBe(false);
  } finally {
    await view.unmount();
  }
});

it('reload during a run: no run is known while history loads; Stop appears enabled the moment it has loaded and cancels the run', async () => {
  const fetch = stubStream();
  const resolvers: Array<(value: ChatTree) => void> = [];
  const client = {
    get: vi.fn(
      () =>
        new Promise<ChatTree>((resolve) => {
          resolvers.push(resolve);
        }),
    ),
  };
  const view = await render(
    wrapped(
      <ChatView
        client={client as never}
        actorScope="tenant-1:user-1"
        chatId={chatId}
        displayName="Ada"
        orgId="tenant-1"
        userId="user-1"
      />,
    ),
  );
  try {
    await settle();
    // Loading: the composer is the idle-loading look; the run is not known yet,
    // so there is nothing a Stop could cancel (revision 15 shows no Stop).
    expect(status(view.container)!.textContent).toBe('Loading this chat…');
    expect(
      view.container.querySelector('[aria-label="Stop generating"]'),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => resolvers.forEach((resolve) => resolve(tree(true))));
    await settle();
    const stop = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generating"]',
    )!;
    expect(stop.disabled).toBe(false);
    await act(async () => stop.click());
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      '/api/runs/77777777-7777-4777-8777-777777777777/cancel',
    );
  } finally {
    await view.unmount();
  }
});
