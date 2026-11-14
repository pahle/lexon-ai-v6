---
version: "3.0"
name: Lexon
description: "Lexon brand v4.1 on shadcn/ui base-nova and assistant-ui components: white surfaces and ink text, Merah Segel red only for primary actions and flagged items, Inter for the interface, EB Garamond for headlines, TeX Gyre Bonum for legal quotations, light and dark themes."
brand-source: "docs/brand/lexon-2026-v4.1/ (product owner's LEXON Brand Kit 2026 v4.1)"

colors:
  background: "#FFFFFF" # White
  card: "#FFFFFF"
  popover: "#FFFFFF"
  muted: "#F5F4F4" # Surface
  border: "#ECEAEA" # Line Soft
  input: "#DDDADA"
  foreground: "#1A1718" # Ink
  muted-foreground: "#6B6567" # Muted
  primary: "#B3202A" # Merah Segel
  primary-foreground: "#FFFFFF"
  secondary: "#F5F4F4" # Surface
  secondary-foreground: "#1A1718"
  accent: "#F2F1F1" # hover surface
  accent-foreground: "#1A1718"
  destructive: "#8E1A22" # Merah Segel Deep (dialog confirm buttons and error text)
  ring: "#B3202A"
  sidebar: "#F5F4F4"
  sidebar-primary: "#1A1718" # team switcher tile
  sidebar-primary-foreground: "#FFFFFF"
  sidebar-accent: "#ECEAEA"
  sidebar-border: "#E6E4E4"
  red-text: "#B3202A" # red text: pressed toggles, flagged items
  tint: "#F7E6E8" # reference numbers, highlights, pressed Deep thinking pill
  flag: "#FBF1F2" # flagged table cell (F13)
  deleted: "#9A9495" # struck-through text (F14)
  user-bubble: "#F5F4F4"
  night: "#080606" # auth cover panel (same in both themes)
  warning: "#8A5300"
  success: "#2F6B3A"

colors-dark:
  background: "#121011"
  card: "#1A1718"
  popover: "#1A1718"
  muted: "#242021"
  border: "#2C2829"
  input: "#57504F"
  foreground: "#F2F0F0"
  muted-foreground: "#A69FA1"
  primary: "#B3202A" # the red fill stays; white text 6.65:1
  primary-foreground: "#FFFFFF"
  secondary: "#242021"
  secondary-foreground: "#F2F0F0"
  accent: "#242021"
  accent-foreground: "#F2F0F0"
  destructive: "#F0646C" # error text; dialog confirm buttons keep Merah Segel Deep fill
  ring: "#F0646C"
  sidebar: "#181516"
  sidebar-primary: "#F2F0F0"
  sidebar-primary-foreground: "#121011"
  sidebar-accent: "#2A2627"
  sidebar-border: "#2C2829"
  red-text: "#F0646C"
  tint: "#3A1A1E"
  flag: "#2A1517"
  deleted: "#7D7678"
  user-bubble: "#242021"
  night: "#080606"
  warning: "#E0A83A"
  success: "#7CC08A"

fonts:
  sans: "Inter (self-hosted from the brand package through next/font/local), system-ui, sans-serif"
  serif: "EB Garamond (self-hosted), Georgia, serif"
  document: "TeX Gyre Bonum (self-hosted), 'Bookman Old Style', Georgia, serif"
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace"

radius: 10px # shadcn --radius (0.625rem); the composer uses 20px

components: "shadcn/ui base-nova blocks and components, assistant-ui registry and examples, as published (sizes, spacing, type scale)"

breakpoints: [768px]
---

# Lexon Design System

| Field | Value |
|---|---|
| **Document** | LEX-DS-001 |
| **Version** | 3.0 |
| **Date** | 14 November 2026 |
| **Companions** | [Technology Stack](./LEXON-01-TECHNOLOGY-STACK.md) · [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md) |
| **Brand source** | [`docs/brand/lexon-2026-v4.1/`](../brand/lexon-2026-v4.1/README.md) (logo, fonts, kit theme) |
| **Visual target** | [`docs/design/f4.1-prototype/`](../design/f4.1-prototype/README.md) (approved 2026-11-13) |

