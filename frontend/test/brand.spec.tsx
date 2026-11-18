import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LexonLogo } from '../src/components/lexon-logo';
import { AuthFrame } from '../src/components/auth/auth-frame';

test('the logo component serves the brand v4.1 SVGs', () => {
  const monogram = renderToStaticMarkup(
    <LexonLogo variant="monogram" width={20} />,
  );
  expect(monogram).toContain('/LEXON-monogram-micro-seal.svg');
  expect(monogram).toContain('alt="Lexon"');
  expect(monogram).toContain('width="20"');
  expect(monogram).toContain('height="20"');

  const compact = renderToStaticMarkup(
    <LexonLogo variant="wordmark-compact" width={128} />,
  );
  expect(compact).toContain('/LEXON-wordmark-compact-ink.svg');
  expect(compact).toContain('width="128"');
  expect(compact).toContain('height="37"');
  expect(
    renderToStaticMarkup(
      <LexonLogo variant="wordmark-compact" tone="white" width={128} />,
    ),
  ).toContain('/LEXON-wordmark-compact-white.svg');
  expect(
    renderToStaticMarkup(<LexonLogo variant="wordmark" width={240} />),
  ).toContain('/LEXON-wordmark-ink.svg');

  // A decorative copy can opt out of the accessible name.
  expect(
    renderToStaticMarkup(
      <LexonLogo variant="wordmark-compact" tone="white" alt="" />,
    ),
  ).toContain('alt=""');
});

test('the auth frame shows the compact wordmark for each theme', () => {
  const frame = renderToStaticMarkup(
    <AuthFrame>
      <h1>Sign in</h1>
    </AuthFrame>,
  );
  expect(frame).toContain('dark:hidden');
  expect(frame).toContain('hidden dark:block');
  expect(frame).toContain('/LEXON-wordmark-compact-white.svg');
  expect(frame).toContain('/LEXON-wordmark-compact-ink.svg');
});

test('the auth cover is Night and carries no wordmark (one wordmark, in the form column)', () => {
  const frame = renderToStaticMarkup(
    <AuthFrame>
      <h1>Sign in</h1>
    </AuthFrame>,
  );
  expect(frame).toContain('bg-(--lexon-night)');
  expect(frame).not.toMatch(/<img alt=""/);
  expect(frame.match(/<img /g)).toHaveLength(2);
});
