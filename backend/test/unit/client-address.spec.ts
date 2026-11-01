import { expect, test } from 'vitest';
import { resolveClientAddress } from '../../src/modules/identity-access/client-address.js';

test('untrusted peers cannot choose their limit bucket through forwarded headers', () => {
  expect(
    resolveClientAddress(
      '203.0.113.4',
      new Headers({ 'x-forwarded-for': '192.0.2.1' }),
      [],
    ),
  ).toBe('203.0.113.4');
});
test('trusted chains resolve the first untrusted hop from the right', () => {
  expect(
    resolveClientAddress(
      '127.0.0.1',
      new Headers({ 'x-forwarded-for': '198.51.100.8, 203.0.113.4, 10.0.0.2' }),
      ['127.0.0.1', '10.0.0.0/8'],
    ),
  ).toBe('203.0.113.4');
});
test('mapped IPv6 forms normalize to the same IPv4 bucket', () => {
  for (const peer of [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
  ])
    expect(resolveClientAddress(peer, new Headers(), [])).toBe('127.0.0.1');
});
test('invalid trusted chains, hostnames and proxy ranges cannot bypass limits', () => {
  for (const chain of [
    'unknown',
    '192.0.2.1,',
    '127.0.0.1:123',
    'for=192.0.2.1',
  ])
    expect(() =>
      resolveClientAddress(
        '127.0.0.1',
        new Headers({ 'x-forwarded-for': chain }),
        ['127.0.0.1'],
      ),
    ).toThrow();
  expect(() => resolveClientAddress('not-an-ip', new Headers(), [])).toThrow();
  expect(() =>
    resolveClientAddress('127.0.0.1', new Headers(), ['10.0.0.0/99']),
  ).toThrow();
});
