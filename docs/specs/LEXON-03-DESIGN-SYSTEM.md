---
version: "2.1"
name: Lexon
description: "Lexon brand (Royal Seal palette) on shadcn/ui base-nova and assistant-ui components: parchment and ink, wax-seal burgundy accent, Inter for the interface, Georgia for headlines, light and dark themes."
brand-source: "docs/brand/lexon-2026/ (product owner's brand package v1.0, 2026)"

colors:
  background: "#F6EFE2" # Parchment
  card: "#EEE4D2" # Vellum
  popover: "#F6EFE2" # Parchment
  muted: "#E5D9C3" # Mist
  border: "#D8C9AD" # Border
  foreground: "#1F1717" # Ink
  muted-foreground: "#5E5248" # Muted
  primary: "#7A1F2E" # Seal
  primary-hover: "#6A1A28" # Seal Deep
  primary-foreground: "#F6EFE2" # Cream (Parchment)
  secondary: "#E5D9C3" # Mist
  secondary-foreground: "#1F1717"
  accent: "#E5D9C3" # Mist (shadcn hover surface)
  accent-foreground: "#1F1717"
  ring: "#7A1F2E"
  sidebar: "#EEE4D2"
  brand-sage: "#5F6B48" # decorative, or text on background/card only
  danger: "#B42318"
  warning: "#7A4F00"
  success: "#4E5A39"

colors-dark:
  background: "#2A1519" # Midnight
  card: "#3A1E24" # Slate
  popover: "#3A1E24"
  muted: "#4A2830"
  border: "#5A3A40"
  foreground: "#F6EFE2" # Cream
  muted-foreground: "#C9B9A6"
  primary: "#F6EFE2" # Cream fill (Seal on Midnight is only 1.7:1)
  primary-foreground: "#2A1519"
  secondary: "#4A2830"
  secondary-foreground: "#F6EFE2"
  accent: "#4A2830"
  accent-foreground: "#F6EFE2"
  ring: "#F6EFE2"
  sidebar: "#3A1E24"
  brand-sage: "#A9B58F"
  danger: "#F97066"
  warning: "#E0A83A"
  success: "#A9B58F"

fonts:
  sans: "Inter (self-hosted through next/font), system-ui, sans-serif"
  serif: "Georgia, 'Times New Roman', serif (system font, not embedded)"
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace"

radius: 10px # shadcn --radius (0.625rem); derived sm 6px, lg ~14px match brand 6 / 10 / 16

components: "shadcn/ui base-nova blocks and components, assistant-ui registry and examples, as published (sizes, spacing, type scale)"

breakpoints: [768px]
---

# Lexon Design System

| Field | Value |
|---|---|
| **Document** | LEX-DS-001 |
| **Version** | 2.1 |
| **Date** | 3 November 2026 |
| **Companions** | [Technology Stack](./LEXON-01-TECHNOLOGY-STACK.md) · [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md) |
| **Brand source** | [`docs/brand/lexon-2026/`](../brand/lexon-2026/README.md) (logo, guidelines, tokens, icons) |

## Rationale

Lexon is a workspace for sustained legal reading and drafting in Indonesia. The
brand ("Royal Seal") takes the warm feel of an aged legal register: old ink on
parchment, a wax-seal burgundy accent, and one sage green. The interface should
feel like a precise, trustworthy tool and stay quiet while a lawyer reads a
60-page contract.

**Division of responsibility.**

- The **brand package** (`docs/brand/lexon-2026/`) owns the logo, its
  versions, sizes, clear space, misuse rules, and the brand palette.
- **This document** owns how the brand maps onto the interface: color tokens
  for both themes, fonts, the radius token, and accessibility.
- **shadcn/ui `base-nova` blocks and components and the assistant-ui registry
  and examples** own component structure, sizes, spacing, and type scale.
  They are used as published and adapted through CSS variables, copy, and
  data wiring, not by resizing or restructuring them. Later visual
  refinements are deliberate product-owner decisions, made with screenshots.

