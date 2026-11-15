import localFont from 'next/font/local';

// Brand v4.1 fonts, self-hosted from docs/brand/lexon-2026-v4.1/fonts with
// their licenses (LEX-DS-001 §3). No request goes to a font host.
// next/font names each generated font family after its exported constant,
// so the constants carry the family names.

/** Interface and body text. */
export const Inter = localFont({
  src: './Inter-latin-wght.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-inter',
});

/** Headlines: greeting, page titles, auth headings, section titles. */
export const Garamond = localFont({
  src: [
    {
      path: './EBGaramond-latin-wght.woff2',
      weight: '400 800',
      style: 'normal',
    },
    {
      path: './EBGaramond-Italic-latin-wght.woff2',
      weight: '400 800',
      style: 'italic',
    },
  ],
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
  variable: '--font-garamond',
});

/** Legal quotations (F8 onward). Shipped now, loaded only when used. */
export const Bonum = localFont({
  src: [
    {
      path: './TeXGyreBonum-Regular-latin.woff2',
      weight: '400',
      style: 'normal',
    },
    { path: './TeXGyreBonum-Bold-latin.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  variable: '--font-bonum',
});
