import { act, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatTree } from '@lexon/contracts';
import { ChatView } from '../src/components/chat/chat-view.js';
import { ChatRuntime } from '../src/components/chat/chat-runtime.js';
import { Thread } from '../src/components/assistant-ui/elements/thread.aui.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { TooltipIconButton } from '../src/components/assistant-ui/elements/tooltip-icon-button.js';
import { rememberChatSearchHighlight } from '../src/lib/chat-search-highlight.js';
import { render, settle } from './render.js';

// Test doubles in this file still resolve bare trees; wrap the client so
// `get` answers the ChatGetResult envelope the real client returns (spec §5
// item 15). Call arguments pass straight through to the underlying mock.
// The wrapper is memoized per client object: ChatView effects key on the
// client identity, so a fresh wrapper each render would refire the loads.
const chatGetEnvelopeCache = new WeakMap<object, unknown>();
const chatGetEnvelope = <T extends object>(client: T): T => {
  const get = (client as { get?: unknown }).get;
  if (typeof get !== 'function') return client;
  const cached = chatGetEnvelopeCache.get(client);
  if (cached) return cached as T;
  const wrapped = {
    ...client,
    get: async (...args: unknown[]) => ({
      notModified: false as const,
      tree: await (get as (...a: unknown[]) => unknown)(...args),
      etag: null,
    }),
  } as T;
  chatGetEnvelopeCache.set(client, wrapped);
  return wrapped;
};

const invalidationSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));
const toastSpy = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const setChatTitleSpy = vi.hoisted(() => vi.fn());
const workspaceState = vi.hoisted(() => ({ chatTitleRefreshVersion: 0 }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: invalidationSubscribe,
}));
vi.mock('../src/components/shell/workspace-provider.js', () => ({
  useWorkspace: () => ({
    setChatTitle: setChatTitleSpy,
    chatTitleRefreshVersion: workspaceState.chatTitleRefreshVersion,
  }),
}));
vi.mock('sonner', () => ({ toast: toastSpy }));
beforeEach(() => {
  workspaceState.chatTitleRefreshVersion = 0;
  setChatTitleSpy.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function wrapped(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

function makeBranchTree(active: boolean): ChatTree {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const selectedAnswerId = '33333333-3333-4333-8333-333333333333';
  const activeAnswerId = '66666666-6666-4666-8666-666666666666';
  return {
    id: chatId,
    title: 'Branch fixture',
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
        id: selectedAnswerId,
        role: 'assistant',
        parentId: userId,
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Selected branch answer',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-11T00:00:01.000Z',
      },
      {
        id: activeAnswerId,
        role: 'assistant',
        parentId: userId,
        runId: '77777777-7777-4777-8777-777777777777',
        text: active ? '' : 'Other branch answer',
        status: active ? 'running' : 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-11T00:00:02.000Z',
      },
    ],
    viewedLeafId: selectedAnswerId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:02.000Z',
  };
}

it('mounts exactly one empty run announcer for a thread loaded with only completed answers', async () => {
  const tree = makeBranchTree(false);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const announcers = view.container.querySelectorAll(
      '[data-slot="run-announcer"][role="status"]',
    );
    expect(announcers).toHaveLength(1);
    expect(announcers[0]?.textContent).toBe('');
    expect(view.container.textContent).not.toContain('Answer complete');
    const marks = view.container.querySelectorAll(
      '[data-message-id="33333333-3333-4333-8333-333333333333"] [data-slot="reasoning-mark"] svg[fill="currentColor"]',
    );
    expect(marks).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});

it('exposes Stop for an off-branch active answer without replacing the viewed branch', async () => {
  const tree = makeBranchTree(true);
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/cancel')) return new Response(null, { status: 204 });
    if (url.endsWith('/events'))
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );

  try {
    await settle();
    expect(
      view.container.querySelector(
        '[data-message-id="33333333-3333-4333-8333-333333333333"]',
      ),
    ).not.toBeNull();
    expect(
      view.container.querySelector(
        '[data-message-id="66666666-6666-4666-8666-666666666666"]',
      ),
    ).toBeNull();
    expect(view.container.textContent).toContain('Selected branch answer');
    expect(view.container.textContent).not.toContain('Other branch answer');

    const stop = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop generating"]',
    );
    expect(stop).not.toBeNull();
    await act(async () => stop?.click());
    expect(fetch.mock.calls.map(([input]) => String(input))).toContain(
      '/api/runs/77777777-7777-4777-8777-777777777777/cancel',
    );
    expect(view.container.textContent).toContain('Selected branch answer');
    expect(view.container.textContent).not.toContain('Other branch answer');
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('locks send, an already-open edit, and regeneration when an off-branch run appears', async () => {
  const initialTree = makeBranchTree(false);
  let updateTree!: (tree: ChatTree) => void;
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/events'))
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: {
          'content-type': 'text/event-stream',
          'x-lexon-stream-recovery-result': 'snapshot',
        },
      });
    if (url.endsWith('/cancel')) return new Response(null, { status: 204 });
    if (url.includes('/messages')) return new Response(null, { status: 409 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);

  function Harness() {
    const [tree, setTree] = useState(initialTree);
    updateTree = setTree;
    return (
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>
    );
  }

  const view = await render(wrapped(<Harness />));
  try {
    await settle();
    const edit = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit message"]',
    );
    expect(edit).not.toBeNull();
    await act(async () => edit?.click());
    await settle();
    expect(
      view.container.querySelector('[aria-label="Edit message input"]'),
    ).not.toBeNull();

    const messageInput = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    const editInput = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Edit message input"]',
    );
    if (!messageInput || !editInput)
      throw new Error('The public thread composers did not render.');
    const setTextarea = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setTextarea.call(messageInput, 'Another question');
      messageInput.dispatchEvent(new Event('input', { bubbles: true }));
      setTextarea.call(editInput, 'Edited question');
      editInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => updateTree(makeBranchTree(true)));
    await settle();
    expect
      .soft(view.container.querySelector('[aria-label="Stop generating"]'))
      .not.toBeNull();
    expect(
      view.container.querySelector(
        '[data-message-id="33333333-3333-4333-8333-333333333333"]',
      ),
    ).not.toBeNull();
    expect(
      view.container.querySelector(
        '[data-message-id="66666666-6666-4666-8666-666666666666"]',
      ),
    ).toBeNull();

    const send = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send message"]',
    );
    const sendEdit = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Save"]',
    );
    const regenerate = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Regenerate answer"]',
    );
    expect.soft(send === null || send.disabled).toBe(true);
    expect.soft(sendEdit === null || sendEdit.disabled).toBe(true);
    expect.soft(regenerate === null || regenerate.disabled).toBe(true);
    await act(async () => {
      if (send && !send.disabled) send.click();
      if (sendEdit && !sendEdit.disabled) sendEdit.click();
      if (regenerate && !regenerate.disabled) regenerate.click();
    });
    expect
      .soft(
        fetch.mock.calls.filter(([input]) =>
          String(input).includes('/messages'),
        ),
      )
      .toEqual([]);
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

async function expectTooltipOpen(expected: string) {
  await vi.waitFor(() => {
    expect(
      document.body.querySelector('[data-slot="tooltip-content"][data-open]')
        ?.textContent,
    ).toBe(expected);
  });
}

async function hoverAndFocus(button: HTMLButtonElement, expected: string) {
  await act(async () => {
    button.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
      }),
    );
    button.dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    );
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mouseenter'));
  });
  await expectTooltipOpen(expected);
  await act(async () => {
    button.dispatchEvent(
      new PointerEvent('pointerout', {
        bubbles: true,
        pointerType: 'mouse',
      }),
    );
    button.dispatchEvent(
      new PointerEvent('pointerleave', { pointerType: 'mouse' }),
    );
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('mouseleave'));
  });
  await vi.waitFor(() => {
    expect(
      document.body.querySelector('[data-slot="tooltip-content"][data-open]'),
    ).toBeNull();
  });
  await act(async () => {
    button.focus();
  });
  await expectTooltipOpen(expected);
}

