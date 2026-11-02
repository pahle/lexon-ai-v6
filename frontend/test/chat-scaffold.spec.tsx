import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { ChatRuntimeProvider } from '../src/components/shell/chat-runtime-provider';
import { Workspace } from '../src/components/organizations/workspace';
import { ThreadList } from '../src/components/assistant-ui/elements/thread-list.aui';
import { inertChatModelAdapter } from '../src/components/shell/chat-runtime-provider';
import { render } from './render.js';

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      user: { id: 'user-1', name: 'Ada Lovelace', onboardingCompleted: true },
      organization: { id: 'tenant-1' },
    },
  }),
}));

it('renders an inert Home, composer, and empty thread group without effects', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  const view = await render(
    <ChatRuntimeProvider tenantId="tenant-1">
      <ThreadList />
      <Workspace />
    </ChatRuntimeProvider>,
  );

  try {
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
    expect(view.container.textContent).toContain('Ada Lovelace');
    expect(view.container.textContent).toContain('Chat is not available yet.');
    expect(view.container.textContent).toContain('No conversations yet.');
    expect(
      (view.container.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.disabled,
    ).toBe(true);
    expect(view.container.querySelector('button[type="submit"]')).toBeNull();
    expect(view.container.querySelector('[aria-label*="More"]')).toBeNull();
    expect(view.container.querySelector('[aria-label*="New"]')).toBeNull();
    expect(view.container.querySelectorAll('button')).toHaveLength(0);
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(
      view.container.querySelector('audio, video, [contenteditable="true"]'),
    ).toBeNull();

    const composer = view.container.querySelector('form');
    const input = view.container.querySelector('textarea');
    expect(composer).not.toBeNull();
    expect(input).not.toBeNull();
    composer!.focus();
    const focusedBefore = document.activeElement;
    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      composer!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(composer);
    expect(document.activeElement).toBe(focusedBefore);
    expect(run).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
  }
});

it('unmounts the tenant runtime when its key changes or identity is signed out', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const view = await render(
    <ChatRuntimeProvider tenantId="tenant-1">
      <ThreadList />
      <Workspace />
    </ChatRuntimeProvider>,
  );

  try {
    await view.rerender(
      <ChatRuntimeProvider tenantId="tenant-2">
        <ThreadList />
        <Workspace />
      </ChatRuntimeProvider>,
    );
    expect(view.container.textContent).toContain('Ada Lovelace');
    await view.rerender(<></>);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
  }
});
