# Next.js handoff

1. Copy everything in `public/` into your app's `public/` folder.
2. Copy `LexonLogo.tsx` into your components folder.
3. Favicon (App Router): copy `public/favicon.svg` to `app/icon.svg` and `public/favicon.ico` to `app/favicon.ico`.
4. Apple touch icon: copy `public/apple-touch-icon.png` to `app/apple-icon.png`.
5. Web app manifest: copy `manifest.webmanifest` to `app/manifest.webmanifest`. The two Android icons it references are already in `public/`.
6. Colors: import `05_BRAND_SYSTEM/design-tokens.css`, or `tailwind-v4.css` for Tailwind v4.

Usage:

```tsx
<LexonLogo />                          {/* wordmark, light background */}
<LexonLogo inverse width={240} />      {/* cream wordmark, dark background */}
<LexonLogo width={140} />              {/* automatically uses the compact wordmark */}
<LexonLogo variant="monogram" width={64} />
<LexonLogo variant="monogram" width={40} />   {/* automatically uses the small monogram */}
<LexonLogo variant="mark-circle" tone="seal" width={72} />   {/* avatar: L in a circle */}
<LexonLogo variant="mark-square" tone="ink" width={96} />    {/* L in a square */}
```

Rules:
- Always use the outlined SVGs. Never retype "Lexon" in a live font.
- Minimums: wordmark 200 px (compact version 128 px), monogram 64 px (small version 40 px, micro mark 16 px). `LexonLogo` switches versions by width. Below 128 px use a monogram, not the wordmark.
- On dark surfaces (`--lexon-ink`, `--lexon-midnight`, `--lexon-seal`) use the cream artwork (`inverse`). On parchment, vellum or white use the ink artwork; the seal (burgundy) artwork is for secondary uses on light surfaces.