## 1. Visual theme

- **Warm and restrained.** Parchment and vellum surfaces, ink text, Seal for
  primary actions, links, and focus. No gradients or decorative
  illustrations. Shadows and borders are whatever the component uses.
- **Light and dark themes.** Tokens are CSS variables (shadcn/ui convention)
  with one value set per theme. Users choose Light, Dark, or System; System
  is the default. Components never branch on the theme.
- **Dark theme uses cream, never Seal, for emphasis.** Seal on Midnight is
  1.7:1, so the dark primary is a cream fill with Midnight text, and focus
  rings are cream.
- **Desktop and tablet first** (≥ 768px). Below 768px, layouts stack and
  remain usable; dense views may show a "best on a larger screen" notice.

## 2. Color

The frontmatter lists every token. They map one to one onto the shadcn/ui
variables of the same name (`--background`, `--card`, `--popover`, `--muted`,
`--border`, `--input` = `border`, `--foreground`, `--muted-foreground`,
`--primary`, `--primary-foreground`, `--secondary`, `--accent`, `--ring`,
`--destructive` = `danger`, and the `--sidebar-*` family: `--sidebar` as
listed, `--sidebar-foreground` = `foreground`, `--sidebar-primary` =
`primary`, `--sidebar-primary-foreground` = `primary-foreground`,
`--sidebar-accent` = `accent`, `--sidebar-accent-foreground` =
`accent-foreground`, `--sidebar-border` = `border`, `--sidebar-ring` =
`ring`). `--card-foreground` and `--popover-foreground` are `foreground`.
Charts (later slices) use Seal, Sage, Ink, Muted, and Warning in that order.

Measured contrast (WCAG 2.2 relative luminance):

| Pair | Light | Dark |
|---|---|---|
| `foreground` on `background` / `card` / `muted` | 15.4 / 14.0 / 12.6 | 15.1 / 13.2 / 11.2 |
| `muted-foreground` on `background` / `card` / `muted` | 6.6 / 6.0 / 5.4 | 9.0 / 7.9 / 6.7 |
| `primary-foreground` on `primary` | 8.9 (cream on Seal) | 15.1 (Midnight on cream) |
| `ring` on `background` | 8.9 | 15.1 |
| `danger` on `background` / `card` / `muted` | 5.8 / 5.2 / 4.7 | 6.2 / 5.4 / 4.6 |
| `warning` on `background` / `card` / `muted` | 6.2 / 5.7 / 5.1 | 8.1 / 7.1 / 6.0 |
| `success` on `background` / `card` / `muted` | 6.5 / 5.9 / 5.3 | 8.0 / 7.0 / 5.9 |
| `brand-sage` on `background` / `card` | 5.0 / 4.5 | 8.0 / 7.0 |

Rules:

- `brand-sage` is below 4.5:1 on light `muted`; use it as text only on
  `background` or `card`, otherwise as a non-text accent.
- `border` is decorative (1.4:1 light, 1.7:1 dark). Inputs rely on their
  label and the focus ring for the non-text cue.
- Status colors always come with an icon or a label, never color alone.
- `primary-hover` (Seal Deep) is the light hover/pressed state of primary; in
  dark, the component's own hover treatment applies to the cream fill.

## 3. Typography

- **Interface and body:** Inter, self-hosted through `next/font` (no runtime
  request to a font host), with `system-ui, sans-serif` fallback.
- **Headlines:** Georgia, `'Times New Roman'`, serif, for page titles and
  headline-style text (auth page titles, empty-state and welcome headlines).
  It is a system font and is not embedded.
- **Mono:** `ui-monospace, SFMono-Regular, Menlo, monospace` for code,
  aligned clause numbers, and ids.
- Sizes, weights, and line heights follow the shadcn/assistant-ui component or
  block in use. Long reading content Lexon designs itself (assistant answers,
  document previews) uses 16px with line-height 1.5.

## 4. Brand assets in the interface

