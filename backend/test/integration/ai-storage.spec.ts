import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';

test('cross-tenant child foreign keys reject a run from another organization', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await expect(ai.insertCrossTenantStep(1, run.id)).rejects.toThrow();
  } finally {
    await ai.close();
  }
});

test('fresh and reused no-context queries return no AI rows', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await ai.start(0);
    expect(await ai.noContextCounts()).toEqual([0, 0]);
  } finally {
    await ai.close();
  }
});

test('an expired takeover keeps the envelope version, fences its old owner, and marks only active attempts unknown', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const originalClaim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: true,
    });
    const takeover = await ai.claim(0, run.id, 1, 1, 1);
    expect(takeover).not.toBeNull();
    expect(takeover?.fence).toBeGreaterThan(originalClaim.fence);
    expect(await ai.activeAttemptOutcomes(0, run.id)).toEqual([
      'succeeded',
      'unknown',
    ]);
    expect(await ai.oldClaimCanWrite(originalClaim)).toEqual({
      renew: false,
      metadata: false,
      checkpoint: false,
      settle: false,
      commit: false,
    });
    expect(await ai.runVersion(0, run.id)).toBe(1);
  } finally {
    await ai.close();
  }
});

test('attempt metadata, checkpoint, reported usage, and step commit persist under the active fence', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    const result = await ai.persistAttemptLifecycle(0, claim);
    expect(result).toMatchObject({
      metadata: true,
      renewed: true,
      checkpoint: true,
      settled: true,
      committed: true,
      attempt: {
        estimatedInputTokens: 20,
        reservedInputTokens: 21,
        reservedOutputTokens: 10,
        generationId: 'generation-1',
        provider: 'synthetic-provider',
        reportedInputTokens: 17,
        reportedOutputTokens: 9,
        cachedInputTokens: 2,
        reasoningOutputTokens: 3,
        costUsd: '0.0010000000',
        active: false,
        outcome: 'succeeded',
      },
    });
  } finally {
    await ai.close();
  }
});

test('an in-flight attempt insert blocks takeover until the row can be swept', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    const result = await ai.insertWhileTakeoverWaits(0, claim);
    expect(result.writerRetainedRunLock).toBe(true);
    expect(result.takeoverFence).toBeGreaterThan(claim.fence);
    expect(
      result.attempts.map((attempt) => [attempt.active, attempt.outcome]),
    ).toEqual([[false, 'unknown']]);
  } finally {
    await ai.close();
  }
});

test('an in-flight checkpoint blocks takeover until its transaction completes', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    const result = await ai.checkpointWhileTakeoverWaits(0, claim);
    expect(result.writerRetainedRunLock).toBe(true);
    expect(result.takeoverFence).toBeGreaterThan(claim.fence);
    expect(result.checkpointCount).toBe(1);
  } finally {
    await ai.close();
  }
});

test('a terminal run transition waits for an in-flight step commit before changing version', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    const result = await ai.commitWhileTransitionWaits(0, run.id, claim);
    expect(result.commitRetainedRunLock).toBe(true);
    expect(result.transitioned).toBe(true);
    expect(result.runVersion).toBe(2);
  } finally {
    await ai.close();
  }
});

test('a retry attempt replaces the prior settled attempt checkpoint under the same claim', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    const claim = await ai.seedClaimableStep(0, run.id, {
      activeAttempt: false,
    });
    expect(await ai.checkpointRetry(0, claim)).toBe(true);
  } finally {
    await ai.close();
  }
});
