import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
} from '../../src/infrastructure/db/index.js';
import { createRlsInspector } from '../../src/infrastructure/db/testing/rls-fixture.js';

// A-17: every table in the `app` schema is tenant-fenced.
test('every app table has row-level security enabled and forced', async ({
  services,
}) => {
  const inspect = createRlsInspector(services);
  try {
    expect(await inspect.tableCount()).toBeGreaterThan(0);
    expect(await inspect.unfencedTables()).toEqual([]);
  } finally {
    await inspect.close();
  }
});

test('an app connection without the tenant GUC sees no rows in any app table', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const inspect = createRlsInspector(services);
  try {
    // Seed through the fixture (owner-side setup) so the zero counts are not vacuous.
    for (let org = 0; org < 2; org++) await ai.start(org);
    // The owner role has no INSERT policy on ai_steps, so its first row goes
    // through the AI fixture (the application role with a tenant context).
    const runs = await inspect.runIds();
    const claim = await ai.seedClaimableStep(0, runs[0]!, {
      activeAttempt: false,
    });
    await ai.checkpointRetry(0, claim);
    const args = { value: 'seed' };
    await ai.withTenant(0, (tx) =>
      new AiOperationRepository().persist(tx, claim, {
        callOccurrence: 0,
        toolName: 'fixture-write',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash: hashOperationArgs(args),
        snapshotHash: 'a'.repeat(64),
        approvalRequired: false,
      }),
    );
    const unseeded = await inspect.seedEmptyTables({
      chat_deleted_ids: { entity_kind: "'chat'" },
      chat_deletion_work: { phase: "'grace'" },
      chat_mutation_requests: {
        mutation_kind: "'send'",
        chat_id: '(SELECT id FROM app.chats LIMIT 1)',
      },
      chat_messages: {
        role: "'user'",
        user_text: "'seed'",
        effort: "'high'",
        run_id: 'NULL',
      },
      chat_runs: { kind: "'answer'" },
      message_feedback: { rating: "'good'" },
      usage_events: { outcome: "'reserved'" },
    });
    // ai_test_tool_effects is created by the AI fixture itself, not by a
    // migration, so it is not part of the shipped schema.
    delete unseeded['ai_test_tool_effects'];
    expect(unseeded).toEqual({});
    const visibility = await inspect.visibility();
    expect(
      Object.entries(visibility).filter(
        ([table, rows]) =>
          table !== 'ai_test_tool_effects' && rows.withContext === 0,
      ),
    ).toEqual([]);
    expect(
      Object.entries(visibility).filter(([, rows]) => rows.noContext > 0),
    ).toEqual([]);
  } finally {
    await Promise.all([ai.close(), inspect.close()]);
  }
});
