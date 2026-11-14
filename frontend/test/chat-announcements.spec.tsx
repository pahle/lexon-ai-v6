import { act } from 'react';
import { expect, afterEach, it, vi } from 'vitest';
import { useIncrementalAnnouncement } from '../src/components/assistant-ui/elements/thread.aui.js';
import { render } from './render.js';

afterEach(() => vi.useRealTimers());

function isWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function AnnouncementProbe({
  messageId = 'answer-1',
  text,
  running,
  initialTextIsNew = false,
}: {
  messageId?: string;
  text: string;
  running: boolean;
  initialTextIsNew?: boolean;
}) {
  const announcement = useIncrementalAnnouncement(
    messageId,
    text,
    running,
    initialTextIsNew,
  );
  return announcement.active ? (
    <p aria-live="polite" aria-atomic="false">
      <span key={announcement.sequence}>{announcement.text}</span>
    </p>
  ) : null;
}

it('announces every part of a long text delta in bounded segments', async () => {
  vi.useFakeTimers();
  const view = await render(<AnnouncementProbe text="" running />);
  try {
    const answer = 'A'.repeat(401);
    await view.rerender(<AnnouncementProbe text={answer} running />);
    const region = view.container.querySelector('[aria-live="polite"]')!;
    expect(region.textContent).toBe('A'.repeat(160));
    const segments = [region.textContent ?? ''];
    for (let index = 0; index < 2; index += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(500));
      segments.push(region.textContent ?? '');
    }
    expect(segments.join('')).toBe(answer);
    expect(segments.every((segment) => segment.length <= 160)).toBe(true);
  } finally {
    await view.unmount();
  }
});

it('creates a distinct live-region update for consecutive identical deltas', async () => {
  vi.useFakeTimers();
  const view = await render(<AnnouncementProbe text="" running />);
  try {
    const repeated = 'Same segment. '.repeat(10) + 'Same';
    await view.rerender(<AnnouncementProbe text={repeated} running />);
    const firstSegment = view.container.querySelector('[aria-live] span')!;
    expect(firstSegment.textContent).toBe(repeated);
    await view.rerender(
      <AnnouncementProbe text={repeated + repeated} running />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(500));
    const secondSegment = view.container.querySelector('[aria-live] span')!;
    expect(secondSegment.textContent).toBe(repeated);
    expect(secondSegment).not.toBe(firstSegment);
  } finally {
    await view.unmount();
  }
});

it('does not split a Unicode code point across announcement segments', async () => {
  vi.useFakeTimers();
  const view = await render(<AnnouncementProbe text="" running />);
  try {
    const answer = `${'A'.repeat(159)}💼Tail`;
    await view.rerender(<AnnouncementProbe text={answer} running />);
    const region = view.container.querySelector('[aria-live="polite"]')!;
    const firstSegment = region.textContent ?? '';
    const segments = [firstSegment];
    expect(Array.from(firstSegment).length).toBeLessThanOrEqual(160);
    expect(isWellFormedUnicode(firstSegment)).toBe(true);
    expect(firstSegment).not.toContain('\uFFFD');
    await act(async () => vi.advanceTimersByTimeAsync(500));
    segments.push(region.textContent ?? '');
    expect(segments.join('')).toBe(answer);
    expect(segments.some((segment) => segment.includes('\uFFFD'))).toBe(false);
    expect(segments.every(isWellFormedUnicode)).toBe(true);
  } finally {
    await view.unmount();
  }
});