## Rationale

Lexon is a workspace for sustained legal reading and drafting in Indonesia.
Brand v4.1 is quiet and editorial: white pages, ink text, a serif voice for
headlines, and one red (Merah Segel) that is reserved for what matters: the
primary action and anything Lexon flags for the lawyer to check. The interface
should feel like a precise, trustworthy tool and stay quiet while a lawyer
reads a 60-page contract.

**Division of responsibility.**

- The **brand package** (`docs/brand/lexon-2026-v4.1/`) owns the logo files,
  the fonts with their licenses, and the brand palette.
- **This document** owns how the brand maps onto the interface: color tokens
  for both themes, type roles, logo placement, chat layout, the thinking
  indicator, and accessibility.
- **shadcn/ui `base-nova` blocks and components and the assistant-ui registry
  and examples** own component structure, sizes, spacing, and type scale.
  They are used as published and adapted through CSS variables, copy, and
  data wiring, not by resizing or restructuring them. Deliberate exceptions
  are listed here (composer, thread width) and come from an approved
  prototype.

## 1. Visual theme

- **White, ink, and one red.** White and Surface backgrounds, ink text,
  Merah Segel for primary actions, focus, and flagged items only. No
  gradients or decorative illustrations. Shadows are the component's own,
  except the composer's soft elevation (§5.3).
- **Light and dark themes.** Tokens are CSS variables (shadcn/ui convention)
  with one value set per theme. Users choose Light, Dark, or System; System
  is the default. Components never branch on the theme.
- **Dark theme keeps the red fill** for primary buttons (white text 6.65:1);
  red **text** and focus rings use the lighter `#F0646C`.
- **Desktop and tablet first** (≥ 768px). Below 768px, layouts stack and
  remain usable; dense views may show a "best on a larger screen" notice.

## 2. Color

The frontmatter lists every token. They map one to one onto the shadcn/ui
variables of the same name (`--background`, `--card`, `--popover`, `--muted`,
`--border`, `--input`, `--foreground`, `--muted-foreground`, `--primary`,
`--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`,
`--accent-foreground`, `--destructive`, `--ring`, and the `--sidebar-*`
family: `--sidebar`, `--sidebar-primary`, `--sidebar-primary-foreground`,
`--sidebar-accent`, `--sidebar-border` as listed, `--sidebar-foreground` =
`foreground`, `--sidebar-accent-foreground` = `foreground`, `--sidebar-ring` =
`ring`). `--card-foreground` and `--popover-foreground` are `foreground`.
Lexon tokens with no shadcn equivalent use a `--lexon-` prefix
(`--lexon-red-text`, `--lexon-tint`, `--lexon-flag`, `--lexon-deleted`,
`--lexon-user-bubble`, `--lexon-night`, `--lexon-warning`, `--lexon-success`).
Charts (later slices) use Merah Segel, Ink, Muted, `#9A9495`, and `#DDDADA` in
that order.

Measured contrast (WCAG 2.2 relative luminance):

| Pair | Light | Dark |
|---|---|---|
| `foreground` on `background` / `card` / `muted` / `sidebar` | 17.8 / 17.8 / 16.2 / 16.2 | 16.7 / 15.7 / 14.2 / 16.0 |
| `muted-foreground` on `background` / `card` / `muted` / `sidebar` | 5.7 / 5.7 / 5.2 / 5.2 | 7.3 / 6.9 / 6.2 / 7.0 |
| `muted-foreground` on `sidebar-accent` | 4.8 | 5.8 |
| `primary-foreground` on `primary` | 6.65 | 6.65 |
| white on `destructive` fill (Merah Segel Deep, dialog confirm) | 9.1 | 9.1 |
| `red-text` on `background` / `card` / `muted` | 6.7 / 6.7 / 6.1 | 6.1 / 5.7 / 5.2 |
| `red-text` on `tint` | 5.5 | 5.0 |
| `destructive` (error text) on `background` / `muted` | 9.1 / 8.2 | 6.1 / 5.2 |
| `ring` on `background` | 6.65 | 6.1 |
| `warning` on `background` / `card` / `muted` | 6.3 / 6.3 / 5.8 | 8.9 / 8.3 / 7.5 |
| `success` on `background` / `card` / `muted` | 6.4 / 6.4 / 5.8 | 8.8 / 8.3 / 7.5 |
| white / `muted-foreground` (dark) on `night` | 20.2 / 7.8 | 20.2 / 7.8 |