Follow the brand guidelines (`docs/brand/lexon-2026/06_GUIDELINES/BRAND-GUIDELINES.md`
§1, §4, §5, §8):

- **Never retype "Lexon" in a live font as a logo.** Use the outlined SVGs
  through the supplied `LexonLogo` component (ink artwork on light surfaces,
  cream artwork on dark). The browser `<title>` and ordinary sentences in
  copy may contain the word.
- **Sizes:** full wordmark ≥ 200px, compact wordmark 128–199px, monogram
  ≥ 64px (small 40–63px, micro 16–39px). Below 128px use a monogram or mark,
  not a wordmark.
- **Placement:**
  - **Sidebar:** the rounded-square (tile) mark, seal tone, micro tier, at
    32px, in the logo square of the organization switcher (the `sidebar-07`
    team-switcher slot). No wordmark in the sidebar. The collapsed (icon)
    sidebar shows only that mark.
  - **Sign-in and account pages:** the compact wordmark at 128px.
  - **Favicon, Apple touch icon, manifest icons:** from `03_APP_ICONS/` and
    `07_DEVELOPER_HANDOFF/` (brand v1.1, seal tone).
- Keep clear space; never stretch, recolor outside the palette, add shadows,
  or place the logo on low-contrast surfaces. On Seal or Midnight use cream.

## 5. Components, spacing, and layout

- Start every screen from the closest published shadcn `base-nova` block or
  component, or assistant-ui example, and keep its structure, sizes, and
  spacing. Do not hard-code colors; colors come from the tokens.
- Use the component's own variants (`default`, `secondary`, `outline`,
  `ghost`, `destructive`, sizes).
- **Radius:** shadcn `--radius` is `0.625rem` (10px); component radii derive
  from it as shadcn defines (sm ≈ 6px, lg ≈ 14px), matching the brand's
  6 / 10 / 16px scale.
- **App shell:** shadcn `sidebar-07` (sidebar header with logo and
  organization switcher, navigation, user menu; page header with sidebar
  trigger, separator, and breadcrumb), main content, optional right panel.
- **Chat:** assistant-ui defaults. Assistant answers render as full-width
  reading blocks; citations (F8) render as compact inline markers.
- New layouts with no published block use the Tailwind spacing scale.
- **Visual target:** a slice that changes UI starts from a prototype the
  product owner approves (for F2.1: `docs/design/f2.1-prototype/`). Layout,
  hierarchy, content, and states follow the prototype; component internals
  and sizes follow shadcn/assistant-ui.

### 5.1 UI patterns (required in every slice)

Built from shadcn `base-nova` components; examples in
`docs/design/f2.1-prototype/screens/30-ui-patterns-*.png`.

- **Fields:** `Field` + `FieldLabel` + control + `FieldDescription` /
  `FieldError`. Validation runs on submit, then live for fields already
  touched. An invalid field sets `aria-invalid`, `data-invalid` on the Field
  (red label and border), and its error text is linked with
  `aria-describedby`. Errors say what to do ("Enter a valid email address.").
- **Passwords:** every password input (sign in, sign up, reset, change,
  confirm identity, admin setup) is an `InputGroup` with an end
  `InputGroupButton` that toggles visibility: eye / eye-off icon,
  `aria-label` "Show password" / "Hide password", `aria-pressed`. Keep the
  correct `autocomplete` value.
- **Pending actions:** the busy button shows `Spinner` and a present-tense
  label ("Signing in…", "Saving…"), keeps its width, and blocks repeat
  submits; other inputs stay readable.
- **Server errors:** a form-level `Alert` (destructive) above the fields,
  generic copy where security requires it (sign in, reset). Unexpected
  failures never show raw messages.
- **Confirmations:** non-blocking results (saved, invited, revoked) use a
  `Sonner` toast; errors that block a form stay inline.
- **Empty and loading:** `Empty` (icon, title, one sentence, optional action)
  for empty lists; `Skeleton` rows for loading lists and tables; a spinner
  only inside the control that is busy.
