import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LexonLogo } from '../src/components/lexon-logo';
import { AuthFrame } from '../src/components/auth/auth-frame';

test('brand uses supplied tiers and local SVGs', () => {
  const compact = renderToStaticMarkup(<LexonLogo width={160} />);
  const micro = renderToStaticMarkup(
    <LexonLogo variant="mark-tile" width={32} />,
  );
  expect(compact).toContain('/LEXON-wordmark-compact-ink.svg');
  expect(micro).toContain('/LEXON-mark-tile-seal-micro.svg');

  const frame = renderToStaticMarkup(
    <AuthFrame>
      <h1>Sign in</h1>
    </AuthFrame>,
  );
  expect(frame).toContain('dark:hidden');
  expect(frame).toContain('hidden dark:block');
  expect(frame).toContain('/LEXON-wordmark-compact-cream.svg');
  expect(frame).toContain('/LEXON-wordmark-compact-ink.svg');
});