it('opens the existing tooltip on native mouse hover and keyboard focus', async () => {
  const view = await render(
    <TooltipIconButton tooltip="Existing tooltip" type="button">
      Help
    </TooltipIconButton>,
  );
  try {
    const button = view.container.querySelector('button');
    expect(button).not.toBeNull();
    if (button) await hoverAndFocus(button, 'Existing tooltip');
  } finally {
    await view.unmount();
  }
});

it('explains Deep thinking on hover and focus in the new-chat composer', async () => {
  const view = await render(
    <TooltipProvider>
      {wrapped(
        <ChatView
          client={{ create: vi.fn() } as never}
          actorScope="org:user"
          displayName="Ada"
          orgId="org-id"
          userId="user-id"
        />,
      )}
    </TooltipProvider>,
  );
  try {
    const button = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    );
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Deep thinking');
    if (button)
      await hoverAndFocus(button, 'Takes longer and uses more of your budget');
  } finally {
    await view.unmount();
  }
});

it('explains Deep thinking on hover and focus in the thread composer', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Thread fixture',
      messages: [
        {
          id: userMessageId,
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: userMessageId,
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'The clause limits liability.',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:01.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:01.000Z',
    }),
  };
  const view = await render(
    <TooltipProvider>
      {wrapped(
        <ChatView
          chatId={chatId}
          client={chatGetEnvelope(client) as never}
          actorScope="org:user"
          displayName="Ada"
          orgId="org-id"
          userId="user-id"
        />,
      )}
    </TooltipProvider>,
  );
  try {
    await settle();
    const button = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    );
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Deep thinking');
    if (button)
      await hoverAndFocus(button, 'Takes longer and uses more of your budget');
  } finally {
    await view.unmount();
  }
});

it('creates a server chat only after an accepted text send and navigates to its stable URL', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const client = {
    create: vi.fn().mockResolvedValue({
      chatId,
      userMessageId: '22222222-2222-4222-8222-222222222222',
      assistantMessageId: '33333333-3333-4333-8333-333333333333',
      runId: '44444444-4444-4444-8444-444444444444',
    }),
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'New chat',
      messages: [],
      viewedLeafId: null,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    }),
    send: vi.fn(),
    edit: vi.fn(),
    regenerate: vi.fn(),
    setViewedLeaf: vi.fn(),
    setFeedback: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    resolveSearchMatch: vi.fn(),
  };
  const push = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 16, 9, 0, 0));
  const view = await render(
    wrapped(
      <ChatView
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
        onNavigate={push}
      />,
    ),
  );
  try {
    await settle();
    const input = view.container.querySelector('textarea');
    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.className).toContain('resize-none');
    expect(input.className).toContain('field-sizing-content');
    // Auto-grow: 56px up to 200px (mobile 144px), then it scrolls inside.
    for (const token of [
      'min-h-14',
      'max-h-[200px]',
      'max-md:max-h-36',
      'overflow-y-auto',
    ])
      expect(input.className).toContain(token);
    expect(input.className).not.toContain('max-h-48');
    expect(view.container.querySelector('h2')?.className).toContain(
      'font-serif',
    );
    expect(view.container.querySelector('h2')?.textContent).toBe(
      'Good morning, Ada',
    );
    expect(view.container.textContent).not.toContain(
      'Your legal workspace, ready when you are.',
    );
    const send = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send message"]',
    );
    expect(send?.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(send?.disabled).toBe(true);
    expect(client.create).not.toHaveBeenCalled();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Review this clause');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      view.container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    await settle();
    expect(client.create).toHaveBeenCalledOnce();
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Review this clause', effort: 'high' }),
    );
    expect(push).toHaveBeenCalledWith(`/chats/${chatId}`);
    expect(
      view.container
        .querySelector('[aria-label="Deep thinking"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  } finally {
    vi.useRealTimers();
    await view.unmount();
  }
});

it('refreshes the mounted thread title after the workspace title event', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const tree = (title: string) => ({
    id: chatId,
    title,
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  });
  const get = vi
    .fn()
    .mockResolvedValueOnce(tree('Initial title'))
    .mockResolvedValueOnce(tree('Updated title'));
  const client = { get };
  const thread = () =>
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    );
  const view = await render(thread());
  await settle();
  expect(setChatTitleSpy).toHaveBeenLastCalledWith(
    chatId,
    'org:user',
    'Initial title',
  );
  workspaceState.chatTitleRefreshVersion = 1;
  await view.rerender(thread());
  await settle();
  expect(get).toHaveBeenCalledTimes(2);
  expect(setChatTitleSpy).toHaveBeenLastCalledWith(
    chatId,
    'org:user',
    'Updated title',
  );
  await view.unmount();
});

it('does not let a delayed initial tree overwrite a newer title refresh', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const tree = (title: string) => ({
    id: chatId,
    title,
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  });
  let resolveInitial!: (value: ReturnType<typeof tree>) => void;
  let resolveRefresh!: (value: ReturnType<typeof tree>) => void;
  const get = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof tree>>((resolve) => {
          resolveInitial = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof tree>>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
  const client = { get };
  const thread = () =>
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    );
  const view = await render(thread());
  await settle();
  expect(get).toHaveBeenCalledTimes(1);
  workspaceState.chatTitleRefreshVersion = 1;
  await view.rerender(thread());
  await settle();
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => resolveRefresh(tree('Updated title')));
  await settle();
  expect(setChatTitleSpy).toHaveBeenLastCalledWith(
    chatId,
    'org:user',
    'Updated title',
  );
  await act(async () => resolveInitial(tree('Initial title')));
  await settle();
  expect(setChatTitleSpy).toHaveBeenLastCalledWith(
    chatId,
    'org:user',
    'Updated title',
  );
  await view.unmount();
});

