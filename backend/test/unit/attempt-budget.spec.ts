import { expect, test } from 'vitest';
import type { AttemptRecord } from '../../src/infrastructure/db/index.js';
import {
  isOverReservation,
  remainingBudgetTokens,
  reservationTokens,
} from '../../src/modules/usage/attempt-budget.js';

const attempt = (changes: Partial<AttemptRecord> = {}): AttemptRecord => ({
  attemptId: '00000000-0000-4000-8000-000000000001',
  orgId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003',
  stepId: '00000000-0000-4000-8000-000000000004',
  ordinal: 1,
  modelId: 'synthetic/model',
  estimatorVersion: 'utf8-v1',
  estimatedInputTokens: 100,
  reservedInputTokens: 100,
  reservedOutputTokens: 40,
  generationId: null,
  provider: null,
  reportedInputTokens: null,
  reportedOutputTokens: null,
  cachedInputTokens: null,
  reasoningOutputTokens: null,
  costUsd: null,
  active: true,
  outcome: null,
  createdAt: new Date(0),
  settledAt: null,
  ...changes,
});

test('reserves estimated input and enforced output as one integer amount', () => {
  expect(reservationTokens(100, 40)).toBe(140);
  expect(() => reservationTokens(Number.MAX_SAFE_INTEGER, 1)).toThrow();
});

test('keeps both reserved components for active and unknown attempts', () => {
  expect(
    remainingBudgetTokens(1000, [
      attempt(),
      attempt({
        attemptId: '00000000-0000-4000-8000-000000000005',
        active: false,
        outcome: 'unknown',
        reportedInputTokens: 4,
        reportedOutputTokens: 3,
      }),
    ]),
  ).toBe(720);
});

test('partial reported usage replaces only its reported component', () => {
  expect(
    remainingBudgetTokens(1000, [
      attempt({
        active: false,
        outcome: 'failed',
        reportedInputTokens: 17,
        reportedOutputTokens: null,
      }),
    ]),
  ).toBe(943);
});

test('reported usage replaces both reserve components and detects an overrun', () => {
  const settled = attempt({
    active: false,
    outcome: 'succeeded',
    reportedInputTokens: 17,
    reportedOutputTokens: 9,
  });
  expect(remainingBudgetTokens(1000, [settled])).toBe(974);
  expect(isOverReservation(settled)).toBe(false);
  expect(
    isOverReservation({
      ...settled,
      reportedInputTokens: 101,
      reportedOutputTokens: 40,
    }),
  ).toBe(true);
});

test('unknown retains its reserve while reported usage can still exceed it', () => {
  const unknown = attempt({
    active: false,
    outcome: 'unknown',
    reportedInputTokens: 1000,
    reportedOutputTokens: 1000,
  });
  expect(remainingBudgetTokens(1000, [unknown])).toBe(860);
  expect(isOverReservation(unknown)).toBe(true);
});
