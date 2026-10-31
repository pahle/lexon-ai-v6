import { expect, it } from 'vitest';
import {
  parseJobEnvelope,
  type JobEnvelope,
} from '../../src/modules/platform/index.js';
const valid: JobEnvelope = {
  outboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  type: 'platform.noop.v1',
  ctx: {
    orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  },
  payload: { probeId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002' },
};
it('validates a detached deeply immutable metadata envelope', () => {
  const input = structuredClone(valid);
  const job = parseJobEnvelope(input);
  expect(job).toEqual(valid);
  expect(job).not.toBe(input);
  expect(job.ctx).not.toBe(input.ctx);
  expect(job.payload).not.toBe(input.payload);
  expect(Object.isFrozen(job)).toBe(true);
  expect(Object.isFrozen(job.ctx)).toBe(true);
  expect(Object.isFrozen(job.payload)).toBe(true);
  expect(() => Object.assign(job.payload, { probeId: 'modified' })).toThrow(
    TypeError,
  );
  expect(
    Object.hasOwn(
      parseJobEnvelope({ ...valid, ctx: { orgId: valid.ctx.orgId } }).ctx,
      'userId',
    ),
  ).toBe(false);
  expect(
    parseJobEnvelope({ ...valid, ctx: { orgId: valid.ctx.orgId } }).ctx,
  ).toEqual({ orgId: valid.ctx.orgId });
});
it('rejects every invalid ID/type/payload/context without echoing values', () => {
  const invalid = [
    null,
    {},
    { ...valid, outboxId: 'secret-invalid' },
    { ...valid, type: 'other.v1' },
    { ...valid, ctx: { orgId: 'secret-org' } },
    { ...valid, ctx: { ...valid.ctx, userId: 'secret-user' } },
    { ...valid, payload: { probeId: 'secret-probe' } },
    { ...valid, payload: { ...valid.payload, document: 'secret' } },
    { ...valid, ctx: { ...valid.ctx, secret: 'secret' } },
    { ...valid, unexpected: 'secret' },
  ];
  for (const value of invalid)
    expect(() => parseJobEnvelope(value)).toThrow(/^Invalid job envelope$/);
});
