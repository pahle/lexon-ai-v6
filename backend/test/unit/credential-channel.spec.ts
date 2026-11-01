import { expect, test } from 'vitest';
import { credentialChannel } from '../../src/modules/identity-access/credential-channel.js';
test('canonical credential channels reject duplicate and ambiguous raw headers', () => {
  expect(
    credentialChannel(new Headers({ authorization: 'Bearer opaque-token' })),
  ).toBe('bearer');
  expect(
    credentialChannel(
      new Headers({ cookie: 'better-auth.session_token=opaque' }),
    ),
  ).toBe('cookie');
  for (const headers of [
    new Headers({ authorization: 'Basic opaque' }),
    new Headers({ authorization: 'Bearer a, Bearer b' }),
    new Headers({ authorization: 'Bearer a', cookie: 'anything=b' }),
    new Headers({
      cookie: 'better-auth.session_token=a; better-auth.session_token=b',
    }),
    new Headers({
      cookie:
        'better-auth.session_token=a; __Secure-better-auth.session_token=b',
    }),
  ])
    expect(() => credentialChannel(headers)).toThrow();
  expect(() =>
    credentialChannel(new Headers({ authorization: 'Bearer first' }), [
      'Authorization',
      'Bearer first',
      'authorization',
      'Bearer second',
    ]),
  ).toThrow();
  expect(() =>
    credentialChannel(new Headers({ cookie: 'better-auth.session_token=a' }), [
      'Cookie',
      'better-auth.session_token=a',
      'Cookie',
      'other=b',
    ]),
  ).toThrow();
});