Rules:

- **Red is reserved.** Merah Segel is used only for the primary action on a
  screen, active switches and pressed toggles, focus rings, and items Lexon
  flags for checking. It is never decoration and never a second "danger"
  color.
- **Destructive actions** cannot be told apart by color, because red is the
  primary. Outside dialogs they use `Button variant="outline"` with explicit
  text ("Delete chat"). The confirm button inside the confirmation
  `AlertDialog` uses the `destructive` variant (Merah Segel Deep fill, white
  text) in both themes.
- `border` and `input` are decorative (≤ 2.4:1). Inputs rely on their label
  and the focus ring for the non-text cue.
- Status colors always come with an icon or a label, never color alone.

## 3. Typography

- **Interface and body:** Inter, self-hosted from the brand package through
  `next/font/local` (no runtime request to a font host), with
  `system-ui, sans-serif` fallback.
- **Headlines:** EB Garamond for the new-chat greeting, page titles, auth
  headings and statements, empty-state headlines, and Settings section titles.
  Not for buttons, labels, or body text.
- **Legal quotations:** TeX Gyre Bonum, reserved for quoted legal text and
  document excerpts (F8 onward). Not used in F4.1 screens.
- **Mono:** `ui-monospace, SFMono-Regular, Menlo, monospace` for code,
  aligned clause numbers, and ids.
- All three families ship with their licenses (OFL, GUST) and use a
  `font-display` value that never shows unreadable text.
- Sizes, weights, and line heights follow the shadcn/assistant-ui component or
  block in use. Assistant answers use 16px with line-height about 1.75.

## 4. Brand assets in the interface

- **Never retype "Lexon" in a live font as a logo.** Use the SVGs in the brand
  package through one `LexonLogo` component. The browser `<title>` and
  ordinary sentences in copy may contain the word.
- **Placement:**
  - **Team switcher:** organization initials on the ink tile
    (`sidebar-primary`) with name and member count. The **Personal workspace
    shows the Lexon monogram** in the tile. No wordmark in the sidebar; the
    collapsed (icon) sidebar shows only the tile.
  - **Sign-in and account pages:** the compact wordmark at 128px (ink on
    light, white on dark).
  - **Answers:** the thinking indicator while an answer runs and the static
    monogram next to "Thought for N seconds" when it completes (§5.4). No
    avatar.
  - **Favicon, Apple touch icon, manifest icons:** generated from the
    monogram.
- Keep clear space; never stretch, recolor outside the palette, or add
  shadows to the logo.

## 5. Components, spacing, and layout

- Start every screen from the closest published shadcn `base-nova` block or
  component, or assistant-ui example, and keep its structure, sizes, and
  spacing. Do not hard-code colors; colors come from the tokens.
- Use the component's own variants (`default`, `secondary`, `outline`,
  `ghost`, `destructive`, sizes).
- **Radius:** shadcn `--radius` is `0.625rem` (10px); component radii derive
  from it as shadcn defines. The composer uses 20px.
- **App shell:** shadcn `sidebar-07` in its **inset** form: the content is a
  rounded card on the sidebar canvas, with no hard header border.
  - Sidebar header: the team switcher (§4).
  - Groups: **Tools** with **Assistant** (sub-items New chat and Chats); later
    tools (Tabular Review, Editor) join this group. **Matters** (F6) follows.
    **Recent** lists the six latest chats with a per-chat menu (Rename,
    Delete), then View all chats. Platform keeps its gate.
  - Footer: `NavUser` with name and **job title** (email when no job title).
