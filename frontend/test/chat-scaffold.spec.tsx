import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuiState } from '@assistant-ui/react';
import { ChatRuntimeProvider } from '../src/components/shell/chat-runtime-provider';
import { Workspace } from '../src/components/organizations/workspace';
import { ThreadList } from '../src/components/assistant-ui/elements/thread-list.aui';
import { inertChatModelAdapter } from '../src/components/shell/chat-runtime-provider';
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
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/workspace',
}));

vi.mock('../src/components/shell/workspace-provider', () => ({
  useWorkspace: () => ({
    identity: {
      user: { id: 'user-1', name: 'Ada Lovelace', onboardingCompleted: true },
      organization: { id: 'tenant-1' },
    },
  }),
}));

it('renders a full inert Home with a keyboard-reachable composer', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
  let filePickerCalls = 0;
  const inputClick = vi
    .spyOn(HTMLInputElement.prototype, 'click')
    .mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') filePickerCalls += 1;
    });
  const view = await render(
    <ChatRuntimeProvider tenantId="tenant-1">
      <RuntimeStateProbe />
      <ThreadList />
      <Workspace />
    </ChatRuntimeProvider>,
  );

  try {
    await settle();
    expect(view.container.querySelectorAll('h1')).toHaveLength(1);
    expect(view.container.querySelector('h1')?.parentElement?.className).toBe(
      'sr-only',
    );
    expect(view.container.querySelector('h1')?.getAttribute('tabindex')).toBe(
      '-1',
    );
    expect(document.activeElement).toBe(document.body);
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    expect(view.container.textContent).toContain('Chat is coming soon');
    expect(view.container.textContent).toContain('No conversations yet.');
    expect(
      (view.container.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.disabled,
    ).toBe(false);
    const send = view.container.querySelector(
      '[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    const attachment = view.container.querySelector(
      '[aria-label="Add Attachment"]',
    ) as HTMLButtonElement | null;
    expect(send?.getAttribute('aria-disabled')).toBe('true');
    expect(attachment?.getAttribute('aria-disabled')).toBe('true');
    expect(send?.disabled).toBe(false);
    expect(attachment?.disabled).toBe(false);
    expect(view.container.querySelector('[aria-label*="New"]')).toBeNull();
    expect(
      view.container.querySelector('audio, video, [contenteditable="true"]'),
    ).toBeNull();

    const composer = view.container.querySelector('form');
    const input = view.container.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    expect(composer).not.toBeNull();
    expect(input).not.toBeNull();

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, 'Draft text');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const textPaste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(textPaste, 'clipboardData', {
        value: {
          files: [],
          items: [],
          types: ['text/plain'],
          getData: () => ' pasted words',
        },
      });
      input.dispatchEvent(textPaste);
      expect(textPaste.defaultPrevented).toBe(false);
    });
    expect(input.value).toBe('Draft text');
    let fileDrop: Event;
    let filePaste: Event;

    send!.focus();
    expect(document.activeElement).toBe(send);
    await act(async () => {
      send!.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
      );
      send!.dispatchEvent(
        new KeyboardEvent('keyup', { key: ' ', bubbles: true }),
      );
      send!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      send!.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }),
      );
      send!.click();
      attachment!.click();
      fileDrop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(fileDrop, 'dataTransfer', {
        value: { files: [new File(['doc'], 'draft.txt')], types: ['Files'] },
      });
      composer!.dispatchEvent(fileDrop);
      filePaste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(filePaste, 'clipboardData', {
        value: {
          files: [new File(['doc'], 'draft.txt')],
          items: [
            { kind: 'file', getAsFile: () => new File(['doc'], 'draft.txt') },
          ],
          types: ['Files'],
          getData: () => '',
        },
      });
      input.dispatchEvent(filePaste);
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      composer!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(fileDrop!.defaultPrevented).toBe(true);
    expect(filePaste!.defaultPrevented).toBe(true);
    expect(
      view.container.querySelector('[data-testid="runtime-state"]')
        ?.textContent,
    ).toBe('0 messages / 0 threads / 0 attachments');
    expect(view.container.querySelectorAll('[data-role="user"]')).toHaveLength(
      0,
    );
    expect(view.container.textContent).not.toContain('New Thread');
    expect(
      view.container.querySelectorAll('[data-slot="aui_thread-list-item"]'),
    ).toHaveLength(0);
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(filePickerCalls).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    await view.rerender(
      <ChatRuntimeProvider tenantId="tenant-2">
        <RuntimeStateProbe />
        <ThreadList />
        <Workspace />
      </ChatRuntimeProvider>,
    );
    expect(
      (view.container.querySelector('textarea') as HTMLTextAreaElement | null)
        ?.value,
    ).toBe('');
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
    inputClick.mockRestore();
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
    expect(view.container.textContent).toContain('Welcome, Ada Lovelace');
    await view.rerender(<></>);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
  }
});
