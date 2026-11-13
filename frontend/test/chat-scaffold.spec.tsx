import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuiState } from '@assistant-ui/react';
import {
  ChatRuntimeProvider,
  inertChatModelAdapter,
} from '../src/components/shell/chat-runtime-provider';
import { Workspace } from '../src/components/organizations/workspace';
import { ThreadList } from '../src/components/assistant-ui/elements/thread-list.aui';
import { render, settle } from './render.js';

beforeEach(() => {
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/workspace',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('../src/lib/chat-title-invalidation.js', () => ({
  subscribeToChatInvalidations: () => () => undefined,
}));
vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      user: { id: 'user-1', name: 'Ada Lovelace', onboardingCompleted: true },
      organization: { id: 'tenant-1' },
    },
  }),
}));

const queryClient = new QueryClient();
function page(tenantId: string) {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatRuntimeProvider tenantId={tenantId}>
        <RuntimeStateProbe />
        <ThreadList />
        <Workspace />
      </ChatRuntimeProvider>
    </QueryClientProvider>
  );
}

it('renders an enabled new-chat composer without inventing attachment or model controls', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  const view = await render(page('tenant-1'));
  try {
    await settle();
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')?.parentElement?.className).toBe(
      'sr-only',
    );
    expect(view.container.querySelector('h1')?.textContent).toBe('New chat');
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    expect(view.container.textContent).toContain('No conversations yet.');
    const input = view.container.querySelector('textarea');
    expect(input?.placeholder).toBe(
      'Ask Lexon about a contract, a regulation, or a case...',
    );
    expect(input?.disabled).toBe(false);
    expect(
      view.container.querySelector('button[type="submit"]')?.textContent,
    ).toContain('Send');
    expect(
      view.container.querySelector('[aria-label*="Attachment"]'),
    ).toBeNull();
    expect(view.container.querySelector('[aria-label*="Model"]')).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(
      view.container.querySelector('audio, video, [contenteditable="true"]'),
    ).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Draft text');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((input as HTMLTextAreaElement).value).toBe('Draft text');
    expect(network).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    await view.rerender(page('tenant-2'));
    expect(
      (view.container.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.value,
    ).toBe('');
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
  }
});

function RuntimeStateProbe() {
  const messages = useAuiState((state) => state.thread.messages.length);
  const threads = useAuiState((state) => state.threads.threadIds.length);
  const attachments = useAuiState((state) => state.composer.attachments.length);
  return (
    <output data-testid="runtime-state">
      {messages} messages / {threads} threads / {attachments} attachments
    </output>
  );
}

it('unmounts the tenant runtime when its key changes or identity is signed out', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const view = await render(page('tenant-1'));
  try {
    await view.rerender(page('tenant-2'));
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    await view.rerender(<></>);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
  }
});
