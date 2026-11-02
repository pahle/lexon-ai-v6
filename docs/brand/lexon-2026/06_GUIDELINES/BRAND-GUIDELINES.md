# Lexon Brand Guidelines

Version 1.0 (2026). Legal AI Workspace for Indonesia.

## 1. The logo

The Lexon logo is a wordmark with a custom **L**: an architectural column made of a mirrored capital, three pillars and a foot that sweeps up toward the **e**. The letters **exon** are set in Georgia Regular and sit on the same baseline. The L is drawn with the same sharp, flat-cut serif ends, bracketed flares and stroke weight as the letters, and the tip of the L foot sits at the same height as the tail of the **e**.

| Asset | File | Use |
|---|---|---|
| Wordmark | `01_VECTOR/LEXON-wordmark-{ink,seal,cream}.svg` | Primary logo. Ink on light backgrounds, cream on dark or on Seal. Seal for secondary uses. |
| Compact wordmark | `01_VECTOR/LEXON-wordmark-compact-{ink,seal,cream}.svg` | 128 to 199 px wide. Same L, with thinner pillars and wider gutters so all three stay visible. |
| Small monogram | `01_VECTOR/LEXON-monogram-small-{ink,seal,cream}.svg` | 40 to 63 px. Three fine pillars. |
| Monogram | `01_VECTOR/LEXON-monogram-{ink,seal,cream}.svg` | Avatars, app icons, places where the name is already shown. |
| Micro mark | `01_VECTOR/LEXON-monogram-micro-{ink,seal,cream}.svg`, `03_APP_ICONS/favicon.svg` | 16 to 39 px. Single-stem L, because three lines cannot be drawn this small. |

| Marks | `01_VECTOR/marks/LEXON-mark-{circle,square,tile}-{seal,ink,midnight,parchment}[-small|-micro].svg` | The L inside a circle, a square or a rounded square. 36 files, see section 3. |

All SVGs are path-only: no live text, no embedded images, no filters. PNG exports are rendered from these files.

## 2. Construction

Values are in the artwork's own SVG units. They describe this logo; they are not a general standard.

**Monogram L**
- Cap: 340 wide, exactly symmetric about the axis at x = 170. The plate ends are 37 thick with sharp, flat-cut corners and a concave bracket into the neck, as on Georgia's serifs.
- Pillars: three bars, 34 wide, at x = 104, 153 and 202. Gutters between them: 15. Together they are 132 wide.
- Gap between cap and pillars, and between pillars and base: 21 (the base mirrors the cap).
- The foot is at least 37 thick everywhere and ends in an angled flat-cut tip, like the tail of the **e**. The apex of the tip is level with the apex of the tail of the **e** (measured difference 0.0 units).

**Wordmark** (artboard 1631 x 472)
- Letters **e x o n** are outlines of Georgia Regular at a uniform scale (no stretching). Their x-height is 311 units, 67% of the height of the L.
- Closest horizontal gap between letter pairs: L-e 32, e-x 54, x-o 60, o-n 58. No pair overlaps. Spacing was set by eye; equal numbers were not the goal.

## 3. Logo marks

The same L, centered the same way, inside three containers. Use them where a fixed shape is needed: avatars, stamps, app icons, favicons, signage.

| Shape | Use | L inside the shape (full / small / micro) |
|---|---|---|
| Circle | Avatars and profile pictures | 61% / 64% / 67% of the diameter in height. The farthest point of the L stays inside 81% / 85% / 89% of the radius, never beyond 90%. |
| Square | Print, signage, stamps, platform-masked icons | 71% / 77% / 83% of the side in height. |
| Rounded square | App icons, favicon | Same L as the square. Corner radius 96 on a 512 grid (19%). |

- **Tones:** `seal` (cream L on Seal), `ink` (cream L on Ink), `midnight` (cream L on Midnight), `parchment` (Seal L on Parchment with a Border-color outline so the shape reads on light pages). Pick `seal` as the default.
- **Tiers:** the file ending `-small` (three fine pillars) is used from 40 to 63 px, the file ending `-micro` (single stem, larger L) from 16 to 39 px, the plain file from 64 px. The L is scaled up a little at the smaller tiers so it stays legible.
- **Centering:** the L is placed by its optical center, not its bounding-box center, so the long foot does not pull it to the right. The mark is self-contained: no extra clear space is needed around the shape itself, but keep at least half the mark width free of other elements.
- Do not put a wordmark inside a mark, do not change the container shape, and do not add a second ring or shadow.

## 4. Clear space and minimum size

- **Clear space, wordmark:** at least the x-height of the lowercase letters (311 units, 19% of the logo width) on every side.
- **Clear space, monogram:** at least the width of the pillar group (132 units, 22% of the monogram width).
- **Minimum width:** wordmark 200 px; compact wordmark 128 px (below 128 px use a monogram, not the wordmark); monogram 64 px; small monogram 40 px; micro mark 16 px; marks (circle, square, rounded square) follow the same three tiers, from 16 px. In the Next.js component the version switches automatically by width.
- **App icons:** the L is 71% of the icon height at full size and is centered optically: because of the long foot it sits slightly to the right of its bounding-box center, so the pillars and the foot look balanced. Platforms may mask or round the icon.
- **Monogram files** are square artboards with the L centered the same way.

