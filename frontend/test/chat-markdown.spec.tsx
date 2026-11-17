import { expect, it, vi } from 'vitest';
import {
  AnswerDimmedContext,
  MarkdownText,
} from '../src/components/chat/markdown-text.js';
import markdownSource from '../src/components/chat/markdown-text.tsx?raw';
import { render } from './render.js';

it('drops unsafe HTML, javascript links, and remote images without fetching them', async () => {
  const requests = vi.spyOn(globalThis, 'fetch');
  const view = await render(
    <MarkdownText
      source={
        'Safe text\n\n![remote image](https://remote.invalid/pixel)\n\n<img src="https://remote.invalid/html-pixel"><script>run()</script> [open](javascript:alert(1))'
      }
    />,
  );
  try {
    expect(view.container.querySelector('script, img')).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(view.container.textContent).toContain('Safe text');
    expect(requests).not.toHaveBeenCalled();
  } finally {
    requests.mockRestore();
    await view.unmount();
  }
});

it('keeps heading hierarchy and visible ordered and unordered list markers', async () => {
  const view = await render(
    <MarkdownText
      source={
        '# Liability review\n\n## Allocation\n\n### Exceptions\n\n- Cap damages\n- Exclude indirect loss\n\n1. Define a cap\n2. Narrow exceptions'
      }
    />,
  );
  try {
    for (const heading of view.container.querySelectorAll('h1, h2, h3')) {
      expect(heading.className).toContain('font-semibold');
      expect(heading.className).not.toContain('font-serif');
      expect(heading.className).toContain('font-sans');
    }
    expect(view.container.querySelector('ul')?.className).toContain(
      'list-disc',
    );
    expect(view.container.querySelector('ol')?.className).toContain(
      'list-decimal',
    );
  } finally {
    await view.unmount();
  }
});

it('renders strong text as semibold', async () => {
  const view = await render(<MarkdownText source={'A **key term** here'} />);
  try {
    expect(view.container.querySelector('strong')?.className).toContain(
      'font-semibold',
    );
  } finally {
    await view.unmount();
  }
});

const dimmedSource =
  '## Heading\n\nA **key term** and [a link](https://example.com).\n\n- First item\n\n1. Second item';

it('mutes bold text, headings, list markers, and links while the answer is dimmed', async () => {
  const view = await render(
    <AnswerDimmedContext.Provider value={true}>
      <MarkdownText source={dimmedSource} />
    </AnswerDimmedContext.Provider>,
  );
  try {
    const root = view.container;
    expect(root.querySelector('strong')?.className).toContain(
      'text-muted-foreground',
    );
    expect(root.querySelector('h2')?.className).toContain(
      'text-muted-foreground',
    );
    expect(root.querySelector('a')?.className).toContain(
      'text-muted-foreground',
    );
    const items = root.querySelectorAll('li');
    expect(items).toHaveLength(2);
    for (const item of items)
      expect(item.className).toContain('marker:text-muted-foreground');
  } finally {
    await view.unmount();
  }
});

it('leaves bold text, headings, list markers, and links unchanged when the answer is not dimmed', async () => {
  const view = await render(<MarkdownText source={dimmedSource} />);
  try {
    expect(view.container.innerHTML).not.toContain('text-muted-foreground');
    expect(view.container.innerHTML).not.toContain('marker:');
  } finally {
    await view.unmount();
  }
});

it('renders ordered lists, unordered lists, and bold text with the exact baseline classes when not dimmed', async () => {
  const view = await render(
    <MarkdownText source={'- Bullet\n\n1. Number\n\nA **bold** word'} />,
  );
  try {
    const root = view.container;
    expect(root.querySelector('ul')?.className).toBe(
      'my-3 ms-6 list-disc space-y-1',
    );
    expect(root.querySelector('ol')?.className).toBe(
      'my-3 ms-6 list-decimal space-y-1',
    );
    for (const item of root.querySelectorAll('li'))
      expect(item.className).toBe('ps-1');
    expect(root.querySelector('strong')?.className).toBe('font-semibold');
  } finally {
    await view.unmount();
  }
});

// Tailwind finds utilities by scanning source text, so a class glued to a
// template interpolation (for example `ps-1${muted}`) is never generated.
it('keeps every Markdown utility class a complete literal token in the source', async () => {
  // The wrapper class line is unchanged since the baseline and is excluded.
  const source = markdownSource
    .split('\n')
    .filter((line) => !line.includes('const wrapperClass'))
    .join('\n');
  expect(source).not.toMatch(/[\w:-]\$\{/);
  for (const token of ['ps-1', 'font-semibold', 'underline-offset-2'])
    expect(source).toMatch(new RegExp(`['"\\s]${token}['"\\s]`));
});
