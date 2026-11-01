---
version: "1.2"
name: Lexon
description: "Calm, flat, engineer-first interface in light and dark themes: near-black text, a muted purple-gray brand accent, 8px spacing, system-ui type."
inspiration: "Initial tokens were measured from openai.com (a public site) and then corrected for accessibility. Lexon does not reuse OpenAI brand assets, logos, or names."

colors:
  background: "#ffffff"
  surface: "#f7f7f8"
  surface-raised: "#ffffff"
  border: "#e5e5e9"
  text: "#0d0d0d"
  text-muted: "#6e6e80"
  primary: "#0d0d0d"
  on-primary: "#ffffff"
  accent: "#8e8ea0"
  accent-strong: "#5d5d6e"
  focus-ring: "#5d5d6e"
  danger: "#b42318"
  warning: "#8a5a00"
  success: "#1f7a3d"

colors-dark:
  background: "#121214"
  surface: "#1c1c20"
  surface-raised: "#26262b"
  border: "#34343c"
  text: "#ececf1"
  text-muted: "#a0a0b0"
  primary: "#ececf1"
  on-primary: "#0d0d0d"
  accent: "#7a7a8c"
  accent-strong: "#c2c2d0"
  focus-ring: "#c2c2d0"
  danger: "#f97066"
  warning: "#e0a83a"
  success: "#4cc276"

typography:
  display: { fontFamily: "system-ui, sans-serif", fontSize: 48px, fontWeight: 700, lineHeight: 1.5 }
  heading: { fontFamily: "system-ui, sans-serif", fontSize: 32px, fontWeight: 600, lineHeight: 1.5 }
  body:    { fontFamily: "system-ui, sans-serif", fontSize: 16px, fontWeight: 400, lineHeight: 1.5 }
  mono:    { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }

spacing:
  base: 8px
  scale: [4, 8, 16, 24, 32, 40, 48, 64]

radius:
  sm: 5px

motion:
  duration: 400ms
  easing: "ease"
  reduced-motion: "respect prefers-reduced-motion (durations become 0ms)"

breakpoints: [768px]
---

# Lexon Design System

| Field | Value |
|---|---|
| **Document** | LEX-DS-001 |
| **Version** | 1.2 |
| **Date** | 1 November 2026 |
| **Companions** | [Technology Stack](./LEXON-01-TECHNOLOGY-STACK.md) · [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md) |

## Rationale

Lexon is a workspace for sustained legal reading and drafting. The interface is
restrained: a near-black and white base, one muted purple-gray accent
(`#8e8ea0`), system fonts, an 8px grid, flat surfaces, and a single 5px radius.
The interface should feel like a precise tool, never like a consumer app. It
does not call attention to itself while a lawyer reads a 60-page contract.

## 1. Visual theme

- **Calculated simplicity.** No decorative shadows, gradients, or illustrations.
  Grouping comes from spacing, 1px borders (`border`), and surface shifts
  (`surface`).
- **Light and dark themes.** Tokens are defined as CSS variables (shadcn/ui
  convention) with one value set per theme (§2.1). Users choose Light, Dark,
  or System (follows the operating system); System is the default.
  Components never branch on the theme; only token values change.
- **Desktop and tablet first** (≥ 768px). Below 768px, layouts stack and
  remain usable, but dense views (Tabular Review grid, DOCX editor) may show
  a "best on a larger screen" notice.

## 2. Color

| Token | Value | Use | Contrast on `#ffffff` |
|---|---|---|---|
| `text` | `#0d0d0d` | All body and heading text | 19.4:1 (AAA) |
| `text-muted` | `#6e6e80` | Secondary text, metadata, placeholders | 5.0:1 (AA) |
| `primary` / `on-primary` | `#0d0d0d` / `#ffffff` | Primary buttons, selected states | 19.4:1 |
| `accent` | `#8e8ea0` | Brand accent: icons, dividers, inactive indicators, decorative marks. **Never for text.** | 3.2:1 (meets 3:1 for non-text UI, WCAG 1.4.11) |
| `accent-strong` | `#5d5d6e` | Secondary buttons (white text), links on hover, accent text when needed | 6.5:1 |
| `focus-ring` | `#5d5d6e` | 2px focus outline, 2px offset | 6.5:1 |
| `surface` | `#f7f7f8` | Sidebars, panels, table headers | — |
| `border` | `#e5e5e9` | Dividers, input borders (inputs also need a 3:1 cue on focus) | — |
| `danger` / `warning` / `success` | `#b42318` / `#8a5a00` / `#1f7a3d` | Status text and icons; always paired with an icon or label, never color alone | ≥ 4.5:1 (also on `surface`) |

### 2.1 Dark theme

The same tokens and rules apply. Contrast is measured against `background`
(`#121214`); every text token also passes on `surface` and `surface-raised`.

