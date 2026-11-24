import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { emailLimitKey } from '../../src/modules/identity-access/auth-http.js';
import { AccountService } from '../../src/modules/identity-access/account.service.js';
import type { AuthCommandSession } from '../../src/infrastructure/db/index.js';

// Characterisation pins (F4.4 task 6): the three ad-hoc
// `.trim().toLowerCase()` call sites in account.service.ts and auth-http.ts
// normalize an email to its canonical form — identical to normalizeEmail().
const secret = 's'.repeat(64);

function recordingSession(returning: (name: string) => unknown) {
  const bodies: Record<string, unknown>[] = [];
  const tx = {
    call: async (name: string, args?: { body?: Record<string, unknown> }) => {
      bodies.push(args?.body ?? {});
      return returning(name);
    },
  };
  return { tx: tx as unknown as AuthCommandSession, bodies };
}

test('emailLimitKey hashes the canonical form of the email', () => {
  expect(emailLimitKey(secret, '  A@B.Com ')).toBe(
    emailLimitKey(secret, 'a@b.com'),
  );
  expect(emailLimitKey(secret, '  A@B.Com ')).not.toBe(
    emailLimitKey(secret, 'other@b.com'),
  );
});

test('prepareOperation sends the canonical email in operation facts', async () => {
  const { tx, bodies } = recordingSession((name) =>
    name === 'getSession' ? null : { userId: randomUUID() },
  );
  const service = new AccountService({} as never, { openSignup: false });
  await service.prepareOperation(
    tx,
    '/change-email',
    { email: '  A@B.Com ' },
    new Headers(),
  );
  expect(bodies[1]?.['email']).toBe('a@b.com');
});

test('recordFailedSignIn sends the canonical email in operation facts', async () => {
  const { tx, bodies } = recordingSession(() => ({ userId: randomUUID() }));
  const integration = {
    transaction: async <T>(work: (tx: AuthCommandSession) => Promise<T>) =>
      work(tx),
  };
  const service = new AccountService(integration as never, {
    openSignup: false,
    audit: { secret, keyId: 'audit-key-1' },
  });
  // appendAuthAuditRecord rejects on the unregistered session double; the
  // facts call has already been recorded by then.
  await expect(service.recordFailedSignIn('  A@B.Com ')).rejects.toThrow(
    'Auth command session expired',
  );
  expect(bodies[0]?.['email']).toBe('a@b.com');
});
