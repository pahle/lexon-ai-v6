import { createElement } from 'react';
import { expect, test } from 'vitest';
import { render } from './render';
import { LoadingState } from '../src/components/states/page-states';

// Guard (LEX-DS-001 §5.1): loading is shown with skeleton rows, or a spinner
// inside the busy control. No page or section renders loading copy such as
// "Loading…". Only aria labels and sr-only text may say "Loading".
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const loadingCopy = /Loading\b[^'"`<>{}\n]{0,40}(…|\.\.\.)|['"`>]Loading['"`<]/;

test('no source renders visible loading copy', () => {
  const offenders: string[] = [];
  for (const [path, text] of Object.entries(sources))
    text.split('\n').forEach((line, index) => {
      if (!loadingCopy.test(line)) return;
      // Assistive-only labels are allowed.
      if (/aria-label=|aria-description|sr-only/.test(line)) return;
      offenders.push(
        `${path.replace('../src/', '')}:${index + 1}: ${line.trim()}`,
      );
    });
  expect(offenders).toEqual([]);
});

test('the shared LoadingState never defaults to plain loading copy', async () => {
  const view = await render(createElement(LoadingState, {}));
  const text = view.container.textContent ?? '';
  expect(text).not.toMatch(/^\s*Loading\b/);
  await view.unmount();
});