it('keeps Deep thinking selected when the server rejects the initial send', async () => {
  const client = { create: vi.fn().mockRejectedValue(new Error('rejected')) };
  const view = await render(
    wrapped(
      <ChatView
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
        onNavigate={vi.fn()}
      />,
    ),
  );
  try {
    const input = view.container.querySelector('textarea');
    expect(input).not.toBeNull();
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    let thinking: HTMLButtonElement;
    await act(async () => {
      setter.call(input, 'Review this clause');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      thinking = view.container.querySelector(
        '[aria-label="Deep thinking"]',
      ) as HTMLButtonElement;
      thinking.click();
    });
    expect(thinking!.getAttribute('aria-pressed')).toBe('true');
    await act(async () =>
      view.container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    await settle();
    expect(thinking!.getAttribute('aria-pressed')).toBe('true');
  } finally {
    await view.unmount();
  }
});

it('exposes the exact UTF-8 prompt byte limit for client-side rejection', async () => {
  const { promptByteLength, MAX_PROMPT_BYTES } =
    await import('../src/components/chat/chat-view.js');
  expect(MAX_PROMPT_BYTES).toBe(16_384);
  expect(promptByteLength('🧾'.repeat(4_096))).toBe(16_384);
  expect(promptByteLength('🧾'.repeat(4_097))).toBe(16_388);
});

it('blocks over-limit UTF-8 prompts while allowing the exact byte boundary', async () => {
  const client = { create: vi.fn() };
  const view = await render(
    wrapped(
      <ChatView
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="tenant-α"
        userId="user-β"
        onNavigate={vi.fn()}
      />,
    ),
  );
  try {
    const input = view.container.querySelector('textarea')!;
    const deepThinking = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    )!;
    expect(deepThinking.className).toContain('whitespace-nowrap');
    expect(deepThinking.className).toContain('shrink-0');
    expect(view.container.textContent).not.toContain('bytes left');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, '🧾'.repeat(3_968));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('512 bytes left');
    await act(async () => {
      setter.call(input, '🧾'.repeat(4_097));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.textContent).not.toContain('bytes left');
    expect(
      view.container.querySelector('[role="alert"]')?.textContent,
    ).toContain('16,384 bytes');
    expect(
      view.container
        .querySelector('button[type="submit"]')
        ?.hasAttribute('disabled'),
    ).toBe(true);
    await act(async () => {
      setter.call(input, '🧾'.repeat(4_096));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain('0 bytes left');
    expect(
      view.container
        .querySelector('button[type="submit"]')
        ?.hasAttribute('disabled'),
    ).toBe(false);
    expect(client.create).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it('does not create a duplicate per-thread title invalidation subscription', async () => {
  const cleanup = vi.fn();
  invalidationSubscribe.mockReturnValue(cleanup);
  const view = await render(
    wrapped(
      <ChatView
        client={{} as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="tenant-α"
        userId="user-β"
      />,
    ),
  );
  try {
    await settle();
    expect(invalidationSubscribe).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    expect(cleanup).not.toHaveBeenCalled();
  }
});

it('renders the edit submit as Save after Cancel with accessible name Save', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Thread fixture',
      messages: [
        {
          id: userMessageId,
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: userMessageId,
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'The clause limits liability.',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:01.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:01.000Z',
    }),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const editMessage = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit message"]',
    );
    expect(editMessage).not.toBeNull();
    if (!editMessage) return;
    await act(async () => editMessage.click());
    await settle();

    const cancel = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel edit"]',
    );
    const sendEdit = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Save"]',
    );
    expect(cancel).not.toBeNull();
    expect(sendEdit).not.toBeNull();
    if (!cancel || !sendEdit) return;
    expect(cancel.textContent).toContain('Cancel');
    expect(sendEdit.tagName).toBe('BUTTON');
    expect(sendEdit.getAttribute('aria-label')).toBe('Save');
    expect(sendEdit.textContent?.trim()).toBe('Save');
    expect(sendEdit.hidden).toBe(false);
    expect(
      cancel.compareDocumentPosition(sendEdit) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('keeps the answer under an open edit readable and operable, dimmed by color only', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Thread fixture',
      messages: [
        {
          id: userMessageId,
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: userMessageId,
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'The clause limits liability.',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:01.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:01.000Z',
    }),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const answer = () =>
      view.container.querySelector<HTMLElement>(
        `[data-message-id="${answerId}"]`,
      );
    expect(answer()?.hasAttribute('inert')).toBe(false);
    expect(answer()?.className).toContain('text-foreground');
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Edit message"]')
        ?.click(),
    );
    await settle();
    // Presentation only: the answer stays in the accessibility tree and the
    // tab order while the edit is open, and reads as dimmed through color.
    const dimmed = answer()!;
    expect(dimmed.closest('[inert]')).toBeNull();
    expect(dimmed.hasAttribute('inert')).toBe(false);
    expect(dimmed.textContent).toContain('The clause limits liability.');
    expect(dimmed.className).not.toContain('opacity-50');
    expect(dimmed.className).toContain('text-muted-foreground');
    expect(dimmed.className).not.toMatch(/(^|\s)text-foreground(\s|$)/);
    const copy = dimmed.querySelector<HTMLButtonElement>(
      '[aria-label="Copy answer"]',
    )!;
    expect(copy).not.toBeNull();
    copy.focus();
    expect(document.activeElement).toBe(copy);
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel edit"]')
        ?.click(),
    );
    await settle();
    expect(answer()?.hasAttribute('inert')).toBe(false);
    expect(answer()?.className).toContain('text-foreground');
  } finally {
    await view.unmount();
  }
});

it('renders a persisted answer through the proven runtime and saves feedback against its message ID', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const get = vi.fn().mockResolvedValue({
    id: chatId,
    title: 'Thread fixture',
    messages: [
      {
        id: userMessageId,
        role: 'user',
        parentId: null,
        text: 'Review this clause',
        effort: 'high',
        createdAt: '2026-11-12T00:00:00.000Z',
      },
      {
        id: answerId,
        role: 'assistant',
        parentId: userMessageId,
        runId: '44444444-4444-4444-8444-444444444444',
        text: '**The clause limits liability.**',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: 'good',
        operations: [],
        createdAt: '2026-11-12T00:00:01.000Z',
      },
    ],
    viewedLeafId: answerId,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:01.000Z',
  });
  const setFeedback = vi.fn().mockResolvedValue(undefined);
  const client = { get, setFeedback };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    expect(get).toHaveBeenCalledWith(chatId);
    expect(view.container.textContent).toContain(
      'The clause limits liability.',
    );
    expect(
      view.container
        .querySelector('[aria-label="Good answer"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    const followup = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    const deepThinking = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    );
    expect(followup).not.toBeNull();
    expect(deepThinking).not.toBeNull();
    if (!followup || !deepThinking) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      deepThinking.click();
      setter.call(followup, 'x'.repeat(16_385));
      followup.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(deepThinking.getAttribute('aria-pressed')).toBe('true');
    expect(
      view.container.querySelector('.aui-composer-root [role="alert"]')
        ?.textContent,
    ).toContain('16,384 bytes');
    expect(
      view.container
        .querySelector('.aui-composer-root [aria-label="Send message"]')
        ?.hasAttribute('disabled'),
    ).toBe(true);
    await act(async () => {
      setter.call(followup, '');
      followup.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      view.container.querySelector('.aui-composer-root [role="alert"]'),
    ).toBeNull();
    expect(deepThinking.getAttribute('aria-pressed')).toBe('true');
    await act(async () =>
      view.container
        .querySelector('[aria-label="Edit message"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(
      view.container.querySelector('[aria-label="Edit message input"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Save"]')).not.toBeNull();
    expect(
      view.container.querySelector('[aria-label="Send message"]'),
    ).not.toBeNull();
    await act(async () =>
      view.container
        .querySelector('[aria-label="Good answer"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await settle();
    expect(setFeedback).toHaveBeenCalledWith(chatId, answerId, {
      rating: 'good',
    });
  } finally {
    await view.unmount();
  }
});

it.each([
  { reducedMotion: false, scrollBehavior: 'smooth' as const },
  { reducedMotion: true, scrollBehavior: 'auto' as const },
])(
  'scrolls the loaded matched message and removes its highlight after two seconds (reduced motion: $reducedMotion)',
  async ({ reducedMotion, scrollBehavior }) => {
    const chatId = '11111111-1111-4111-8111-111111111111';
    const userMessageId = '22222222-2222-4222-8222-222222222222';
    const matchedMessageId = '33333333-3333-4333-8333-333333333333';
    let resolveTree!: (tree: {
      id: string;
      title: string;
      messages: Array<Record<string, unknown>>;
      viewedLeafId: string;
      createdAt: string;
      updatedAt: string;
    }) => void;
    const response = new Promise<{
      id: string;
      title: string;
      messages: Array<Record<string, unknown>>;
      viewedLeafId: string;
      createdAt: string;
      updatedAt: string;
    }>((resolve) => {
      resolveTree = resolve;
    });
    const client = { get: vi.fn(() => response) };
    const scrolledElements: HTMLElement[] = [];
    const scrollCalls: Array<{
      behavior?: ScrollBehavior;
      block?: ScrollLogicalPosition;
    }> = [];
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function (
        this: HTMLElement,
        options?: {
          behavior?: ScrollBehavior;
          block?: ScrollLogicalPosition;
        },
      ) {
        scrolledElements.push(this);
        if (options) scrollCalls.push(options);
      },
    });
    rememberChatSearchHighlight(chatId, matchedMessageId);
    const view = await render(
      wrapped(
        <ChatView
          chatId={chatId}
          client={chatGetEnvelope(client) as never}
          actorScope="org:user"
          displayName="Ada"
          orgId="org-id"
          userId="user-id"
        />,
      ),
    );
    try {
      await settle();
      vi.stubGlobal(
        'matchMedia',
        vi.fn((media: string): MediaQueryList => ({
          matches:
            media === '(prefers-reduced-motion: reduce)' && reducedMotion,
          media,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => true,
        })),
      );
      vi.useFakeTimers();
      await act(async () => {
        resolveTree({
          id: chatId,
          title: 'Search result fixture',
          messages: [
            {
              id: userMessageId,
              role: 'user',
              parentId: null,
              text: 'Find the approved clause',
              effort: 'high',
              createdAt: '2026-11-12T00:00:00.000Z',
            },
            {
              id: matchedMessageId,
              role: 'assistant',
              parentId: userMessageId,
              runId: '44444444-4444-4444-8444-444444444444',
              text: 'The matched historical answer.',
              status: 'completed',
              reasoningSummary: null,
              reasoningDurationMs: null,
              feedback: null,
              operations: [],
              createdAt: '2026-11-12T00:00:01.000Z',
            },
          ],
          viewedLeafId: matchedMessageId,
          createdAt: '2026-11-12T00:00:00.000Z',
          updatedAt: '2026-11-12T00:00:01.000Z',
        });
        await response;
      });
      const target = view.container.querySelector<HTMLElement>(
        `[data-message-id="${matchedMessageId}"]`,
      );
      expect(target).not.toBeNull();
      expect(target?.textContent).toContain('The matched historical answer.');
      expect(target?.dataset.searchHighlight).toBeUndefined();

      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(scrolledElements).toEqual([target]);
      expect(scrollCalls).toEqual([
        { behavior: scrollBehavior, block: 'center' },
      ]);
      expect(target?.dataset.searchHighlight).toBe('true');
      expect(target?.classList.contains('outline')).toBe(true);

      await act(async () => vi.advanceTimersByTimeAsync(1_999));
      expect(target?.dataset.searchHighlight).toBe('true');
      expect(target?.classList.contains('outline')).toBe(true);

      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(target?.dataset.searchHighlight).toBeUndefined();
      expect(target?.classList.contains('outline')).toBe(false);
      expect(target?.classList.contains('outline-2')).toBe(false);
      expect(target?.classList.contains('outline-ring')).toBe(false);
      expect(target?.classList.contains('rounded-lg')).toBe(false);
    } finally {
      await view.unmount();
      vi.useRealTimers();
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  },
);

it('renders persisted measured reasoning time through the public runtime when summary is absent', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Reasoning fixture',
      messages: [
        {
          id: userMessageId,
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: userMessageId,
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'Safe answer.',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: 2_300,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:01.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:01.000Z',
    }),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.textContent).not.toContain('Thinking…');
  } finally {
    await view.unmount();
  }
});

it('retains persisted feedback when saving a new rating fails', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Feedback fixture',
      messages: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: '22222222-2222-4222-8222-222222222222',
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'Completed answer',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: 'good',
          operations: [],
          createdAt: '2026-11-12T00:00:00.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    }),
    setFeedback: vi.fn().mockRejectedValue(new Error('offline')),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    expect(
      view.container
        .querySelector('[aria-label="Good answer"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    await act(async () =>
      view.container
        .querySelector('[aria-label="Bad answer"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await settle();
    expect(
      view.container
        .querySelector('[aria-label="Good answer"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      view.container
        .querySelector('[aria-label="Bad answer"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
    expect(toastSpy.error).toHaveBeenCalledWith('Feedback could not be saved.');
  } finally {
    await view.unmount();
  }
});

it('renders a persisted failed response with a retry action after reload', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Failed fixture',
      messages: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          role: 'user',
          parentId: null,
          text: 'Review this clause',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: '22222222-2222-4222-8222-222222222222',
          runId: '44444444-4444-4444-8444-444444444444',
          text: '',
          status: 'failed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:00.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
    }),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const alerts = view.container.querySelectorAll(
      '[data-message-id="33333333-3333-4333-8333-333333333333"] [role="alert"]',
    );
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert.textContent).toContain('The response could not be completed.');
    expect(alert.className).toContain('rounded-xl');
    expect(alert.className).toContain('bg-muted');
    expect(alert.className).toContain('pl-3.5');
    const retry = alert.querySelector<HTMLButtonElement>(
      'button[aria-label="Try again"]',
    );
    expect(retry).not.toBeNull();
    expect(retry?.getAttribute('data-slot')).toBe('button');
    expect(retry?.className).toContain('border-input');
    expect(retry?.className).toContain('shrink-0');
    expect(retry?.querySelector('.lucide-refresh-cw')).not.toBeNull();
    expect(alert.querySelector('[data-slot="alert-title"]')).toBeNull();
    expect(alert.textContent).not.toMatch(/because|due to|error:|timed out/i);
  } finally {
    await view.unmount();
  }
});

