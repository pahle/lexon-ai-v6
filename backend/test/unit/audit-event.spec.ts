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

test('security audits contain only the verified actor, session IDs and a closed action', () => {
  const security = {
    version: 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: 'identity.security_changed.v1',
    outcome: 'success',
    subjectUserId: randomUUID(),
    actorUserId: randomUUID(),
    sessionId: randomUUID(),
    metadata: { action: 'mfa_verified' },
  };
  expect(AuditEventSchema.safeParse(security).success).toBe(true);
  for (const metadata of [
    { action: 'unknown' },
    { action: 'mfa_verified', code: '123456' },
    { action: 'mfa_verified', secret: 'private' },
    { action: 'mfa_verified', backupCodes: ['private'] },
  ])
    expect(AuditEventSchema.safeParse({ ...security, metadata }).success).toBe(
      false,
    );
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

test('departure audit accepts fixed reasons and rejects recipient email metadata', () => {
  const departure = {
    version: 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: 'organization.member_departed.v1',
    outcome: 'success',
    actorUserId: randomUUID(),
    subjectUserId: randomUUID(),
    orgId: randomUUID(),
    memberId: randomUUID(),
    metadata: { reason: 'leave' },
  };
  expect(AuditEventSchema.safeParse(departure).success).toBe(true);
  expect(
    AuditEventSchema.safeParse({
      ...departure,
      metadata: { reason: 'leave', email: 'private@example.test' },
    }).success,
  ).toBe(false);
});

test('session lifecycle audit metadata cannot contain Bearer tokens', () => {
  const event = {
    version: 1,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    type: 'identity.session_changed.v1',
    outcome: 'success',
    actorUserId: randomUUID(),
    subjectUserId: randomUUID(),
    sessionId: randomUUID(),
    metadata: { action: 'bearer_issued' },
  };
  expect(AuditEventSchema.safeParse(event).success).toBe(true);
  expect(
    AuditEventSchema.safeParse({
      ...event,
      metadata: { ...event.metadata, token: 'secret' },
    }).success,
  ).toBe(false);
});
