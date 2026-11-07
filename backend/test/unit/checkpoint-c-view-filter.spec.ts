import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseCheckpointCViewFilter } from '../e2e/visual-support.js';

const index = JSON.parse(
  readFileSync(
    new URL('../../../docs/references/F2.1-visual/index.json', import.meta.url),
    'utf8',
  ),
) as { checkpointC: { views: { id: string }[] } };
const indexedViews = index.checkpointC.views.map(({ id }) => id);

describe('Checkpoint C view filter', () => {
  test('rejects an explicitly empty filter instead of writing every capture', () => {
    expect(() => parseCheckpointCViewFilter('', indexedViews)).toThrow(
      'LEXON_CHECKPOINT_C_VIEWS must contain at least one indexed view.',
    );
  });

  test('selects only requested names from the canonical index', () => {
    expect(
      parseCheckpointCViewFilter('sign-in, security, members', indexedViews),
    ).toEqual(new Set(['sign-in', 'security', 'members']));
  });

  test('rejects capture names absent from the canonical index', () => {
    expect(() =>
      parseCheckpointCViewFilter('made-up-view', indexedViews),
    ).toThrow('Unknown Checkpoint C capture view(s): made-up-view');
  });
});