function cancelledTree(): ChatTree {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  return {
    id: chatId,
    title: 'Stopped fixture',
    messages: [
      {
        id: userId,
        role: 'user',
        parentId: null,
        text: 'Review this clause',
        effort: 'high',
        createdAt: '2026-11-12T00:00:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        role: 'assistant',
        parentId: userId,
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Partial answer kept',
        status: 'cancelled',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-12T00:00:01.000Z',
      },
    ],
    viewedLeafId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:01.000Z',
  } as ChatTree;
}

it('shows the status line "You stopped this response." directly above the action bar and keeps the partial text', async () => {
  const tree = cancelledTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const root = view.container.querySelector(
      '[data-message-id="33333333-3333-4333-8333-333333333333"]',
    )!;
    expect(root.textContent).toContain('Partial answer kept');
    const row = Array.from(root.querySelectorAll('div,p,span')).find(
      (element) => element.textContent?.trim() === 'You stopped this response.',
    )!;
    expect(row).toBeDefined();
    expect(row.className).toContain('text-muted-foreground');
    expect(row.className).toContain('leading-[1.6]');
    expect(row.querySelector('svg')).toBeNull();
    expect(
      row.nextElementSibling?.querySelector('[aria-label="Copy answer"]'),
    ).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it('renders Reconnecting after the last message inside the viewport', async () => {
  const tree = cancelledTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" reconnecting />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const status = Array.from(
      view.container.querySelectorAll('[role="status"]'),
    ).find(
      (element) => element.textContent === 'Connection lost. Reconnecting…',
    )!;
    expect(status.querySelector('.lucide-wifi')).not.toBeNull();
    expect(status.className).toContain('leading-[1.6]');
    expect(status).toBeDefined();
    const viewport = view.container.querySelector(
      '[data-slot="aui_thread-viewport"]',
    )!;
    expect(viewport.contains(status)).toBe(true);
    const group = view.container.querySelector(
      '[data-slot="aui_message-group"]',
    )!;
    expect(
      group.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('clears a prior scoped transcript immediately and ignores its in-flight response', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const firstTree = {
    id: chatId,
    title: 'Old scope',
    messages: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        role: 'assistant',
        parentId: null,
        runId: '44444444-4444-4444-8444-444444444444',
        text: 'Private old scope transcript',
        status: 'completed',
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-12T00:00:00.000Z',
      },
    ],
    viewedLeafId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  };
  const newTree = {
    ...firstTree,
    title: 'New scope',
    messages: [
      {
        ...firstTree.messages[0]!,
        text: 'New scope transcript',
      },
    ],
  };
  const client = {
    get: vi
      .fn()
      .mockResolvedValueOnce(firstTree)
      .mockResolvedValueOnce(newTree),
  };
  const makeView = (actorScope: string, currentChatId = chatId) =>
    wrapped(
      <ChatView
        client={chatGetEnvelope(client) as never}
        actorScope={actorScope}
        chatId={currentChatId}
        displayName="Ada"
        orgId={actorScope.split(':')[0]!}
        userId={actorScope.split(':')[1]!}
      />,
    );
  const view = await render(makeView('tenant-a:user-a'));
  try {
    await settle();
    expect(view.container.textContent).toContain(
      'Private old scope transcript',
    );
    await view.rerender(makeView('tenant-b:user-b'));
    expect(view.container.textContent).not.toContain(
      'Private old scope transcript',
    );
    await settle();
    expect(view.container.textContent).toContain('New scope transcript');
    expect(view.container.textContent).not.toContain(
      'Private old scope transcript',
    );
    expect(client.get).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
  }
});

it('ignores a stale tree response after the route changes', async () => {
  const chatA = '11111111-1111-4111-8111-111111111111';
  const chatB = '55555555-5555-4555-8555-555555555555';
  const treeA = {
    id: chatA,
    title: 'Old chat',
    messages: [],
    viewedLeafId: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  };
  const treeB = {
    ...treeA,
    id: chatB,
    title: 'Current chat',
    messages: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        role: 'assistant' as const,
        parentId: null,
        runId: '77777777-7777-4777-8777-777777777777',
        text: 'Current chat content',
        status: 'completed' as const,
        reasoningSummary: null,
        reasoningDurationMs: null,
        feedback: null,
        operations: [],
        createdAt: '2026-11-12T00:00:00.000Z',
      },
    ],
    viewedLeafId: '66666666-6666-4666-8666-666666666666',
  };
  let releaseA!: (value: typeof treeA) => void;
  const responseA = new Promise<typeof treeA>((resolve) => {
    releaseA = resolve;
  });
  const client = {
    get: vi.fn().mockReturnValueOnce(responseA).mockResolvedValueOnce(treeB),
  };
  const makeView = (id: string) =>
    wrapped(
      <ChatView
        client={chatGetEnvelope(client) as never}
        actorScope="tenant:user"
        chatId={id}
        displayName="Ada"
        orgId="tenant"
        userId="user"
      />,
    );
  const view = await render(makeView(chatA));
  try {
    await view.rerender(makeView(chatB));
    await settle();
    releaseA(treeA);
    await settle();
    expect(view.container.textContent).toContain('Current chat content');
    expect(view.container.textContent).not.toContain('Old chat');
  } finally {
    await view.unmount();
  }
});

