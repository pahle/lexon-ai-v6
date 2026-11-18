import { afterEach, expect, test, vi } from 'vitest';
import { act, useRef, useState } from 'react';
import { render } from './render';
import {
  STARTER_TEMPLATES,
  firstPlaceholderRange,
  insertTemplate,
} from '../src/lib/starter-templates';
import { StarterPills } from '../src/components/chat/starter-pills';

afterEach(() => vi.unstubAllGlobals());

const check = STARTER_TEMPLATES[2]!.template;

test('the four approved templates are in order', () => {
  expect(STARTER_TEMPLATES.map((item) => item.label)).toEqual([
    'Explain an article',
    'Compare two rules',
    'Check a clause',
    'Summarize a regulation',
  ]);
  expect(STARTER_TEMPLATES.map((item) => item.template)).toEqual([
    'Explain Article [number] of [law or regulation] in plain language.',
    'Compare [first rule] with [second rule] and list the differences that matter in practice.',
    'Check this clause for risks and missing terms: [paste clause]',
    'Summarize [regulation], including who it applies to and the key obligations.',
  ]);
});

test('firstPlaceholderRange finds the first bracketed span', () => {
  expect(firstPlaceholderRange('Explain Article [number] of [law]')).toEqual({
    start: 16,
    end: 24,
  });
  expect(
    firstPlaceholderRange('Explain Article [number] of [law]', 24),
  ).toEqual({ start: 28, end: 33 });
  expect(firstPlaceholderRange('no brackets')).toBeNull();
  expect(firstPlaceholderRange('open [bracket')).toBeNull();
});

test('insertTemplate selects the first placeholder and appends on a new line', () => {
  const t = 'Explain Article [number] of [law]';
  expect(insertTemplate('', t)).toEqual({
    text: t,
    selection: { start: 16, end: 24 },
  });
  expect(insertTemplate('  \n ', t)).toEqual({
    text: t,
    selection: { start: 16, end: 24 },
  });
  expect(insertTemplate('Draft', t)).toEqual({
    text: `Draft\n${t}`,
    selection: { start: 22, end: 30 },
  });
  expect(insertTemplate('', 'No placeholder.')).toEqual({
    text: 'No placeholder.',
    selection: null,
  });
});

function Harness({
  sending = false,
  onSend,
  initial = '',
}: {
  sending?: boolean;
  onSend: () => void;
  initial?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  return (
    <form onSubmit={onSend}>
      <textarea
        ref={ref}
        aria-label="Message input"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <StarterPills
        textareaRef={ref}
        value={text}
        onValueChange={setText}
        disabled={sending}
      />
    </form>
  );
}

test('renders four buttons in one labelled group with no visible label', async () => {
  const view = await render(<Harness onSend={vi.fn()} />);
  const group = view.container.querySelector('[role="group"]')!;
  expect(group.getAttribute('aria-label')).toBe('Starter prompts');
  const buttons = [...group.querySelectorAll('button')];
  expect(buttons.map((button) => button.textContent)).toEqual(
    STARTER_TEMPLATES.map((item) => item.label),
  );
  expect(buttons.every((button) => button.type === 'button')).toBe(true);
  expect(group.textContent).toBe(
    STARTER_TEMPLATES.map((item) => item.label).join(''),
  );
  await view.unmount();
});

test('clicking a pill inserts the template, focuses, and selects the placeholder', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const onSend = vi.fn();
  const view = await render(<Harness onSend={onSend} />);
  const textarea = view.container.querySelector('textarea')!;
  const pill = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Check a clause',
  )!;
  await act(async () => pill.click());
  expect(textarea.value).toBe(check);
  expect(document.activeElement).toBe(textarea);
  const start = check.indexOf('[paste clause]');
  expect(textarea.selectionStart).toBe(start);
  expect(textarea.selectionEnd).toBe(start + '[paste clause]'.length);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  await view.unmount();
});

test('a pill appends on a new line when the composer has text', async () => {
  const view = await render(<Harness onSend={vi.fn()} initial="Draft" />);
  const textarea = view.container.querySelector('textarea')!;
  const pill = [...view.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Check a clause',
  )!;
  await act(async () => pill.click());
  expect(textarea.value).toBe(`Draft\n${check}`);
  expect(textarea.selectionStart).toBe(6 + check.indexOf('[paste clause]'));
  await view.unmount();
});

test('pills are keyboard-activatable buttons and disabled while sending', async () => {
  const view = await render(<Harness onSend={vi.fn()} />);
  const buttons = [...view.container.querySelectorAll('button')];
  expect(buttons.every((button) => button.type !== 'submit')).toBe(true);
  expect(buttons.every((button) => button.tabIndex >= 0)).toBe(true);
  // Native buttons activate on Enter and Space (click) with no key handlers.
  await view.unmount();
  const busy = await render(<Harness sending onSend={vi.fn()} />);
  expect(
    [...busy.container.querySelectorAll('button')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  await busy.unmount();
});

test('the chosen pill shows a foreground border on muted and is pressed', async () => {
  const view = await render(<Harness onSend={vi.fn()} />);
  const find = (label: string) =>
    [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === label,
    )!;
  expect(find('Check a clause').getAttribute('aria-pressed')).toBe('false');
  await act(async () => find('Check a clause').click());
  const chosen = find('Check a clause');
  expect(chosen.getAttribute('aria-pressed')).toBe('true');
  expect(chosen.className).toContain('border-foreground');
  expect(chosen.className).toContain('bg-muted');
  expect(find('Explain an article').getAttribute('aria-pressed')).toBe('false');
  expect(find('Explain an article').className).toContain('border-border');
  await view.unmount();
});

test('pills are 14px, padded 8px 14px, fully round, 8px apart, in one row', async () => {
  const view = await render(<Harness onSend={vi.fn()} />);
  const group = view.container.querySelector('[role="group"]')!;
  expect(group.className).toContain('gap-2');
  expect(group.className).toContain('flex-nowrap');
  expect(group.className).toContain('max-md:flex-wrap');
  const pill = group.querySelector('button')!;
  for (const token of ['rounded-full', 'text-sm', 'px-3.5', 'py-2'])
    expect(pill.className).toContain(token);
  await view.unmount();
});
