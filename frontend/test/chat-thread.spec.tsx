import { act, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatView } from '../src/components/chat/chat-view.js';
import { render, settle } from './render.js';

const invalidationSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: invalidationSubscribe,
}));
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

function wrapped(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

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
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, '🧾'.repeat(4_097));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
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

it('subscribes to title invalidations with the verified organization and user scope and disposes on unmount', async () => {
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
    expect(invalidationSubscribe).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'tenant-α',
      userId: 'user-β',
    });
  } finally {
    await view.unmount();
    expect(cleanup).toHaveBeenCalledOnce();
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
        feedback: null,
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