it('shows a measured duration without exposing a summary for a raw-only signal', async () => {
  const { PersistedReasoning } =
    await import('../src/components/chat/chat-reasoning.js');
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary={null}
      durationMs={2_300}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.querySelector('button')).toBeNull();
    expect(view.container.textContent).not.toContain('Reasoning');
  } finally {
    await view.unmount();
  }
});

it('disables an empty thread send and does not submit whitespace with Enter', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Whitespace composer',
      messages: [
        {
          id: userId,
          role: 'user',
          parentId: null,
          text: 'Question',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        {
          id: answerId,
          role: 'assistant',
          parentId: userId,
          runId: '44444444-4444-4444-8444-444444444444',
          text: 'Answer',
          status: 'completed',
          reasoningSummary: null,
          reasoningDurationMs: null,
          feedback: null,
          operations: [],
          createdAt: '2026-11-12T00:00:01.000Z',
        },
      ],
      viewedLeafId: answerId,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:01.000Z',
    }),
    send: vi.fn(),
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    )!;
    const send = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Send message"]',
    )!;
    expect(send.disabled).toBe(true);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, '   ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(send.disabled).toBe(true);
    expect(client.send).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

const expectElevatedShell = (shell: Element | null | undefined) => {
  expect(shell).not.toBeNull();
  const className = shell?.className ?? '';
  expect(className).toContain('max-w-[880px]');
  expect(className).toContain('rounded-[20px]');
  expect(className).toMatch(/(^|\s)shadow-/);
  expect(className).toContain('bg-background');
  expect(className).toContain('focus-within:border-input');
  expect(className).toContain('rounded-[20px]');
};

const expectRoundSize9 = (button: Element | null | undefined) => {
  expect(button).not.toBeNull();
  expect(button?.className).toContain('rounded-full');
  expect(button?.className).toContain('size-9');
};

it('renders the new chat composer as an elevated 880px shell with a Deep thinking pill', async () => {
  const view = await render(
    wrapped(
      <ChatView
        client={{ create: vi.fn() } as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
        onNavigate={vi.fn()}
      />,
    ),
  );
  try {
    await settle();
    expectElevatedShell(view.container.querySelector('form > div'));
    expectRoundSize9(
      view.container.querySelector('[aria-label="Send message"]'),
    );
    const thinking = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    )!;
    expect(thinking.getAttribute('aria-pressed')).toBe('false');
    expect(thinking.className).not.toContain('bg-(--lexon-tint)');
    await act(async () => thinking.click());
    expect(thinking.getAttribute('aria-pressed')).toBe('true');
    expect(thinking.className).toContain('bg-(--lexon-tint)');
    expect(thinking.className).toContain('text-(--lexon-red-text)');
    expect(view.container.querySelector('textarea')?.placeholder).toBe(
      'Ask Lexon about a contract, a regulation, or a case...',
    );
  } finally {
    await view.unmount();
  }
});

it('renders the thread composer as an elevated 880px shell with a Deep thinking pill', async () => {
  const tree = makeBranchTree(false);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    ),
  );
  function Harness() {
    const [effort, setEffort] = useState<'high' | 'max'>('high');
    return (
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" effort={effort} onEffortChange={setEffort} />
      </ChatRuntime>
    );
  }
  const view = await render(wrapped(<Harness />));
  try {
    await settle();
    expect(
      view.container.querySelector('.aui-thread-root')?.getAttribute('style'),
    ).toContain('--thread-max-width: 880px');
    expectElevatedShell(
      view.container.querySelector('[data-slot="aui_composer-shell"]'),
    );
    expectRoundSize9(
      view.container.querySelector('[aria-label="Send message"]'),
    );
    const thinking = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="Deep thinking"]',
    )!;
    expect(thinking.getAttribute('aria-pressed')).toBe('false');
    await act(async () => thinking.click());
    expect(thinking.getAttribute('aria-pressed')).toBe('true');
    expect(thinking.className).toContain('bg-(--lexon-tint)');
    expect(thinking.className).toContain('text-(--lexon-red-text)');
    expect(view.container.querySelector('textarea')?.placeholder).toBe(
      'Ask Lexon about a contract, a regulation, or a case...',
    );
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('renders the thread Stop control as a round size-9 button and keeps the answering placeholder', async () => {
  const tree = makeBranchTree(true);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: {
            'content-type': 'text/event-stream',
            'x-lexon-stream-recovery-result': 'snapshot',
          },
        }),
    ),
  );
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    expectRoundSize9(
      view.container.querySelector('[aria-label="Stop generating"]'),
    );
    expectElevatedShell(
      view.container.querySelector('[data-slot="aui_composer-shell"]'),
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="Message input"]',
      )?.placeholder,
    ).toBe('Lexon is answering…');
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('lays out the thread for reading: bare answers, a user bubble, a fade, and a centered scroll button', async () => {
  const tree = makeBranchTree(false);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    ),
  );
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const assistant = view.container.querySelector<HTMLElement>(
      '[data-role="assistant"]',
    )!;
    expect(assistant).not.toBeNull();
    expect(assistant.className).not.toMatch(/(^|\s)(bg-|border)/);
    expect(
      assistant.querySelector(
        '[data-slot*="avatar"], img, svg[class*="avatar"]',
      ),
    ).toBeNull();
    const body = assistant.querySelector<HTMLElement>('[aria-live="off"]')!;
    expect(body.className).not.toMatch(/(^|\s)(bg-|border)/);
    expect(body.className).toContain('text-base');
    expect(body.className).toContain('leading-[1.75]');

    const user =
      view.container.querySelector<HTMLElement>('[data-role="user"]')!;
    expect(user.className).toContain('ms-auto');
    const bubble = user.querySelector<HTMLElement>('[aria-live="off"]')!;
    expect(bubble.className).toContain('bg-(--lexon-user-bubble)');
    expect(bubble.className).toContain('rounded-[20px]');
    expect(bubble.className).toContain('py-3');
    expect(bubble.className).toContain('leading-[1.6]');

    const fade = view.container.querySelector<HTMLElement>(
      '[data-slot="aui_thread-fade"]',
    )!;
    expect(fade.getAttribute('aria-hidden')).toBe('true');
    expect(fade.className).toContain('pointer-events-none');
    expect(fade.className).toContain('h-10');
    expect(fade.parentElement).toBe(
      view.container.querySelector('.aui-thread-viewport-footer'),
    );
    expect(
      fade.compareDocumentPosition(
        view.container.querySelector('[data-slot="aui_composer-shell"]')!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const scroll = view.container.querySelector<HTMLElement>(
      '.aui-thread-scroll-to-bottom',
    )!;
    expect(scroll.className).toContain('left-1/2');
    expect(scroll.className).toContain('-translate-x-1/2');
    expect(scroll.className).toContain('rounded-full');
    expect(scroll.className).toContain('size-9');
    expect(scroll.querySelector('.lucide-chevron-down')).not.toBeNull();
    expect(scroll.querySelector('.lucide-arrow-down')).toBeNull();
  } finally {
    await view.unmount();
    vi.stubGlobal('fetch', originalFetch);
  }
});