it('announces text received with completion and keeps the region until queued text drains', async () => {
  vi.useFakeTimers();
  const view = await render(<AnnouncementProbe text="" running />);
  try {
    const answer = 'Final answer. '.repeat(30);
    await view.rerender(<AnnouncementProbe text={answer} running={false} />);
    let region = view.container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe(answer.slice(0, 160));
    const segments = [region?.textContent ?? ''];
    await act(async () => vi.advanceTimersByTimeAsync(500));
    region = view.container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toBe(answer.slice(160, 320));
    segments.push(region?.textContent ?? '');
    await act(async () => vi.advanceTimersByTimeAsync(500));
    region = view.container.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toBe(answer.slice(320));
    segments.push(region?.textContent ?? '');
    expect(segments.join('')).toBe(answer);
    expect(region).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(view.container.querySelector('[aria-live="polite"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});

it('does not announce loaded history, but announces text appended after a live mount', async () => {
  vi.useFakeTimers();
  const history = 'Previously streamed answer.';
  const view = await render(
    <AnnouncementProbe text={history} running initialTextIsNew={false} />,
  );
  try {
    const region = view.container.querySelector('[aria-live="polite"]')!;
    expect(region.textContent).toBe('');
    await view.rerender(
      <AnnouncementProbe
        text={`${history} New live text.`}
        running
        initialTextIsNew={false}
      />,
    );
    expect(region.textContent).toBe(' New live text.');
  } finally {
    await view.unmount();
  }
});

it('announces the first text prefix when a new live message mounts with text', async () => {
  vi.useFakeTimers();
  const prefix = 'The first live answer chunk.';
  const view = await render(
    <AnnouncementProbe text={prefix} running initialTextIsNew />,
  );
  try {
    expect(
      view.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe(prefix);
    await view.rerender(
      <AnnouncementProbe
        text={`${prefix} Second live chunk.`}
        running
        initialTextIsNew={false}
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(
      view.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe(' Second live chunk.');
  } finally {
    await view.unmount();
  }
});

it('clears its single pending timer when the message unmounts', async () => {
  vi.useFakeTimers();
  const view = await render(<AnnouncementProbe text="" running />);
  await view.rerender(<AnnouncementProbe text={'A'.repeat(400)} running />);
  expect(vi.getTimerCount()).toBe(1);
  await view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('discards pending text and timers when the selected message changes', async () => {
  vi.useFakeTimers();
  const view = await render(
    <AnnouncementProbe messageId="answer-a" text="" running />,
  );
  try {
    await view.rerender(
      <AnnouncementProbe messageId="answer-a" text={'A'.repeat(320)} running />,
    );
    expect(vi.getTimerCount()).toBe(1);
    await view.rerender(
      <AnnouncementProbe messageId="answer-b" text="Loaded answer B" running />,
    );
    const region = view.container.querySelector('[aria-live="polite"]')!;
    expect(region.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    await view.rerender(
      <AnnouncementProbe
        messageId="answer-b"
        text="Loaded answer B plus new text"
        running
      />,
    );
    expect(region.textContent).toBe(' plus new text');
  } finally {
    await view.unmount();
  }
});

for (const timerState of ['pending', 'drained'] as const) {
  it(`rebases the cursor after same-message content resets with a ${timerState} timer`, async () => {
    vi.useFakeTimers();
    const view = await render(
      <AnnouncementProbe messageId="same-answer" text="" running />,
    );
    try {
      await view.rerender(
        <AnnouncementProbe messageId="same-answer" text="Old answer" running />,
      );
      expect(
        view.container.querySelector('[aria-live="polite"]')?.textContent,
      ).toBe('Old answer');
      if (timerState === 'drained')
        await act(async () => vi.advanceTimersByTimeAsync(500));
      else expect(vi.getTimerCount()).toBe(1);

      await view.rerender(
        <AnnouncementProbe messageId="same-answer" text="" running />,
      );
      expect(
        view.container.querySelector('[aria-live="polite"]')?.textContent,
      ).toBe('');
      expect(vi.getTimerCount()).toBe(0);
      await view.rerender(
        <AnnouncementProbe
          messageId="same-answer"
          text="New"
          running={false}
        />,
      );
      expect(
        view.container.querySelector('[aria-live="polite"]')?.textContent,
      ).toBe('New');
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(view.container.querySelector('[aria-live="polite"]')).toBeNull();
    } finally {
      await view.unmount();
    }
  });
}

it('rebases when same-message replacement text has a different prefix and is longer', async () => {
  vi.useFakeTimers();
  const view = await render(
    <AnnouncementProbe messageId="same-answer" text="" running />,
  );
  try {
    await view.rerender(
      <AnnouncementProbe messageId="same-answer" text="Old answer" running />,
    );
    await view.rerender(
      <AnnouncementProbe
        messageId="same-answer"
        text="Replacement answer is longer"
        running={false}
      />,
    );
    expect(
      view.container.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe('Replacement answer is longer');
  } finally {
    await view.unmount();
  }
});
