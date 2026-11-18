import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetIndicatorRuns } from '../src/components/chat/indicator/indicator-run-store.js';
import { PersistedReasoning } from '../src/components/chat/chat-reasoning.js';
import { render } from './render.js';

it('shows persisted summary and measured duration, with no invented timing when duration is absent', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary="The clause allocates liability."
      durationMs={2_300}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.textContent).not.toContain('Thinking…');
    await act(async () => view.container.querySelector('button')!.click());
    expect(view.container.textContent).toContain(
      'The clause allocates liability.',
    );
  } finally {
    await view.unmount();
  }
});

it('keeps the live reasoning label until the first answer text exists', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="running"
      summary="The clause allocates liability."
      durationMs={2_300}
      answerHasText={false}
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thinking…');
    expect(view.container.textContent).not.toContain('Thought for');
  } finally {
    await view.unmount();
  }
});

it('shows a measured private duration after answer text starts while still running', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="running"
      summary={null}
      durationMs={2_300}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.textContent).not.toContain('Thinking…');
  } finally {
    await view.unmount();
  }
});

it('does not expose measured duration for a terminal response with no answer text', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary={null}
      durationMs={2_300}
      answerHasText={false}
    />,
  );
  try {
    expect(view.container.textContent).not.toContain('Thought for');
    expect(view.container.textContent).not.toContain('Thinking…');
  } finally {
    await view.unmount();
  }
});

it('renders no timing label for a finished answer whose persisted duration is null', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary="No timing signal."
      durationMs={null}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).not.toContain('Thought for');
    expect(view.container.textContent).not.toContain('Thinking…');
  } finally {
    await view.unmount();
  }
});

it('shows measured duration without expandable content when a private summary is absent', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary={null}
      durationMs={2_300}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.querySelector('button')).toBeNull();
    expect(view.container.textContent).not.toContain('summary');
  } finally {
    await view.unmount();
  }
});

// --- the indicator in the answer header (spec 4.6 table) -------------------
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  resetIndicatorRuns();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const marks = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<SVGSVGElement>(
      '[data-slot="reasoning-mark"] svg',
    ),
  );
const isStaticMark = (svg: SVGSVGElement) =>
  svg.getAttribute('fill') === 'currentColor' && svg.querySelector('path');

it('row 1: running without a duration shows the running indicator and the visible Thinking label', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="running"
      summary={null}
      durationMs={null}
      answerHasText={false}
    />,
  );
  try {
    expect(marks(view.container)).toHaveLength(1);
    expect(isStaticMark(marks(view.container)[0]!)).toBeFalsy();
    expect(view.container.textContent).toContain('Thinking…');
    expect(view.container.querySelector('[role="status"]')).toBeNull();
    expect(view.container.querySelector('.lucide-loader-circle')).toBeNull();
  } finally {
    await view.unmount();
  }
});

it('row 2: running with a duration and answer text keeps the indicator and shows the duration', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="running"
      summary={null}
      durationMs={8_000}
      answerHasText
    />,
  );
  try {
    expect(marks(view.container)).toHaveLength(1);
    expect(isStaticMark(marks(view.container)[0]!)).toBeFalsy();
    expect(view.container.textContent).toContain('Thought for 8 seconds');
    expect(view.container.querySelector('button')).toBeNull();
  } finally {
    await view.unmount();
  }
});

it('row 2: with a summary the duration is a collapsible trigger that holds the indicator', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="running"
      summary="Reasoning summary."
      durationMs={8_000}
      answerHasText
    />,
  );
  try {
    const trigger = view.container.querySelector('button')!;
    expect(trigger.textContent).toContain('Thought for 8 seconds');
    expect(
      trigger.querySelectorAll('[data-slot="reasoning-mark"] svg'),
    ).toHaveLength(1);
    expect(isStaticMark(marks(view.container)[0]!)).toBeFalsy();
  } finally {
    await view.unmount();
  }
});