| Token | Value | Use | Contrast on `#121214` |
|---|---|---|---|
| `background` / `surface` / `surface-raised` | `#121214` / `#1c1c20` / `#26262b` | Page, sidebars and panels, raised elements (menus, dialogs) | — |
| `border` | `#34343c` | Dividers, input borders (inputs also need a 3:1 cue on focus) | — |
| `text` | `#ececf1` | All body and heading text | 15.9:1 |
| `text-muted` | `#a0a0b0` | Secondary text, metadata, placeholders | 7.3:1 (5.8:1 on `surface-raised`) |
| `primary` / `on-primary` | `#ececf1` / `#0d0d0d` | Primary buttons (light fill, dark text), selected states | 16.5:1 (text on fill) |
| `accent` | `#7a7a8c` | Non-text accent only, as in light | 4.5:1 (≥ 3:1 non-text) |
| `accent-strong` | `#c2c2d0` | Secondary buttons (dark `#0d0d0d` text), accent text | 10.6:1; 11.0:1 for dark text on it |
| `focus-ring` | `#c2c2d0` | 2px focus outline, 2px offset | 10.6:1 |
| `danger` / `warning` / `success` | `#f97066` / `#e0a83a` / `#4cc276` | Status text and icons; always with an icon or label | ≥ 5.4:1 on every surface |

Overlays in the dark theme use a border (`border`) instead of a shadow.

**Correction from the measured source.** The measured palette used `#8e8ea0`
for body text and claimed ~8:1 for white on `#8e8ea0`. Both are wrong for
accessibility: `#8e8ea0` on white is 3.2:1 (fails WCAG AA for text), and white
on `#8e8ea0` is also 3.2:1. Lexon therefore uses near-black for text and
primary actions and keeps `#8e8ea0` as a non-text accent. The measured file
also labelled pure black as "text-muted", which is inverted; it is fixed above.

**Domain colors** (defined when the feature lands, same rules apply): citation
verified / unverified, tracked-change insert / delete, Tabular Review cell
states (`pending`, `running`, `done`, `error`, `stale`), OCR low-confidence.

## 3. Typography

- `display` 48/700 — rare; empty states and onboarding headlines.
- `heading` 32/600 — page titles. Section headings step down to 24/600 and
  20/600 (multiples of the 8px grid in line height).
- `body` 16/400, line-height 1.5 — default for UI and reading. Dense UI
  (tables, sidebars) may use 14/400.
- `mono` — code, clause numbers when aligned, ids.
- All fonts are system fonts; no web font is loaded.

## 4. Components

Built from shadcn/ui (style `base-nova`, Base UI primitives) and the
assistant-ui registry, restyled through the tokens above. Do not hard-code
colors inside components.

- **Buttons:** primary (`primary` fill), secondary (`accent-strong` fill,
  white text), ghost (text only, `surface` on hover), destructive (`danger`).
  Minimum height 40px, touch target ≥ 44×44px including padding.
- **Inputs:** 1px `border`, 5px radius, focus shows `focus-ring`.
- **Radius:** every rectangular element uses the one 5px radius (`sm`).
  Elements whose shape carries meaning stay circular: radio indicators,
  switch thumbs, initials avatars, and status dots. No pill-shaped buttons,
  badges, or inputs.
- **Cards and panels:** flat, 1px `border` or `surface` background, no shadow.
  Overlays (dialogs, menus, popovers) may use one subtle shadow for
  separation from content; that is the only shadow in the system.
- **Chat:** messages are full-width reading blocks, not bubbles, for long
  legal answers. Citations render as compact inline markers that open the
  source.
- **Motion:** one duration (400ms, `ease`) for reveals and transitions;
  hover/press feedback may be instant. Respect `prefers-reduced-motion`.

## 5. Spacing and layout

- 8px base grid; 4px is allowed only for tight inline gaps (icon to label).
- App shell: left sidebar (navigation, recent items), main content area,
  optional right panel (document viewer, sources, details).
- Single breakpoint at 768px.

## 6. Accessibility (required, not advisory)

- WCAG 2.2 AA is the bar: text contrast ≥ 4.5:1, non-text UI ≥ 3:1.
- Every interactive element is keyboard reachable with a visible focus ring.
- No information is conveyed by color alone.
- Automated checks (axe via Playwright) run in CI on key pages.

## 7. Change history

| Version | Change |
|---|---|
| 1.2 | Clarified (F2 design review): the 5px radius applies to rectangular elements; radio indicators, switch thumbs, initials avatars, and status dots stay circular (§4) |
| 1.1 | Dark theme added by product-owner decision (F2): `colors-dark` token set with measured contrast (§2.1); Light / Dark / System selection with System as default (§1). Light values unchanged |
| 1.0 | Adopted from the measured design file with corrections: text and primary moved to near-black; `#8e8ea0` restricted to non-text accent; inverted "text-muted" fixed; added surface, border, focus, status tokens, mono font, spacing scale, reduced motion, and AA as a requirement; components mapped to shadcn/ui `base-nova` and assistant-ui |