it('shows the loading skeleton at the top with a disabled composer beneath it', async () => {
  const client = { get: vi.fn(() => new Promise<ChatTree>(() => {})) };
  const view = await render(
    wrapped(
      <ChatView
        chatId="11111111-1111-4111-8111-111111111111"
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const status = view.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Loading conversation');
    const skeletons = view.container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
    expect(view.container.querySelectorAll('.animate-pulse').length).toBe(
      skeletons.length,
    );
    const input = view.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Message input"]',
    );
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(true);
    expect(
      view.container.querySelector<HTMLButtonElement>(
        '[aria-label="Send (unavailable: the chat is loading)"]',
      )?.disabled,
    ).toBe(true);
    expect(
      status &&
        input &&
        status.compareDocumentPosition(input) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

function makeEditedFixture() {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const userMessageId = '22222222-2222-4222-8222-222222222222';
  const answerId = '33333333-3333-4333-8333-333333333333';
  return {
    answerId,
    client: {
      get: vi.fn().mockResolvedValue({
        id: chatId,
        title: 'Thread fixture',
        messages: [
          {
            id: userMessageId,
            role: 'user',
            parentId: null,
            text: 'Review this clause',
            effort: 'high',
            createdAt: '2026-11-12T00:00:00.000Z',
          },
          {
            id: answerId,
            role: 'assistant',
            parentId: userMessageId,
            runId: '44444444-4444-4444-8444-444444444444',
            text: 'The clause limits liability.',
            status: 'completed',
            reasoningSummary: null,
            reasoningDurationMs: null,
            feedback: null,
            operations: [],
            createdAt: '2026-11-12T00:00:01.000Z',
          },
        ],
        viewedLeafId: answerId,
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:01.000Z',
      }),
    },
    chatId,
  };
}

it('keeps the edit controls inside the bubble and dims the answer below while editing', async () => {
  const { client, chatId, answerId } = makeEditedFixture();
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const answer = () =>
      view.container.querySelector(`[data-message-id="${answerId}"]`);
    expect(answer()?.className).not.toContain('text-muted-foreground');
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Edit message"]')
        ?.click(),
    );
    await settle();
    const input = view.container.querySelector(
      '[aria-label="Edit message input"]',
    );
    const bubble = input?.closest('[data-slot="aui_user-edit-bubble"]');
    expect(bubble).not.toBeNull();
    const cancel = bubble?.querySelector('[aria-label="Cancel edit"]');
    const send = bubble?.querySelector('[aria-label="Save"]');
    expect(cancel).not.toBeNull();
    expect(send).not.toBeNull();
    expect(
      bubble?.querySelector('[data-slot="aui_user-edit-box"]')?.className,
    ).toContain('rounded-2xl');
    expect(
      input &&
        cancel &&
        send &&
        input.compareDocumentPosition(cancel) &
          Node.DOCUMENT_POSITION_FOLLOWING &&
        cancel.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(answer()?.className).toContain('text-muted-foreground');
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel edit"]')
        ?.click(),
    );
    await settle();
    expect(answer()?.className).not.toContain('text-muted-foreground');
  } finally {
    await view.unmount();
  }
});

it('places the branch picker in the action row of the answer', async () => {
  const tree = {
    ...makeBranchTree(false),
    viewedLeafId: '66666666-6666-4666-8666-666666666666',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const previous = view.container.querySelector(
      '[aria-label="Previous branch"]',
    );
    const row = previous?.closest('[data-slot="aui_message-actions"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('[aria-label="Copy answer"]')).not.toBeNull();
    expect(row?.textContent).toContain('2 / 2');
    expect(row?.querySelector('[aria-label="Next branch"]')).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

function editedBranchTree(): ChatTree {
  const ids = {
    chat: '11111111-1111-4111-8111-111111111111',
    u1: '22222222-2222-4222-8222-222222222222',
    a1: '33333333-3333-4333-8333-333333333333',
    u2: '55555555-5555-4555-8555-555555555555',
    a2: '66666666-6666-4666-8666-666666666666',
  };
  const question = (id: string, text: string) => ({
    id,
    role: 'user',
    parentId: null,
    text,
    effort: 'high',
    createdAt: '2026-11-12T00:00:00.000Z',
  });
  const answer = (id: string, parentId: string, text: string) => ({
    id,
    role: 'assistant',
    parentId,
    runId: '44444444-4444-4444-8444-444444444444',
    text,
    status: 'completed',
    reasoningSummary: null,
    reasoningDurationMs: null,
    feedback: null,
    operations: [],
    createdAt: '2026-11-12T00:00:01.000Z',
  });
  return {
    id: ids.chat,
    title: 'Edited',
    messages: [
      question(ids.u1, 'First wording'),
      answer(ids.a1, ids.u1, 'First answer'),
      question(ids.u2, 'Edited wording'),
      answer(ids.a2, ids.u2, 'Edited answer'),
    ],
    viewedLeafId: ids.a2,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:01.000Z',
  } as ChatTree;
}

function opacityClassesAbove(element: Element, stop: Element): string[] {
  const found: string[] = [];
  for (
    let node: Element | null = element;
    node && node !== stop;
    node = node.parentElement
  )
    if (/opacity-0/.test(node.className)) found.push(node.className);
  return found;
}

it('shows the user message branch picker without hover or focus when the message has several branches', async () => {
  const tree = editedBranchTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const message = view.container.querySelector<HTMLElement>(
      '[data-message-id="55555555-5555-4555-8555-555555555555"]',
    )!;
    const previous = message.querySelector('[aria-label="Previous branch"]')!;
    expect(previous).not.toBeNull();
    expect(message.textContent).toContain('2 / 2');
    expect(opacityClassesAbove(previous, message)).toEqual([]);
  } finally {
    await view.unmount();
  }
});

it('keeps the user message actions revealed by hover or focus when there is a single branch', async () => {
  const tree = twoTurnTree('completed');
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const message = view.container.querySelector<HTMLElement>(
      '[data-message-id="22222222-2222-4222-8222-222222222222"]',
    )!;
    const edit = message.querySelector('[aria-label="Edit message"]')!;
    expect(opacityClassesAbove(edit, message).length).toBeGreaterThan(0);
  } finally {
    await view.unmount();
  }
});

it('shows an answer branch picker without hover or focus on an earlier answer with several branches', async () => {
  const base = twoTurnTree('completed');
  const [u1, a1, u2, a2] = base.messages;
  const tree = {
    ...base,
    messages: [
      u1,
      a1,
      {
        ...a1,
        id: '77777777-7777-4777-8777-777777777777',
        text: 'Regenerated',
      },
      u2,
      a2,
    ],
  } as ChatTree;
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const message = view.container.querySelector<HTMLElement>(
      '[data-message-id="33333333-3333-4333-8333-333333333333"]',
    )!;
    const previous = message.querySelector('[aria-label="Previous branch"]')!;
    expect(previous).not.toBeNull();
    expect(opacityClassesAbove(previous, message)).toEqual([]);
  } finally {
    await view.unmount();
  }
});

function twoTurnTree(firstStatus: 'completed' | 'cancelled'): ChatTree {
  const ids = {
    chat: '11111111-1111-4111-8111-111111111111',
    u1: '22222222-2222-4222-8222-222222222222',
    a1: '33333333-3333-4333-8333-333333333333',
    u2: '55555555-5555-4555-8555-555555555555',
    a2: '66666666-6666-4666-8666-666666666666',
  };
  const answer = (
    id: string,
    parentId: string,
    text: string,
    status: string,
  ) => ({
    id,
    role: 'assistant',
    parentId,
    runId: '44444444-4444-4444-8444-444444444444',
    text,
    status,
    reasoningSummary: null,
    reasoningDurationMs: null,
    feedback: null,
    operations: [],
    createdAt: '2026-11-12T00:00:01.000Z',
  });
  const question = (id: string, parentId: string | null, text: string) => ({
    id,
    role: 'user',
    parentId,
    text,
    effort: 'high',
    createdAt: '2026-11-12T00:00:00.000Z',
  });
  return {
    id: ids.chat,
    title: 'Two turns',
    messages: [
      question(ids.u1, null, 'First question'),
      answer(ids.a1, ids.u1, 'First answer', firstStatus),
      question(ids.u2, ids.a1, 'Second question'),
      answer(ids.a2, ids.u2, 'Second answer', 'completed'),
    ],
    viewedLeafId: ids.a2,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:01.000Z',
  } as ChatTree;
}

it('dims the rendered answer text through the Markdown wrapper while an edit is open', async () => {
  const tree = makeBranchTree(false);
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const text = () =>
      view.container.querySelector<HTMLElement>(
        '[data-message-id="33333333-3333-4333-8333-333333333333"] .aui-md',
      );
    expect(text()?.textContent).toContain('Selected branch answer');
    expect(text()?.className).toMatch(/(^|\s)text-foreground(\s|$)/);
    expect(text()?.className).not.toContain('text-muted-foreground');
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Edit message"]')
        ?.click(),
    );
    await settle();
    expect(text()?.textContent).toContain('Selected branch answer');
    expect(text()?.className).toContain('text-muted-foreground');
    expect(text()?.className).not.toMatch(/(^|\s)text-foreground(\s|$)/);
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel edit"]')
        ?.click(),
    );
    await settle();
    expect(text()?.className).toMatch(/(^|\s)text-foreground(\s|$)/);
    expect(text()?.className).not.toContain('text-muted-foreground');
  } finally {
    await view.unmount();
  }
});

