import { forwardRef } from 'react';
import { act } from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownText } from '../src/components/chat/markdown-text.js';
import { render } from './render.js';

const smoothSeen = vi.hoisted(() => [] as unknown[]);
vi.mock('@assistant-ui/react-markdown', async (original) => {
  const real = await original<typeof import('@assistant-ui/react-markdown')>();
  const Real = real.MarkdownTextPrimitive;
  const Spy = forwardRef<HTMLDivElement, Record<string, unknown>>(
    (props, ref) => {
      smoothSeen.push(props.smooth);
      return <Real {...(props as object)} {...({ ref } as object)} />;
    },
  );
  Spy.displayName = 'SpyMarkdownTextPrimitive';
  return { ...real, MarkdownTextPrimitive: Spy };
});

let reduced = false;
beforeEach(() => {
  smoothSeen.length = 0;
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({ text, running }: { text: string; running: boolean }) {
  const messages: ThreadMessageLike[] = [
    {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text }],
      status: running
        ? { type: 'running' }
        : { type: 'complete', reason: 'stop' },
    },
  ];
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (m) => m,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages>
          {() => (
            <MessagePrimitive.Root>
              <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
            </MessagePrimitive.Root>
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const last = () => smoothSeen.at(-1);
const frames = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('the live message gets smoothing enabled with the default drain values', async () => {
  const view = await render(<Harness text="Hello" running />);
  expect(last()).toEqual({ drainMs: 250, minCommitMs: 0 });
  await view.unmount();
});

it('a history message gets smooth={false}', async () => {
  const view = await render(<Harness text="Hello" running={false} />);
  expect(last()).toBe(false);
  await view.unmount();
});

it('prefers-reduced-motion: reduce gives smooth={false}', async () => {
  reduced = true;
  const view = await render(<Harness text="Hello" running />);
  expect(last()).toBe(false);
  await view.unmount();
});

it('the visible text is never longer than the received text and the full text appears at the end', async () => {
  const full =
    'Pasal 1320 KUHPerdata menetapkan empat syarat sahnya perjanjian.';
  const view = await render(<Harness text={full.slice(0, 10)} running />);
  const visible = () => view.container.textContent ?? '';
  for (let end = 20; end < full.length; end += 10) {
    const received = full.slice(0, end);
    await view.rerender(<Harness text={received} running />);
    await frames(40);
    expect(visible().length).toBeLessThanOrEqual(received.length);
    expect(received.startsWith(visible())).toBe(true);
  }
  await view.rerender(<Harness text={full} running={false} />);
  await frames(400);
  expect(visible()).toBe(full);
  await view.unmount();
});