it.each(['complete', 'stopped'] as const)(
  'row 3: %s with a duration shows the static mark and Thought for N seconds',
  async (status) => {
    const view = await render(
      <PersistedReasoning
        messageId="m1"
        status={status}
        summary={null}
        durationMs={8_000}
        answerHasText
      />,
    );
    try {
      expect(marks(view.container)).toHaveLength(1);
      expect(isStaticMark(marks(view.container)[0]!)).toBeTruthy();
      expect(view.container.textContent).toContain('Thought for 8 seconds');
    } finally {
      await view.unmount();
    }
  },
);

it('row 3: one second is singular', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary={null}
      durationMs={1_000}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 1 second');
    expect(view.container.textContent).not.toContain('1 seconds');
    expect(isStaticMark(marks(view.container)[0]!)).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('row 4: complete without a duration is the mark only, or Reasoning with a summary', async () => {
  const bare = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary={null}
      durationMs={null}
      answerHasText
    />,
  );
  try {
    expect(isStaticMark(marks(bare.container)[0]!)).toBeTruthy();
    expect(bare.container.textContent).toBe('');
  } finally {
    await bare.unmount();
  }
  const withSummary = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary="A summary."
      durationMs={null}
      answerHasText
    />,
  );
  try {
    expect(isStaticMark(marks(withSummary.container)[0]!)).toBeTruthy();
    expect(withSummary.container.textContent).toContain('Reasoning');
    expect(withSummary.container.textContent).not.toContain('Thought for');
  } finally {
    await withSummary.unmount();
  }
});

it('row 5: failed is the mark only, even when a duration was measured', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="failed"
      summary={null}
      durationMs={8_000}
      answerHasText
    />,
  );
  try {
    expect(marks(view.container)).toHaveLength(1);
    expect(isStaticMark(marks(view.container)[0]!)).toBeTruthy();
    expect(view.container.textContent).toBe('');
  } finally {
    await view.unmount();
  }
});

it('a run that completes within one frame of starting ends on the static mark', async () => {
  const props = {
    messageId: 'quick',
    summary: null,
    durationMs: null,
    answerHasText: true,
  } as const;
  const view = await render(<PersistedReasoning {...props} status="running" />);
  try {
    expect(isStaticMark(marks(view.container)[0]!)).toBeFalsy();
    await view.rerender(<PersistedReasoning {...props} status="complete" />);
    expect(marks(view.container)).toHaveLength(1);
    // Drive the finish to its end with the stubbed frame clock.
    const raf = vi.mocked(requestAnimationFrame);
    for (let i = 0; i < 400; i++) {
      const callbacks = raf.mock.calls.map(([callback]) => callback);
      raf.mockClear();
      clock += 16;
      await act(async () => {
        for (const callback of callbacks) callback(clock);
      });
    }
    expect(marks(view.container)).toHaveLength(1);
    expect(isStaticMark(marks(view.container)[0]!)).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('35R2: the header chevron points right when collapsed and down when open, over an indented block with a left rule', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="complete"
      summary="A summary."
      durationMs={8_000}
      answerHasText
    />,
  );
  try {
    const trigger = view.container.querySelector('button')!;
    expect(trigger.querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(trigger.querySelector('.lucide-chevron-down')).toBeNull();
    await act(async () => trigger.click());
    expect(trigger.querySelector('.lucide-chevron-down')).not.toBeNull();
    expect(trigger.querySelector('.lucide-chevron-right')).toBeNull();
    const block = view.container.querySelector<HTMLElement>(
      '[data-slot="collapsible-content"]',
    )!;
    expect(block.className).toContain('border-s-2');
    expect(block.className).toContain('border-input');
    expect(block.className).toContain('ps-3.5');
    expect(block.className).toContain('text-sm');
  } finally {
    await view.unmount();
  }
});

it('35R2: a failed answer without a summary or duration has no Reasoning label', async () => {
  const view = await render(
    <PersistedReasoning
      messageId="m1"
      status="failed"
      summary={null}
      durationMs={null}
      answerHasText
    />,
  );
  try {
    expect(view.container.textContent).not.toContain('Reasoning');
    expect(view.container.textContent).toBe('');
  } finally {
    await view.unmount();
  }
});