it('shows a visible red Copied state with a check after copying, then returns to Copy', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const tree = cancelledTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const copy = () =>
      view.container.querySelector<HTMLElement>(
        '[aria-label="Copy answer"], [aria-label="Copied"]',
      )!;
    expect(copy().getAttribute('aria-label')).toBe('Copy answer');
    expect(copy().textContent).toBe('Copy');
    expect(copy().className).not.toContain('text-(--lexon-red-text)');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => copy().click());
    expect(writeText).toHaveBeenCalledWith('Partial answer kept');
    expect(copy().textContent).toBe('Copied');
    expect(copy().getAttribute('aria-label')).toBe('Copied');
    expect(copy().className).toContain('text-(--lexon-red-text)');
    expect(copy().querySelector('svg')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(copy().textContent).toBe('Copy');
    expect(copy().className).not.toContain('text-(--lexon-red-text)');
  } finally {
    vi.useRealTimers();
    await view.unmount();
  }
});

it('copies a user message with a Copy message action beside Edit, and shows Copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const tree = cancelledTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const user =
      view.container.querySelector<HTMLElement>('[data-role="user"]')!;
    const copy = () =>
      user.querySelector<HTMLElement>(
        '[aria-label="Copy message"], [aria-label="Copied"]',
      )!;
    const edit = user.querySelector('[aria-label="Edit message"]')!;
    expect(copy().getAttribute('aria-label')).toBe('Copy message');
    // Copy comes first, then Edit; both are visible on touch.
    expect(
      copy().compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(copy().parentElement?.parentElement?.className).toContain(
      '[@media(hover:none)]:opacity-100',
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => copy().click());
    expect(writeText).toHaveBeenCalledWith('Review this clause');
    expect(copy().getAttribute('aria-label')).toBe('Copied');
    expect(copy().className).toContain('text-(--lexon-red-text)');
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(copy().getAttribute('aria-label')).toBe('Copy message');
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await view.unmount();
  }
});

it('fills the given thumb in the red text color and thanks the user', async () => {
  const tree = cancelledTree();
  const client = {
    get: vi.fn().mockResolvedValue(tree),
    setFeedback: vi.fn().mockResolvedValue(undefined),
  };
  toastSpy.success.mockClear();
  const view = await render(
    wrapped(
      <ChatView
        chatId={tree.id}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const thumb = (name: string) =>
      view.container.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
    expect(thumb('Good answer').className).not.toContain(
      'text-(--lexon-red-text)',
    );
    await act(async () => thumb('Good answer').click());
    await settle();
    expect(thumb('Good answer').getAttribute('aria-pressed')).toBe('true');
    expect(thumb('Good answer').className).toContain('text-(--lexon-red-text)');
    expect(
      thumb('Good answer').querySelector('svg')?.getAttribute('class'),
    ).toContain('fill-current');
    expect(thumb('Bad answer').className).not.toContain(
      'text-(--lexon-red-text)',
    );
    expect(toastSpy.success).toHaveBeenCalledWith('Thanks for your feedback.');
  } finally {
    await view.unmount();
  }
});

it('labels Copy and Regenerate and keeps the row visible on the last and a stopped answer only', async () => {
  const tree = twoTurnTree('cancelled');
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const row = (id: string) =>
      view.container.querySelector<HTMLElement>(
        `[data-message-id="${id}"] [data-slot="aui_message-actions"]`,
      )!;
    const last = row('66666666-6666-4666-8666-666666666666');
    expect(last.querySelector('[aria-label="Copy answer"]')?.textContent).toBe(
      'Copy',
    );
    expect(
      last.querySelector('[aria-label="Regenerate answer"]')?.textContent,
    ).toBe('Regenerate');
    expect(last.className).not.toContain('md:opacity-0');
    const stopped = row('33333333-3333-4333-8333-333333333333');
    expect(stopped.className).not.toContain('md:opacity-0');
    const completed = twoTurnTree('completed');
    await view.unmount();
    const second = await render(
      wrapped(
        <ChatRuntime
          actorScope="tenant-1:user-1"
          chatId={completed.id}
          tree={completed}
        >
          <Thread displayName="Ada" />
        </ChatRuntime>,
      ),
    );
    try {
      await settle();
      const earlier = second.container.querySelector<HTMLElement>(
        '[data-message-id="33333333-3333-4333-8333-333333333333"] [data-slot="aui_message-actions"]',
      )!;
      expect(earlier.className).toContain('md:opacity-0');
    } finally {
      await second.unmount();
    }
    return;
  } finally {
    await view.unmount().catch(() => undefined);
  }
});