- **Destructive actions:** confirm in an `AlertDialog` that names the object
  ("Remove Dewi Lestari from Hukum Nusantara?").

### 5.2 Settings

- **One Settings dialog** for personal and organization settings, built from
  the shadcn `sidebar-13` block (a sidebar inside a `Dialog`). It opens from
  the user menu (and Ctrl/Cmd + ,) on any workspace page, closes with the X,
  Escape, or the backdrop, and returns focus to its opener.
- **Sections:** an **Account** group (Profile, Appearance, Security) for
  everyone, then a group named after the active organization when it is a
  team: Members (every role), Invitations (admin and owner), General
  (owner). Later personal settings (memory, connectors, my activity,
  privacy) are added as sections here.
- **State in the URL:** the open dialog and its section are reflected in a
  `settings=<section>` search parameter so a link or a reload reopens it;
  closing removes it. Sections always refer to the **active** organization;
  a section the user's role does not allow shows the no-access state and
  requests nothing.
- **Platform administration** stays a sidebar destination with its own pages.
- Single breakpoint at 768px (shadcn's mobile breakpoint).
- All motion respects `prefers-reduced-motion`.

## 6. Accessibility (required, not advisory)

- WCAG 2.2 AA is the bar: text contrast ≥ 4.5:1, non-text UI ≥ 3:1.
- Every interactive element is keyboard reachable with a visible focus ring.
- Target size meets WCAG 2.2 SC 2.5.8 (≥ 24×24px or the spacing exception);
  shadcn default control sizes satisfy it.
- No information is conveyed by color alone.
- Automated checks (axe via Playwright) run in CI on key pages in both themes.

## 7. Change history

| Version | Change |
|---|---|
| 2.1 | **Added (product owner, prototype approval):** UI patterns (§5.1: fields and errors, password visibility toggle, pending buttons, form alerts, toasts, empty and loading states, destructive confirmation); one Settings dialog (§5.2, shadcn `sidebar-13`) for personal and organization settings; visual-target rule. **Changed:** logo placement (§4): tile mark in the organization switcher instead of a sidebar wordmark; sign-in pages use the compact wordmark at 128px; brand package v1.1 (more space around the L in marks and icons) |
| 2.0 | **Replaced (product owner, brand package v1.0):** the measured gray palette by the Lexon "Royal Seal" brand (Parchment, Vellum, Mist, Ink, Muted, Seal, Seal Deep, Sage, Midnight, Slate) with a full light/dark mapping onto shadcn variables and measured contrast; status colors re-measured on the new surfaces. **Added:** brand package in `docs/brand/lexon-2026/`; logo usage in the interface (§4); Inter (self-hosted) for the interface and Georgia for headlines (§3). **Changed:** radius token 5px → 10px (shadcn default, matches the brand scale) |
| 1.3 | **Changed (product owner, after F2 visual review):** component structure, sizes, spacing, and type scale come from shadcn/ui `base-nova` blocks/components and assistant-ui examples as published; this document keeps color tokens, fonts, the radius token, themes, and accessibility. Removed: the 8px-grid and 400ms motion rules, 40px/44px control sizes (target size is WCAG 2.2 AA 2.5.8), Lexon type scale for UI, the single-shadow rule, and the rectangular-only radius rule |
| 1.2 | Clarified (F2 design review): the 5px radius applies to rectangular elements; radio indicators, switch thumbs, initials avatars, and status dots stay circular (§4) |
| 1.1 | Dark theme added by product-owner decision (F2): `colors-dark` token set with measured contrast (§2.1); Light / Dark / System selection with System as default (§1). Light values unchanged |
| 1.0 | Adopted from the measured design file with corrections: text and primary moved to near-black; `#8e8ea0` restricted to non-text accent; inverted "text-muted" fixed; added surface, border, focus, status tokens, mono font, spacing scale, reduced motion, and AA as a requirement; components mapped to shadcn/ui `base-nova` and assistant-ui |
