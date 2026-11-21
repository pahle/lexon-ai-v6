import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAppendGrantInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';

// A-22: only lexon_auth may execute auth.lexon_append_audit.
function event() {
  return {
    eventId: randomUUID(),
    version: 1,
    type: 'identity.sign_in_failed.v1',
    occurredAt: new Date().toISOString(),
    outcome: 'failure',
    metadata: {
      subjectHmac: 'a'.repeat(64),
      keyId: 'test-v1',
      reason: 'invalid_credentials',
    },
  };
}

test('lexon_app cannot execute auth.lexon_append_audit', async ({
  services,
}) => {
  const inspect = createAppendGrantInspector(services);
  try {
    await expect(inspect.appAppend(event())).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await inspect.close();
  }
});

test('lexon_auth append writes one row', async ({ services }) => {
  const inspect = createAppendGrantInspector(services);
  try {
    const value = event();
    await inspect.authAppend(value);
    expect(await inspect.storedEventIds(value.eventId)).toEqual([
      value.eventId,
    ]);
  } finally {
    await inspect.close();
  }
});

test('routine_privileges for lexon_append_audit lists only lexon_auth', async ({
  services,
}) => {
  const inspect = createAppendGrantInspector(services);
  try {
    expect(await inspect.executeGrantees()).toEqual(['lexon_auth']);
  } finally {
    await inspect.close();
  }
});
