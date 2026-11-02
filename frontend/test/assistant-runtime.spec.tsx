import { expect, it, vi } from 'vitest';
import { useEffect } from 'react';
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
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network'));
  const view = await render(
    <ChatRuntimeProvider tenantId="tenant-a">
      <RuntimeMountProbe mounted={mounted} unmounted={unmounted} />
    </ChatRuntimeProvider>,
  );
  try {
    expect(view.container.textContent).toBe('Idle');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await view.rerender(
      <ChatRuntimeProvider tenantId="tenant-b">
        <RuntimeMountProbe mounted={mounted} unmounted={unmounted} />
      </ChatRuntimeProvider>,
    );
    expect(view.container.textContent).toBe('Idle');
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    await view.rerender(<></>);
    expect(unmounted).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
    run.mockRestore();
    network.mockRestore();
  }
});

function RuntimeMountProbe({
  mounted,
  unmounted,
}: {
  mounted: () => void;
  unmounted: () => void;
}) {
  const running = useAuiState((s) => s.thread.isRunning);
  useEffect(() => {
    mounted();
    return unmounted;
  }, [mounted, unmounted]);
  return <span>{running ? 'Running' : 'Idle'}</span>;
}
