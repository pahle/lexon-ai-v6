import type { AttemptRecord } from '../../infrastructure/db/index.js';

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sumTokens(inputTokens: number, outputTokens: number): number {
  if (
    !safeNonnegativeInteger(inputTokens) ||
    !safeNonnegativeInteger(outputTokens)
  )
    throw new Error('Invalid reported token usage');
  const total = inputTokens + outputTokens;
  if (!Number.isSafeInteger(total)) throw new Error('Token ledger overflow');
  return total;
}

export function reservationTokens(
  inputTokens: number,
  outputTokens: number,
): number {
  if (
    !safeNonnegativeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 1
  )
    throw new Error('Invalid token reservation');
  return sumTokens(inputTokens, outputTokens);
}

function recordedTokens(attempt: AttemptRecord): number {
  if (
    attempt.active ||
    attempt.outcome === 'unknown' ||
    attempt.outcome === null
  )
    return reservationTokens(
      attempt.reservedInputTokens,
      attempt.reservedOutputTokens,
    );
  const input = attempt.reportedInputTokens ?? attempt.reservedInputTokens;
  const output = attempt.reportedOutputTokens ?? attempt.reservedOutputTokens;
  return sumTokens(input, output);
}

export function isOverReservation(attempt: AttemptRecord): boolean {
  if (
    attempt.active ||
    attempt.outcome === null ||
    attempt.outcome === 'unknown'
  )
    return false;
  return (
    recordedTokens(attempt) >
    sumTokens(attempt.reservedInputTokens, attempt.reservedOutputTokens)
  );
}

export function remainingBudgetTokens(
  tokenBudget: number,
  attempts: readonly AttemptRecord[],
): number {
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1)
    throw new Error('Invalid token budget');
  let used = 0;
  for (const attempt of attempts) {
    used += recordedTokens(attempt);
    if (!Number.isSafeInteger(used)) throw new Error('Token ledger overflow');
  }
  return tokenBudget - used;
}
