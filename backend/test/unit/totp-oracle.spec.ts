import { expect, test } from 'vitest';
import { totp } from '../setup/totp.js';

test('test-only TOTP oracle matches RFC6238 SHA1 published vectors', () => {
  const secret = Buffer.from('12345678901234567890');
  for (const [seconds, code] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)
    expect(totp(secret, seconds * 1000, 8)).toBe(code);
});