See `04_PREVIEW/logo-sizes.png` for a 1:1 test and `04_PREVIEW/preview-marks.png` for the marks.

## 5. Placement in context

Every preview in `04_PREVIEW/` uses the original SVG files unchanged, scaled by width only, with the file chosen by size. The same role has the same size everywhere. `08_QA/preview-consistency.json` lists every placement that was measured in the rendered preview.

| Where | Logo | Width |
|---|---|---|
| App header or sidebar, website navigation | Compact wordmark, ink (cream on dark) | 160 px |
| Print header, letterhead, business card | Wordmark, ink | 240 px |
| Banner, cover, large surface | Wordmark, cream on Ink or Seal | 240 px or larger |
| Document seal, signature block | Circle mark, seal | 96 px |
| Avatar, profile picture | Circle mark | 200, 150, 72, 44, 29 px |
| App icon | Rounded-square mark, seal (ink as alternate) | 150, 96, 72, 44, 29 px |
| Browser tab, favicon | Rounded-square mark, seal, micro | 16 px |

Clear space is kept around every wordmark and monogram; the previews verify that these boxes never overlap.

## 6. Color

Palette name: **Royal Seal**. Old ink, parchment, wax-seal burgundy and one sage green, taken from the warm, aged-document feel of a legal register and softened with the greens and blues of a seaside painting.

| Role | Name | HEX |
|---|---|---|
| Logo, text | Ink | `#1F1717` |
| Accent, buttons, links | Seal | `#7A1F2E` |
| Accent, hover | Seal Deep | `#6A1A28` |
| Secondary accent | Sage | `#5F6B48` |
| Default page background | Parchment | `#F6EFE2` |
| Cards, panels | Vellum | `#EEE4D2` |
| Subtle fills | Mist | `#E5D9C3` |
| Lines | Border | `#D8C9AD` |
| Secondary text | Muted | `#5E5248` |
| Dark surface | Midnight | `#2A1519` |
| Dark raised surface | Slate | `#3A1E24` |

Logo colors: **ink** on Parchment, Vellum or white (primary); **seal** on Parchment or Vellum (secondary); **cream** (Parchment color) on Midnight, Ink or Seal.

Contrast (WCAG 2.2, sRGB): ink on parchment 15.39:1, muted on parchment 6.61:1, seal on parchment 8.9:1, sage on parchment 4.99:1, cream on seal 8.9:1, cream on midnight 15.06:1. Seal on Midnight is only 2.0:1: on dark surfaces use cream, never seal. Logos are exempt from the text-contrast rule, but all text pairs above meet 4.5:1.

Tokens: `05_BRAND_SYSTEM/design-tokens.css`, `.json`, and `tailwind-v4.css`.

## 7. Typography

- The brand name appears only as the outlined artwork. Never retype it.
- Headlines: Georgia, where the platform provides it; otherwise a system serif.
- Interface and body: Inter, with a system sans-serif fallback.

## 8. Misuse

Do not: stretch, condense or rotate the logo; add gradients, shadows or outlines; recolor outside the palette; change the number of pillars; put the wordmark inside a mark; join the separated pillar tops and bottoms; use the full wordmark below 200 px or the full monogram below 64 px; place it on low-contrast or busy backgrounds; retype the name in a font.

## 9. Before public launch

These checks are outside what the files can prove:
1. **Trademark search** for "Lexon" in Indonesia (DJKI) and target markets, in software, SaaS and legal-services classes. Similar names already exist in legal tech.
2. **Typeface licensing.** Letters e, x, o, n are unmodified Georgia Regular outlines. Georgia is a commercial typeface; licensing it for use in the logo is Lexon's responsibility (no font files are included in this package). Letters from a standard typeface are not exclusive to Lexon, so the protectable part of the mark is the custom three-pillar L and its combination with the name.
3. **Print proof** for Seal, Sage and Ink on real paper stock. Pantone and CMYK values are not defined yet.
4. **Recognition test** with real users, including at 16 to 63 px. Georgia is sturdier than a fine book serif, but the three-pillar gutters are narrow, so check the full wordmark at the smallest size you plan to use.

## 10. Package contents

```
01_VECTOR            Master SVGs, and marks/ (circle, square, rounded square)
02_PNG               Transparent PNG exports, and marks/
03_APP_ICONS         Favicon, Apple touch, Android, app icons
04_PREVIEW           Logo sheet, 1:1 size test, application mockups (website, dashboard, mobile and favicon, stationery, social, legal document, marks, palette)
05_BRAND_SYSTEM      CSS, JSON and Tailwind tokens
06_GUIDELINES        This guide (MD and PDF)
07_DEVELOPER_HANDOFF Next.js component, manifest, public assets
08_QA                Measurements, preview consistency report, checksums
```