- **Page header:** pages other than chat keep the sidebar trigger and page
  title. Chat pages have no breadcrumb header (§5.3).
- **Auth layout:** shadcn `login-02` with the form on the left and a **Night
  cover** on the right: a short red rule, the tagline "The AI workspace for
  Indonesian legal practitioners", and an EB Garamond statement.
- New layouts with no published block use the Tailwind spacing scale.
- **Visual target:** a slice that changes UI starts from a prototype the
  product owner approves (current: `docs/design/f4.1-prototype/`). Layout,
  hierarchy, content, and states follow the prototype; component internals
  and sizes follow shadcn/assistant-ui.

### 5.1 UI patterns (required in every slice)

Built from shadcn `base-nova` components; examples in
`docs/design/f2.1-prototype/screens/30-ui-patterns-*.png` (structure and
behavior only; colors and type follow v3.0).

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
- **Destructive actions:** an outline trigger with explicit text, then an
  `AlertDialog` that names the object ("Remove Dewi Lestari from Hukum
  Nusantara?") with a `destructive` confirm button (§2).

### 5.2 Settings

- **One Settings dialog** for personal and organization settings, built from
  the shadcn `sidebar-13` block (a sidebar inside a `Dialog`). It opens from
  the user menu (and Ctrl/Cmd + ,) on any workspace page, closes with the X,
  Escape, or the backdrop, and returns focus to its opener.
- **Sections:** an **Account** group (Profile, Appearance, Security) for
  everyone, then a group named after the active organization when it is a
  team: Members (every role), Invitations (admin and owner), General
  (owner). Section titles use EB Garamond. Profile includes an optional Job
  title (1–80 characters). Later personal settings (memory, connectors, my activity,
  privacy) are added as sections here.
- **State in the URL:** the open dialog and its section are reflected in a
  `settings=<section>` search parameter so a link or a reload reopens it;
  closing removes it. Sections always refer to the **active** organization;
  a section the user's role does not allow shows the no-access state and
  requests nothing.
- **Platform administration** stays a sidebar destination with its own pages.
- Single breakpoint at 768px (shadcn's mobile breakpoint).
- All motion respects `prefers-reduced-motion`.

### 5.3 Chat

- **Chat page chrome:** no breadcrumb header. The sidebar trigger sits at the
  top left. A floating pill at the top right holds **New chat (+)** and
  **chat actions (⋯)** with Rename and Delete (the same flows as the Recent
  menu).
- **New chat:** an EB Garamond greeting with no logo, the composer centered,
  and one row of short starter pills under it with no label. A pill inserts
  an editable template into the composer, focuses the editable part, and
  never sends.
- **Thread:** thread and composer are 880px wide. Assistant answers are
  reading blocks with no bubble and no avatar; user messages sit in a
  `user-bubble` bubble. Citations (F8) render as compact inline markers on
  `tint`.
- **Composer:** elevated (soft shadow, 20px radius), a round send/stop
  button, and the **Deep thinking** pill (`aria-pressed`; pressed: `tint`
  background, `red-text` label). A fade sits above the composer; a
  scroll-to-latest button appears while streaming.
- **Reasoning and status:** "Thought for N seconds" with a collapsible
  reasoning summary, next to the indicator or finished mark (§5.4).

### 5.4 Thinking indicator

One reusable component in the assistant message header (about 20px), drawn in
SVG with a small amount of script, built in-house with no third-party assets.
The prototype README and `fm-strip.png` / `finish-strip.png` show it.

- **Marks:** the Lexon monogram, §, Writing (signature stroke), Paper (page
  with lines), Highlighter (band over lines), Column (courthouse with three
  pillars catching light), ¶.
- **Order:** every round starts with the Lexon monogram (outline draws, then
  fills), then each other mark exactly once in a shuffled order (shuffle bag),
  then a new round.
- **Between marks:** the shape un-writes into about 26 dots that wander for
  10–14 s, switching between randomly chosen patterns (scatter, orbit, swarm,
  spiral, figure-8) every 3.5–5 s with smooth blending, then settle onto the
  next mark, which draws through them. No jumps.
- **Finish:** when the run completes, from any phase, the motion gathers into
  the Lexon monogram (about 3 s) and stops. The static monogram then stays
  next to "Thought for N seconds" on every completed answer, rendered without
  animation for answers loaded later.
- **Labels and timing** follow F4: no "Thought for" without a measured
  duration.
- **Reduced motion:** a static mark only.
- **Accessibility:** the graphic is `aria-hidden`; a polite status text says
  "Thinking" and "Answer complete".
- **Performance:** animation never blocks rendering of streamed text.

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
| 3.0 | **Replaced (product owner, brand kit v4.1 and F4.1 prototype approval, 2026-11-13):** Royal Seal palette by brand v4.1 (White, Ink, Surface, Muted, Line Soft, Merah Segel, Merah Segel Deep, Night, Tint) with a derived dark theme and measured contrast; Georgia by EB Garamond for headlines; TeX Gyre Bonum added for legal quotations; brand source `docs/brand/lexon-2026-v4.1/`. **Added:** red-is-reserved and destructive-action rules (§2); inset shell, Tools/Recent groups, Personal monogram, job title (§4, §5); auth Night cover (§5); chat layout (§5.3); thinking indicator (§5.4). **Changed:** visual target is `docs/design/f4.1-prototype/` |
| 2.2 | **Added (product owner, F4 prototype approval):** chat visual target and workspace navigation (New chat, Chats, Recent) in §5 |
| 2.1 | **Added (product owner, prototype approval):** UI patterns (§5.1: fields and errors, password visibility toggle, pending buttons, form alerts, toasts, empty and loading states, destructive confirmation); one Settings dialog (§5.2, shadcn `sidebar-13`) for personal and organization settings; visual-target rule. **Changed:** logo placement (§4): tile mark in the organization switcher instead of a sidebar wordmark; sign-in pages use the compact wordmark at 128px; brand package v1.1 (more space around the L in marks and icons) |
| 2.0 | **Replaced (product owner, brand package v1.0):** the measured gray palette by the Lexon "Royal Seal" brand (Parchment, Vellum, Mist, Ink, Muted, Seal, Seal Deep, Sage, Midnight, Slate) with a full light/dark mapping onto shadcn variables and measured contrast; status colors re-measured on the new surfaces. **Added:** brand package in `docs/brand/lexon-2026/`; logo usage in the interface (§4); Inter (self-hosted) for the interface and Georgia for headlines (§3). **Changed:** radius token 5px → 10px (shadcn default, matches the brand scale) |
| 1.3 | **Changed (product owner, after F2 visual review):** component structure, sizes, spacing, and type scale come from shadcn/ui `base-nova` blocks/components and assistant-ui examples as published; this document keeps color tokens, fonts, the radius token, themes, and accessibility. Removed: the 8px-grid and 400ms motion rules, 40px/44px control sizes (target size is WCAG 2.2 AA 2.5.8), Lexon type scale for UI, the single-shadow rule, and the rectangular-only radius rule |
| 1.2 | Clarified (F2 design review): the 5px radius applies to rectangular elements; radio indicators, switch thumbs, initials avatars, and status dots stay circular (§4) |
| 1.1 | Dark theme added by product-owner decision (F2): `colors-dark` token set with measured contrast (§2.1); Light / Dark / System selection with System as default (§1). Light values unchanged |
| 1.0 | Adopted from the measured design file with corrections: text and primary moved to near-black; `#8e8ea0` restricted to non-text accent; inverted "text-muted" fixed; added surface, border, focus, status tokens, mono font, spacing scale, reduced motion, and AA as a requirement; components mapped to shadcn/ui `base-nova` and assistant-ui |
