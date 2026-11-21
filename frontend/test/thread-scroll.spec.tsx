import { act } from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createFrameCoalescer,
  ScrollOnNewRun,
  ScrollToLatest,
  BottomSentinel,
} from '../src/components/chat/thread-scroll.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { render } from './render.js';

let frameQueue: FrameRequestCallback[] = [];
const flushFrame = () => {
  const queue = frameQueue;
  frameQueue = [];
  for (const callback of queue) callback(0);
};

beforeEach(() => {
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return frameQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it('100 chunks within one frame → one scroll write', () => {
  const write = vi.fn();
  const scroll = createFrameCoalescer(write);
  for (let chunk = 0; chunk < 100; chunk++) scroll.request();
  expect(frameQueue).toHaveLength(1);
  expect(write).not.toHaveBeenCalled();
  flushFrame();
  expect(write).toHaveBeenCalledTimes(1);
  scroll.request();
  flushFrame();
  expect(write).toHaveBeenCalledTimes(2);
});

function Row() {
  const role = useAuiState((state) => state.message.role);
  return (
    <MessagePrimitive.Root data-role={role}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function Harness({ running }: { running: boolean }) {
  const messages: ThreadMessageLike[] = [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Q1' }] },
    {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'A1' }],
      status: { type: 'complete', reason: 'stop' },
    },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Q2' }] },
    ...(running
      ? ([
          {
            id: 'a2',
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            status: { type: 'running' },
          },
        ] satisfies ThreadMessageLike[])
      : []),
  ];
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: running,
    convertMessage: (m) => m,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport data-slot="aui_thread-viewport">
          <ThreadPrimitive.Messages>{() => <Row />}</ThreadPrimitive.Messages>
          <ScrollOnNewRun />
          <BottomSentinel />
          <TooltipProvider>
            <div className="relative">
              <ScrollToLatest />
            </div>
          </TooltipProvider>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

it('a new run scrolls the user message to block:start', async () => {
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  const view = await render(<Harness running={false} />);
  scrollIntoView.mockClear();
  await view.rerender(<Harness running />);
  act(() => flushFrame());
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: 'start',
    behavior: 'smooth',
  });
  const target = scrollIntoView.mock.contexts[0] as HTMLElement;
  expect(target.textContent).toBe('Q2');
  await view.unmount();
});

it('the scroll-to-latest button follows an IntersectionObserver on the bottom sentinel', async () => {
  let notify: (visible: boolean) => void = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const view = await render(<Harness running={false} />);
  const button = () =>
    view.container.querySelector<HTMLButtonElement>(
      'button.aui-thread-scroll-to-bottom',
    )!;
  expect(button().className).toContain('size-9');
  expect(button().className).toContain('bottom-full');
  expect(button().className).toContain('mb-3');
  expect(button().disabled).toBe(true);
  await act(async () => notify(false));
  expect(button().disabled).toBe(false);
  await act(async () => notify(true));
  expect(button().disabled).toBe(true);
  await view.unmount();
});
