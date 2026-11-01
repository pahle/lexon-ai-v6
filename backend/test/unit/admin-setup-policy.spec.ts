import { expect, test } from 'vitest';
import {
  decideAdminSetup,
  parseAdminSetupArgs,
} from '../../src/modules/identity-access/admin-setup-policy.js';
test('initial setup is serialized and repeats preserve a pending setup', () => {
  const input = {
    email: 'first@example.test',
    additional: false,
    adminExists: false,
    pendingInitialEmail: null as string | null,
    existingPending: false,
  };
  expect(decideAdminSetup(input)).toBe('created');
  expect(
    decideAdminSetup({
      ...input,
      existingPending: true,
      pendingInitialEmail: input.email,
    }),
  ).toBe('pending');
  expect(
    decideAdminSetup({ ...input, pendingInitialEmail: 'other@example.test' }),
  ).toBe('refused');
  expect(decideAdminSetup({ ...input, adminExists: true })).toBe('refused');
  expect(
    decideAdminSetup({ ...input, additional: true, adminExists: true }),
  ).toBe('created');
  expect(
    decideAdminSetup({
      ...input,
      additional: true,
      adminExists: true,
      existingPending: true,
    }),
  ).toBe('pending');
});
test('operator flags require one valid email and reject ambiguous or unknown arguments safely', () => {
  expect(
    parseAdminSetupArgs(['--email', ' FIRST@example.test ', '--additional']),
  ).toEqual({ email: 'first@example.test', additional: true });
  for (const args of [
    [],
    ['--email'],
    ['--email', 'invalid'],
    ['--email', 'first@example.test', '--email', 'second@example.test'],
    ['--email', 'first@example.test', '--additional', '--additional'],
    ['--email', 'first@example.test', '--role', 'admin'],
  ])
    expect(() => parseAdminSetupArgs(args)).toThrow('Invalid setup arguments');
});
