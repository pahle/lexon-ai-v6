import { expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAuiState,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/ai-sdk';
import { useChat } from '@ai-sdk/react';
import {
  ChatRuntimeProvider,
  inertChatModelAdapter,
} from '../src/components/shell/chat-runtime-provider';
import { render } from './render.js';
it('renders a real idle runtime on React19 and TS6 without invoking a model or network', async () => {
  const run = vi.fn<ChatModelAdapter['run']>(async () => ({ content: [] }));
  const adapter: ChatModelAdapter = { run };
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network'));
  function State() {
    const running = useAuiState((s) => s.thread.isRunning);
    return <span>{running ? 'Running' : 'Idle'}</span>;
  }
  function Harness() {
    const runtime = useLocalRuntime(adapter);
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <State />
      </AssistantRuntimeProvider>
    );
  }
  const view = await render(<Harness />);
  try {
    expect(view.container.textContent).toBe('Idle');
    expect(run).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(useChatRuntime).toBeTypeOf('function');
    expect(useChat).toBeTypeOf('function');
  } finally {
    await view.unmount();
    network.mockRestore();
  }
});

it('provides a tenant-keyed idle LocalRuntime without chat transport', async () => {
  const run = vi.spyOn(inertChatModelAdapter, 'run');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network'));
  const view = await render(
    <ChatRuntimeProvider tenantId="tenant-a">
      <State />
    </ChatRuntimeProvider>,
  );
  try {
    expect(view.container.textContent).toBe('Idle');
    await view.rerender(
      <ChatRuntimeProvider tenantId="tenant-b">
        <State />
      </ChatRuntimeProvider>,
    );
    expect(view.container.textContent).toBe('Idle');
    expect(run).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
  }
});

function State() {
  const running = useAuiState((s) => s.thread.isRunning);
  return <span>{running ? 'Running' : 'Idle'}</span>;
}
