import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createChatApiHarness } from '../setup/chat-api-harness.js';

// F4.4 hardening (spec §5 item 15, B-04): drive the full chat lifecycle —
// send, claim, checkpoint, complete, feedback, edit, leaf, rename, regenerate,
// cancel — and prove every pair of consecutive non-deep-equal trees carries
// different validator tags.

interface Snapshot {
  readonly phase: string;
  readonly status: number;
  readonly tag: string | null;
  readonly tree: unknown;
}

const TAG = /^W\/"v1\.[A-Za-z0-9_-]{30,}"$/;

test('every tree-changing lifecycle write shifts the validator tag', async ({
  services,
}) => {
  const harness = await createChatApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const owner = await harness.client.identity.user('ETag lifecycle owner');
    const identity = (await (
      await harness.client.identity.call('/identity', owner.headers)
    ).json()) as { organization: { id: string } };
    const ctx = { orgId: identity.organization.id, userId: owner.profile.id };

    const snapshots: Snapshot[] = [];
    /** Force a live run terminal so the next send-type route is unblocked. */
    const completeRun = async (runId: string) => {
      const run = await harness.database.withTenant(ctx, (tx) =>
        harness.engine.runs.find(tx, runId),
      );
      expect(
        await harness.database.withTenant(ctx, (tx) =>
          harness.engine.runs.transition(tx, {
            runId,
            expectedVersion: run!.runVersion,
            from: run!.status as 'queued' | 'running',
            to: 'completed',
          }),
        ),
      ).toBe(true);
    };
    const snapshot = async (phase: string) => {
      const response = await harness.client.identity.call(
        `/chats/${chatId}`,
        owner.headers,
      );
      const tag = response.headers.get('etag');
      expect(response.status, `${phase}: read status`).toBe(200);
      expect(tag, `${phase}: tag`).toMatch(TAG);
      const tree = await response.json();
      snapshots.push({ phase, status: response.status, tag, tree });
    };

    // send: the create turn links a queued answer run.
    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const created = await harness.client.identity.call(
      '/chats',
      owner.headers,
      'POST',
      {
        chatId,
        userMessageId,
        requestId: randomUUID(),
        text: 'Lifecycle probe question',
        effort: 'high',
      },
    );
    expect(created.status).toBe(201);
    const mutation = (await created.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    await snapshot('send');

    // claim: the coordinator marks the run running and claims step one.
    const job = harness.jobForAnswer(ctx, mutation.runId);
    const claim = await harness.engine.dispatch(job);
    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') throw new Error('Expected answer claim');
    await snapshot('claim');

    // checkpoint: a durable chunk lands before the commit.
    const attemptId = await harness.client.insertSyntheticAttemptFor(
      ctx,
      claim.claim,
    );
    expect(
      await harness.client.checkpointFor(
        ctx,
        claim.claim,
        attemptId,
        'lifecycle checkpoint chunk',
      ),
    ).toBe(true);
    await snapshot('checkpoint');

    // complete: the step commit lands the text, then the run turns terminal
    // (the chat profile allows further iterations, so commit alone leaves the
    // run running and the answer pointer active).
    expect(
      await harness.engine.coordinator.commit(job, claim.claim, {
        state: 'committed',
        text: 'lifecycle checkpoint chunk',
        data: { outcome: 'succeeded' },
        advancement: 'generation',
      }),
    ).toBe('committed');
    await completeRun(mutation.runId);
    await snapshot('complete');

    // feedback: the rating lands on the answer row.
    const feedback = await harness.client.identity.call(
      `/chats/${chatId}/messages/${mutation.runId}/feedback`,
      owner.headers,
      'PUT',
      { rating: 'good' },
    );
    expect(feedback.status).toBe(204);
    await snapshot('feedback');

    // edit: forking the user turn grows the tree and links a fresh run.
    const edited = await harness.client.identity.call(
      `/chats/${chatId}/messages/${userMessageId}/edit`,
      owner.headers,
      'POST',
      {
        messageId: userMessageId,
        newMessageId: randomUUID(),
        text: 'Lifecycle edited question',
        effort: 'high',
      },
    );
    expect(edited.status).toBe(201);
    const editedMutation = (await edited.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    await snapshot('edit');

    // leaf: point the read marker at the freshest answer.
    const viewed = await harness.client.identity.call(
      `/chats/${chatId}/viewed-leaf`,
      owner.headers,
      'PUT',
      { leafId: editedMutation.assistantMessageId },
    );
    expect(viewed.status).toBe(200);
    await snapshot('leaf');

    // rename: a manual title bumps chats.title and title_version.
    const renamed = await harness.client.identity.call(
      `/chats/${chatId}`,
      owner.headers,
      'PATCH',
      { title: 'Lifecycle renamed' },
    );
    expect(renamed.status).toBe(204);
    await snapshot('rename');

    // regenerate: a new answer row and queued run on the edited branch; the
    // edit's own answer must be terminal first (one active answer per chat).
    await completeRun(editedMutation.runId);
    const regenerated = await harness.client.identity.call(
      `/chats/${chatId}/messages/${editedMutation.assistantMessageId}/regenerate`,
      owner.headers,
      'POST',
      {
        messageId: editedMutation.assistantMessageId,
        requestId: randomUUID(),
      },
    );
    expect(regenerated.status).toBe(201);
    const regenMutation = (await regenerated.json()) as {
      assistantMessageId: string;
      runId: string;
    };
    await snapshot('regenerate');

    // cancel: the queued answer turns terminal and releases the pointer.
    await harness.client.cancelFor(ctx, regenMutation.runId);
    await snapshot('cancel');

    for (let index = 1; index < snapshots.length; index++) {
      const previous = snapshots[index - 1]!;
      const current = snapshots[index]!;
      if (JSON.stringify(previous.tree) === JSON.stringify(current.tree))
        continue;
      expect(
        current.tag,
        `${previous.phase} -> ${current.phase}: changed tree kept tag`,
      ).not.toBe(previous.tag);
    }
    // Acceptance evidence: the phase -> tag table this run produced.
    console.log(
      [
        'etag-lifecycle',
        ...snapshots.map((entry) => `  ${entry.phase}: ${entry.tag}`),
      ].join('\n'),
    );
  } finally {
    await Promise.all([organizations.close(), harness.close()]);
  }
});
