import { act } from 'react';
import { expect, it } from 'vitest';
import { PersistedReasoning } from '../src/components/chat/chat-reasoning.js';
import { render } from './render.js';

it('shows persisted summary and measured duration, with no invented timing when duration is absent', async () => {
  const view = await render(
    <PersistedReasoning
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
      summary="The clause allocates liability."
      durationMs={2_300}
      answerHasText={false}
      running
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
      summary={null}
      durationMs={2_300}
      answerHasText
      running
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
    <PersistedReasoning summary={null} durationMs={2_300} answerHasText />,
  );
  try {
    expect(view.container.textContent).toContain('Thought for 2 seconds');
    expect(view.container.querySelector('button')).toBeNull();
    expect(view.container.textContent).not.toContain('summary');
  } finally {
    await view.unmount();
  }
});
