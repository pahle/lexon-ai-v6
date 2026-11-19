import { expect, test } from 'vitest';
import { describeDevice } from '../src/index.js';

const chromeMac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const safariIphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const edgeWindows =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

test.each([
  [chromeMac, 'Chrome on macOS', 'desktop'],
  [safariIphone, 'Safari on iPhone', 'mobile'],
  [edgeWindows, 'Edge on Windows', 'desktop'],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Safari on macOS',
    'desktop',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Firefox on Linux',
    'desktop',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Chrome on Android',
    'mobile',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Chrome on Android',
    'tablet',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    'Chrome on iPad',
    'tablet',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
    'Opera on Windows',
    'desktop',
  ],
])('describes %s', (userAgent, name, kind) => {
  expect(describeDevice(userAgent)).toEqual({ name, kind });
});

test('unknown, empty, or missing user agents never invent a device', () => {
  for (const value of [
    null,
    undefined,
    '',
    '   ',
    'curl/8.4.0',
    'x'.repeat(5000),
  ])
    expect(describeDevice(value)).toEqual({
      name: 'Unknown device',
      kind: 'unknown',
    });
});

test('a recognised system without a recognised browser keeps only what is known', () => {
  expect(describeDevice('SomeApp/1.0 (Windows NT 10.0)')).toEqual({
    name: 'Windows',
    kind: 'desktop',
  });
});
