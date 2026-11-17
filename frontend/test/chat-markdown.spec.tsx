import { expect, it, vi } from 'vitest';
import {
  AnswerDimmedContext,
  MarkdownText,
} from '../src/components/chat/markdown-text.js';
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
