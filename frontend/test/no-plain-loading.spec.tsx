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
      // The composer line (LEX-DS-001 v3.2 §5.5, revision 15) is the one
      // visible loading line: a muted status under the skeleton rows.
      if (path.endsWith('components/chat/composer-reason.tsx')) return;
      offenders.push(
        `${path.replace('../src/', '')}:${index + 1}: ${line.trim()}`,
      );
    });
  expect(offenders).toEqual([]);
});

test('the shared LoadingState default shows no visible text', async () => {
  const view = await render(createElement(LoadingState, {}));
  const status = view.container.querySelector('[role="status"]');
  const visible = [...(status?.childNodes ?? [])].filter(
    (node) =>
      !(node as Element).classList?.contains('sr-only') &&
      node.textContent?.trim(),
  );
  expect(visible).toEqual([]);
  await view.unmount();
});

test('loading shows skeleton rows with an sr-only accessible name, no visible text', async () => {
  const view = await render(
    createElement(LoadingState, { message: 'Loading profile' }),
  );
  const status = view.container.querySelector('[role="status"]');
  expect(
    status?.querySelectorAll('[data-slot="skeleton"]').length,
  ).toBeGreaterThan(3);
  const label = status?.querySelector('.sr-only');
  expect(label?.textContent).toBe('Loading profile');
  const visible = [...(status?.childNodes ?? [])].filter(
    (node) => node !== label && node.textContent?.trim(),
  );
  expect(visible).toEqual([]);
  await view.unmount();
});
