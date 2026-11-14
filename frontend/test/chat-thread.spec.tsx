import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatView } from '../src/components/chat/chat-view.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { TooltipIconButton } from '../src/components/assistant-ui/elements/tooltip-icon-button.js';
import { rememberChatSearchHighlight } from '../src/lib/chat-search-highlight.js';
import { render, settle } from './render.js';

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
      await hoverAndFocus(
        button,
        'Deep thinking: takes longer and uses more of your budget.',
      );
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
          client={client as never}
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
      await hoverAndFocus(
        button,
        'Deep thinking: takes longer and uses more of your budget.',
      );
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
  const view = await render(
    wrapped(
      <ChatView
        client={client as never}
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
    expect(view.container.querySelector('h2')?.className).toContain(
      'font-serif',
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
        client={client as never}
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
        client={client as never}
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
        client={client as never}
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
        client={client as never}
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
        client={client as never}
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
    expect(
      view.container.querySelector('[aria-label="Save edit"]'),
    ).not.toBeNull();
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
          client={client as never}
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
        client={client as never}
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
        client={client as never}
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
        client={client as never}
        actorScope="org:user"
        displayName="Ada"
        orgId="org-id"
        userId="user-id"
      />,
    ),
  );
  try {
    await settle();
    expect(view.container.textContent).toContain(
      'The response could not be completed.',
    );
    expect(
      view.container.querySelector('[aria-label="Try again"]'),
    ).not.toBeNull();
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
        client={client as never}
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
        client={client as never}
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
    <PersistedReasoning summary={null} durationMs={2_300} answerHasText />,
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
        client={client as never}
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
