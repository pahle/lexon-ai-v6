import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  AuditEventSchema,
  correlateEmail,
} from '../../src/modules/audit/index.js';

const event = () => ({
  version: 1,
  eventId: randomUUID(),
  type: 'identity.sign_in_failed.v1',
  occurredAt: new Date().toISOString(),
  outcome: 'failure',
  metadata: {
    subjectHmac: 'a'.repeat(64),
    keyId: 'test-v1',
    reason: 'invalid_credentials',
  },
});

test('strict audit schema accepts only versioned events, IDs and event-specific metadata', () => {
  expect(AuditEventSchema.safeParse(event()).success).toBe(true);
  for (const invalid of [
    { ...event(), type: 'unknown.v1' },
    { ...event(), version: 2 },
    { ...event(), eventId: 'bad-id' },
    { ...event(), actorUserId: 'not-a-uuid' },
    { ...event(), occurredAt: 'yesterday' },
    { ...event(), email: 'person@example.test' },
    { ...event(), metadata: { email: 'person@example.test' } },
    { ...event(), metadata: { ip: '127.0.0.1' } },
    {
      ...event(),
      metadata: { url: 'https://example.test/reset?token=secret' },
    },
    { ...event(), metadata: { error: 'secret-sentinel' } },
    { ...event(), metadata: { reason: 'secret-sentinel' } },
    { ...event(), subjectUserId: randomUUID() },
  ])
    expect(AuditEventSchema.safeParse(invalid).success).toBe(false);
});

test('known failed subjects use user IDs and never retain email correlation', () => {
  expect(
    AuditEventSchema.safeParse({
      ...event(),
      subjectUserId: randomUUID(),
      metadata: { reason: 'invalid_credentials' },
    }).success,
  ).toBe(true);
  expect(
    AuditEventSchema.safeParse({
      ...event(),
      metadata: { reason: 'invalid_credentials' },
    }).success,
  ).toBe(false);
});

test('email correlation uses domain-separated keyed SHA256 and safe key identifiers', () => {
  const first = correlateEmail('person@example.test', 'a'.repeat(48), 'key-v1');
  expect(first).toEqual(
    correlateEmail('person@example.test', 'a'.repeat(48), 'key-v1'),
  );
  expect(first.subjectHmac).toMatch(/^[a-f0-9]{64}$/);
  expect(first.subjectHmac).not.toBe(
    correlateEmail('person@example.test', 'b'.repeat(48), 'key-v1').subjectHmac,
  );
  expect(JSON.stringify(first).includes('person@example.test')).toBe(false);
  expect(() =>
    correlateEmail(
      'person@example.test',
      'a'.repeat(48),
      'person@example.test',
    ),
  ).toThrow();
});
