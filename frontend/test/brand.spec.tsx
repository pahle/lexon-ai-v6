import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LexonLogo } from '../src/components/lexon-logo';

test('brand uses supplied tiers and local SVGs', () => {
  const compact = renderToStaticMarkup(<LexonLogo width={160} />);
  const micro = renderToStaticMarkup(
    <LexonLogo variant="mark-tile" width={32} />,
  );
  expect(compact).toContain('/LEXON-wordmark-compact-ink.svg');
  expect(micro).toContain('/LEXON-mark-tile-seal-micro.svg');

  const themes = renderToStaticMarkup(
    <>
      <span className="block dark:hidden" data-logo-theme="light">
        <LexonLogo width={160} />
      </span>
      <span className="hidden dark:block" data-logo-theme="dark">
        <LexonLogo inverse width={160} />
      </span>
    </>,
  );
  expect(themes).toContain('data-logo-theme="light"');
  expect(themes).toContain('data-logo-theme="dark"');
  expect(themes).toContain('block dark:hidden');
  expect(themes).toContain('hidden dark:block');
  expect(themes).toContain('/LEXON-wordmark-compact-cream.svg');
});
