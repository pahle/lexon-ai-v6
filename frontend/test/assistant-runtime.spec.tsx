import { expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useAuiState,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/ai-sdk';
import { useChat } from '@ai-sdk/react';
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