it('opens a thread with the last user message at the top of the viewport', async () => {
  const chatId = '11111111-1111-4111-8111-111111111111';
  const firstUser = '22222222-2222-4222-8222-222222222222';
  const firstAnswer = '33333333-3333-4333-8333-333333333333';
  const lastUser = '55555555-5555-4555-8555-555555555555';
  const lastAnswer = '66666666-6666-4666-8666-666666666666';
  const answer = (id: string, parentId: string, runId: string) => ({
    id,
    role: 'assistant',
    parentId,
    runId,
    text: 'A long answer.',
    status: 'completed',
    reasoningSummary: null,
    reasoningDurationMs: null,
    feedback: null,
    operations: [],
    createdAt: '2026-11-12T00:00:01.000Z',
  });
  const client = {
    get: vi.fn().mockResolvedValue({
      id: chatId,
      title: 'Scroll fixture',
      messages: [
        {
          id: firstUser,
          role: 'user',
          parentId: null,
          text: 'First question',
          effort: 'high',
          createdAt: '2026-11-12T00:00:00.000Z',
        },
        answer(firstAnswer, firstUser, '44444444-4444-4444-8444-444444444444'),
        {
          id: lastUser,
          role: 'user',
          parentId: firstAnswer,
          text: 'Last question',
          effort: 'high',
          createdAt: '2026-11-12T00:00:02.000Z',
        },
        answer(lastAnswer, lastUser, '77777777-7777-4777-8777-777777777777'),
      ],
      viewedLeafId: lastAnswer,
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:03.000Z',
    }),
  };
  const tops = new Map<HTMLElement, number>();
  const writes: Array<{ element: HTMLElement; value: number }> = [];
  const originalTop = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollTop',
  );
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return tops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      tops.set(this, value);
      writes.push({ element: this, value });
    },
  });
  // The viewport starts at y=0; the last user message sits 420px below it
  // (content offset 420 minus the viewport scroll position).
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const id = this.dataset.messageId;
    const y =
      id === lastUser
        ? 420
        : id === firstUser
          ? 0
          : id === firstAnswer
            ? 80
            : 0;
    const top =
      y -
      (tops.get(
        this.closest('[data-slot="aui_thread-viewport"]') as HTMLElement,
      ) ?? 0);
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 0,
      width: 0,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  const view = await render(
    wrapped(
      <ChatView
        chatId={chatId}
        client={chatGetEnvelope(client) as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    const viewport = view.container.querySelector<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    )!;
    expect(viewport).not.toBeNull();
    expect(tops.get(viewport)).toBe(420);
    expect(writes.filter((w) => w.element === viewport).at(-1)?.value).toBe(
      420,
    );
  } finally {
    await view.unmount();
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalTop)
      Object.defineProperty(Element.prototype, 'scrollTop', originalTop);
    delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
  }
});

function makeTwoTurnTree(): ChatTree {
  const ids = {
    chat: '11111111-1111-4111-8111-111111111111',
    q1: '22222222-2222-4222-8222-222222222221',
    a1: '33333333-3333-4333-8333-333333333331',
    q2: '22222222-2222-4222-8222-222222222222',
    a2: '33333333-3333-4333-8333-333333333332',
  };
  const answer = (id: string, parentId: string, text: string, n: number) => ({
    id,
    role: 'assistant' as const,
    parentId,
    runId: `44444444-4444-4444-8444-44444444444${n}`,
    text,
    status: 'completed' as const,
    reasoningSummary: 'Checked **Article 1320** first.',
    reasoningDurationMs: 8_000,
    feedback: null,
    operations: [],
    createdAt: '2026-11-12T00:00:01.000Z',
  });
  const question = (id: string, parentId: string | null, text: string) => ({
    id,
    role: 'user' as const,
    parentId,
    text,
    effort: 'high' as const,
    createdAt: '2026-11-12T00:00:00.000Z',
  });
  return {
    id: ids.chat,
    title: 'Two turns',
    messages: [
      question(ids.q1, null, 'First question'),
      answer(
        ids.a1,
        ids.q1,
        '# Heading text\n\nPlain **strong text** and `inline code` with a [link text](https://example.test).\n\n- first item with **bold item**\n- second item\n\n1. numbered one',
        1,
      ),
      question(ids.q2, ids.a1, 'Second question'),
      answer(ids.a2, ids.q2, 'Second answer with **bold**.', 2),
    ],
    viewedLeafId: ids.a2,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:01.000Z',
  } as ChatTree;
}

const COLOR_CLASS =
  /(^|\s)text-(foreground|muted-foreground|\(--lexon-[a-z-]+\))(\s|$)/;

// The color a text node renders in: the nearest ancestor that sets a text
// color token (everything below inherits it).
function renderedColorToken(node: Node, root: HTMLElement) {
  for (
    let element = node.parentElement;
    element;
    element = element.parentElement
  ) {
    const match = COLOR_CLASS.exec(element.getAttribute('class') ?? '');
    if (match) return match[2];
    if (element === root) break;
  }
  return null;
}

function visibleTextNodes(root: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.trim()) continue;
    if (text.parentElement?.closest('.sr-only')) continue;
    nodes.push(text);
  }
  return nodes;
}

it('mutes every text node of every answer after the message being edited', async () => {
  const tree = makeTwoTurnTree();
  const view = await render(
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" />
      </ChatRuntime>,
    ),
  );
  try {
    await settle();
    const answers = () =>
      Array.from(
        view.container.querySelectorAll<HTMLElement>('[data-role="assistant"]'),
      );
    expect(answers()).toHaveLength(2);
    // Reasoning header open, so its summary is rendered too.
    for (const answer of answers())
      await act(async () =>
        answer
          .querySelector<HTMLButtonElement>('button[aria-expanded]')
          ?.click(),
      );
    await settle();
    const firstUser = view.container.querySelector<HTMLElement>(
      '[data-role="user"] [aria-label="Edit message"]',
    )!;
    await act(async () => firstUser.click());
    await settle();
    expect(answers()).toHaveLength(2);
    const first = answers()[0]!;
    expect(first.textContent).toContain('strong text');
    expect(first.querySelector('strong')).not.toBeNull();
    expect(first.querySelector('code')).not.toBeNull();
    expect(first.querySelector('a')).not.toBeNull();
    expect(first.querySelector('li')).not.toBeNull();
    expect(first.querySelector('h1')).not.toBeNull();
    for (const answer of answers()) {
      const nodes = visibleTextNodes(answer);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes)
        expect(renderedColorToken(node, answer), `dimmed: ${node.data}`).toBe(
          'muted-foreground',
        );
    }
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel edit"]')
        ?.click(),
    );
    await settle();
    for (const answer of answers())
      expect(answer.className).not.toContain('text-muted-foreground');
  } finally {
    await view.unmount();
  }
});

it('shows Copy and Edit on a user message as 14px Lucide copy and pen icons, and hides them while an answer reconnects', async () => {
  const tree = cancelledTree();
  const render1 = (reconnecting: boolean) =>
    wrapped(
      <ChatRuntime actorScope="tenant-1:user-1" chatId={tree.id} tree={tree}>
        <Thread displayName="Ada" reconnecting={reconnecting} />
      </ChatRuntime>,
    );
  const view = await render(render1(false));
  try {
    await settle();
    const user = () =>
      view.container.querySelector<HTMLElement>('[data-role="user"]')!;
    const copy = user().querySelector('[aria-label="Copy message"]')!;
    const edit = user().querySelector('[aria-label="Edit message"]')!;
    expect(copy.querySelector('svg.lucide-copy')).not.toBeNull();
    expect(edit.querySelector('svg.lucide-pen')).not.toBeNull();
    expect(edit.querySelector('svg.lucide-pencil')).toBeNull();
    expect(copy.className).toContain('[&_svg]:size-3.5');
    expect(edit.className).toContain('[&_svg]:size-3.5');
    await view.rerender(render1(true));
    await settle();
    expect(user().querySelector('[aria-label="Copy message"]')).toBeNull();
    expect(user().querySelector('[aria-label="Edit message"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});
