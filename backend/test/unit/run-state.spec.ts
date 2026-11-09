import { describe, expect, it } from 'vitest';
import { canTransition } from '../../src/modules/chat/run-state.js';

describe('run state', () => {
  it('legal transition matrix', () => {
    const statuses = [
      'queued',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ] as const;
    const legal: ReadonlyArray<readonly [string, string]> = [
      ['queued', 'running'],
      ['queued', 'cancelling'],
      ['running', 'running'],
      ['running', 'awaiting_approval'],
      ['running', 'completed'],
      ['running', 'failed'],
      ['running', 'cancelling'],
      ['awaiting_approval', 'running'],
      ['awaiting_approval', 'failed'],
      ['awaiting_approval', 'cancelling'],
      ['cancelling', 'cancelled'],
    ];

    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransition(from, to)).toBe(
          legal.some(
            ([legalFrom, legalTo]) => legalFrom === from && legalTo === to,
          ),
        );
      }
    }
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('running', 'awaiting_approval')).toBe(true);
  });
});
