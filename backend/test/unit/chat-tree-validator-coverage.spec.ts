import { expect, it } from 'vitest';
import {
  TREE_SELECTED_COLUMNS,
  VALIDATOR_INPUTS,
} from '../../src/infrastructure/db/index.js';

// Spec §5 item 15 (coverage guard): every column the tree query selects must
// map to at least one validator input, so adding a tree column without a
// validator input fails here.
it('every tree-selected column has a non-empty validator input entry', () => {
  for (const column of TREE_SELECTED_COLUMNS) {
    expect(
      VALIDATOR_INPUTS[column],
      `missing validator inputs for tree column ${column}`,
    ).toBeDefined();
    expect(VALIDATOR_INPUTS[column]!.length).toBeGreaterThan(0);
  }
});

it('the selected-column list is the literal tree projection', () => {
  expect([...TREE_SELECTED_COLUMNS]).toEqual([
    'id',
    'parent_message_id',
    'role',
    'user_text',
    'effort',
    'run_id',
    'status',
    'assistant_text',
    'reasoning_summary',
    'reasoning_duration_ms',
    'feedback',
    'created_at',
    'viewed_leaf_id',
  ]);
});
