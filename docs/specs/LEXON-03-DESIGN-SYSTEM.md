---
version: "3.1"
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
  destructive: "#8E1A22" # Merah Segel Deep: error text
  destructive-fill: "#8E1A22" # Merah Segel Deep: confirm button fill in destructive dialogs
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
  destructive: "#F0646C" # error text
  destructive-fill: "#8E1A22" # same fill in both themes; white text 9.1:1
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

components: "shadcn/ui base-nova and assistant-ui for structure, behavior, and accessibility; sizes, spacing, and type scale from the approved prototype (§5.5)"

breakpoints: [768px]
---

# Lexon Design System

| Field | Value |
|---|---|
| **Document** | LEX-DS-001 |
| **Version** | 3.1 |
| **Date** | 18 November 2026 |
| **Companions** | [Technology Stack](./LEXON-01-TECHNOLOGY-STACK.md) · [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md) |
| **Brand source** | [`docs/brand/lexon-2026-v4.1/`](../brand/lexon-2026-v4.1/README.md) (logo, fonts, kit theme) |
| **Visual target** | [`docs/design/f4.1-prototype/`](../design/f4.1-prototype/README.md) (revision 14, approved 2026-11-18) |

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
  and examples** own component structure, behavior, keyboard handling, and
  accessibility. Build every screen from them.
- **The approved prototype** owns what the screen looks like: layout, sizes,
  spacing, type scale, copy, and states. Every screen is built **1:1** with
  its prototype state, adjusting the shadcn and assistant-ui components through
  classes and CSS variables. The page patterns in §5.5 write the prototype's
  measurements down; the prototype file is the reference when a value is not
  listed. Implementers do not design: a screen or state that is not in the
  prototype is added to the prototype first (§5.6).

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
(`--lexon-destructive-fill`, `--lexon-red-text`, `--lexon-tint`, `--lexon-flag`, `--lexon-deleted`,
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
| white on `destructive-fill` (Merah Segel Deep, dialog confirm) | 9.1 | 9.1 |
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
  `AlertDialog` uses the `destructive` variant drawn with `destructive-fill`
  (Merah Segel Deep, white
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
- Sizes, weights, and line heights follow the prototype (§5.5). Type scale:

  | Role | Family | Size / line height | Weight |
  |---|---|---|---|
  | New-chat greeting | EB Garamond | 46px (mobile 32px) | 400 |
  | Auth title | EB Garamond | 36px / 1.1 (mobile 30px) | 400 |
  | Page title (Chats, platform), status title | EB Garamond | 32px / 1.15 | 400 |
  | Settings section title | EB Garamond | 26px | 400 |
  | Auth cover statement | EB Garamond | 44px / 1.15 | 400 |
  | Answer and user message body | Inter | 16px / 1.75 (bubble 1.6); mobile 15px | 400 |
  | Answer heading | Inter | 16px | 600 |
  | Interface text, inputs, buttons | Inter | 14px (large inputs 15px) | 400 / 500 |
  | Descriptions, hints, errors | Inter | 13px | 400 |
  | Group labels, dates, disclaimer, badges | Inter | 12px | 500 / 400 |

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
  component, or assistant-ui example, and keep its structure and behavior;
  set sizes and spacing to the prototype (§5.5). Do not hard-code colors;
  colors come from the tokens.
- Use the component's own variants (`default`, `secondary`, `outline`,
  `ghost`, `destructive`, sizes).
- **Radius:** shadcn `--radius` is `0.625rem` (10px); component radii derive
  from it as shadcn defines. The composer uses 20px.
- **App shell:** shadcn `sidebar-07` in its **inset** form: the content is a
  rounded card on the sidebar canvas, with no hard header border.
  - Sidebar header: the team switcher (§4).
  - Tools, with no group label: **Assistant** (sub-items New chat and Chats);
    later tools (Tabular Review, Editor) join it. **Platform** (sub-items
    Provisioning and Account status) shows only to platform administrators.
    **Matters** (F6) follows. **Recent** is the only labeled group: the six
    latest chats with a per-chat menu (Rename, Delete), then View all chats.
  - Footer: `NavUser` with name and **job title** (email when no job title).
- **Page header:** the sidebar trigger at the top left. Chat pages add a
  divider and the full chat title, plus the floating pill (§5.3). Other pages
  show their title in the page body, not in the header.
- **Auth layout:** shadcn `login-02` with the form on the left and a **Night
  cover** on the right: a short red rule, the tagline "The AI workspace for
  Indonesian legal practitioners", an EB Garamond statement, and the domain.
  One wordmark only, in the form column (§5.5).
- New layouts with no published block use the Tailwind spacing scale.
- **Visual target:** a slice that changes UI starts from a prototype the
  product owner approves (current: `docs/design/f4.1-prototype/`, revision 14).
  Screens are built 1:1 with it and checked as §5.6 requires.

### 5.1 UI patterns (required in every slice)

Built from shadcn `base-nova` components; examples in
`docs/design/f2.1-prototype/screens/30-ui-patterns-*.png` (structure and
behavior only; colors and type follow v3.0).

- **Fields:** `Field` + `FieldLabel` + control + `FieldDescription` /
  `FieldError`. Validation runs on submit, then live for fields already
  touched. An invalid field sets `aria-invalid` and `data-invalid` on the
  Field: the border and the error text turn red (`destructive`), and the
  label stays ink. The error text is linked with
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

- **Chat page chrome:** the sidebar trigger at the top left, then a divider
  and the **full chat title** (truncated with an ellipsis only when it does
  not fit), on desktop and mobile. A floating pill at the top right holds
  **New chat (+)** and **chat actions (⋯)** with Rename (a dialog) and Delete
  (an alert dialog), the same flows as the Recent menu.
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
- **Answer actions:** icon-only buttons (Copy, Good response, Bad response,
  Regenerate) with a tooltip and `aria-label`; Copy turns into a check with
  "Copied". Feedback confirms with a toast.
- **Stopped, reconnecting, failed:** a stopped answer keeps its partial text
  and ends with the status line "You stopped this response."; a dropped
  stream shows "Connection lost. Reconnecting…" with a wifi icon; a failure
  shows one error row with "The response could not be completed." and Try
  again.
- **Editing a message:** the message becomes an edit box with Cancel and Save
  below it, right-aligned; the answers after it are muted until saved.

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

### 5.5 Page patterns (required in every slice)

Every page uses one of these patterns. Values are measured from the approved
prototype (revision 14) at 1440×900 and 390×844; a value not listed here is
read from the prototype source. Colors are tokens (§2). "Mobile" means below
768px.

**Shell**

- Canvas `sidebar`. Sidebar 256px wide, padding 8px, item gap 4px; collapsed
  (icon) 49px. Mobile: hidden; a `Sheet` 300px wide opens from the left over
  an `overlay`.
- Switcher and user rows 48px high. Tile and avatar 32px, radius 8px, 12px
  semibold initials; the avatar sits on `sidebar-accent`.
- Nav item 32px high, radius 6px, padding 0 8px, 14px; active and hover
  `sidebar-accent`, active weight 500. Sub-items 28px, indented by a 1px
  `sidebar-border` line (margin-left 15px, padding-left 10px).
- Group label ("Recent" only): 12px, weight 500, `muted-foreground`, padding
  14px 8px 6px. Empty Recent: "No chats yet." 13px `muted-foreground`.
- Content card: margin 8px 8px 8px 0, radius 12px, `background`, a 1px
  `border` ring plus `0 1px 3px rgba(8,6,6,.04)`. Mobile: full screen, no
  margin, radius, or ring.

**Header**

- 52px high (mobile 56px), padding 0 14px (mobile 0 10px). Sidebar trigger:
  icon button 28px, radius 6px.
- Chat pages: a 1×16px `border` divider, then the chat title (14px,
  `foreground`, one line, ellipsis). Right: the floating pill (padding 3px,
  fully round, `background`, a 1px `border` ring plus
  `0 4px 12px -6px rgba(8,6,6,.18)`) with two 28px round icon buttons. Its
  menu opens 6px below, right-aligned, 180px wide; Delete uses `red-text`.
- Chats, status, and platform pages: the trigger only.

**Chat thread**

- Thread and composer max 880px, thread padding 24px 24px 40px, 32px between
  turns. Mobile: padding 16px 16px 0, 22px between turns.
- User bubble: `user-bubble`, radius 20px, padding 12px 18px, 16px / 1.6, max
  80% wide (mobile 88%), right-aligned.
- Answer: 16px / 1.75 (mobile 15px), 12px gap between blocks; paragraphs and
  lists 8px bottom margin, list indent 22px, list items 3px apart; headings
  16px semibold with 6px above and 4px below.
- Answer header: 20px mark, 8px gap, 14px `muted-foreground` label with a
  14px chevron.
- Action row: 32×32px icon buttons, radius 8px, 16px icons, 2px apart,
  aligned to the text edge (margin-left −8px); tooltip 12px on `foreground`
  above the button. Pressed or copied: `red-text`.
- Status line (stopped, reconnecting): 16px / 1.6 `muted-foreground`, 18px
  icon, 8px gap.
- Error row: `muted` with a 1px `border`, radius 12px, padding 10px 10px 10px
  14px, 15px text, 12px gap, outline Try again at the right.
- Edit box: radius 16px, padding 14px 16px, `ring` border plus a 3px ring at
  18%; Cancel (outline) and Save (primary) 10px below, right-aligned, 8px
  apart; later answers in `muted-foreground`.
- Thread loading: skeletons (a 44px bubble at 55% width, then four 12px
  lines) and the normal composer, disabled.
- Scroll-to-latest: 36px round button, centered, 150px above the bottom
  (mobile 136px).

**Composer**

- Wrapper padding 0 24px 14px (mobile 10px 14px 12px); a 40px fade above it
  on thread pages.
- Box: radius 20px, 1px `border`, padding 16px 14px 12px 16px, 10px gap,
  shadow `0 10px 30px -14px rgba(8,6,6,.22), 0 2px 6px -2px rgba(8,6,6,.06)`.
  Text 16px, minimum 56px tall.
- Deep thinking pill 32px high, fully round, padding 0 10px, 13px weight 500.
  Send and stop: 36px round `primary`; disabled send at 40% opacity.
- Disclaimer 12px `muted-foreground`, 8px below, centered.
- New chat: greeting (§3), composer, and starter pills stacked with 22px gaps,
  centered with 80px extra space below. Starter pills: 14px, padding 8px
  14px, fully round, 1px `border`, 8px apart, one row (wrapping on mobile).
  The chosen pill shows `foreground` border on `muted`; its template appears
  in the composer with each placeholder on `muted`, radius 4px.

**Auth pages**

- Two equal columns. Left: `sidebar` background, padding 40px, the compact
  wordmark (128px) top left; the form block (max 400px wide, 20px gaps) is
  centered in the remaining height. Right: the Night cover, padding 48px, the
  rule (40×2px) and tagline at the top, the statement (§3, max 520px), the
  domain (13px) at the bottom right. No second wordmark.
- Mobile: one column on `background`, padding 28px 20px, wordmark centered
  at the top, 40px gap, form block full width.
- Title block: title (§3) and description (15px / 1.55 `muted-foreground`)
  10px apart. No icon above the title.
- Inputs 44px high, 15px, radius 8px, padding 0 14px. Primary button 40px,
  full width. Secondary links ("Back to sign in", "Use a recovery code"):
  14px weight 500 `muted-foreground` with a 16px arrow or icon, centered.
- Form alert (wrong credentials): `flag` with a 1px `red-text` border, radius
  10px, padding 12px 14px, 16px alert icon, 14px / 1.5 text, above the
  fields.
- Pending: inputs disabled at 60% opacity; the button keeps its width and
  shows a 16px spinner and "Signing in…".
- Two-step code: six slots in one row, 56px high, 8px apart, radius 10px,
  22px digits; the active slot has the focus ring.
- Invitation card: 1px `border`, radius 12px, padding 16px; organization tile
  40px; details as a two-column list (labels `muted-foreground`).
- Onboarding steps: 28×4px bars, the done ones `foreground`, "Step N of 2"
  13px.

**Status pages** (not found, organization not found, workspace error, no access)

- Centered stack, max 440px wide, 12px gaps, shifted up by 120px of bottom
  padding. Icon tile 56px, radius 14px, `muted`, 24px icon. Title (§3), one
  sentence 15px / 1.55 `muted-foreground`, a 40px primary button, and an
  optional secondary link. Inside the shell when the user is signed in; the
  standalone not-found page shows the wordmark at the top left (centered on
  mobile).

**List pages** (Chats)

- Column max 768px, padding 28px 24px (mobile 20px 16px), 14px gaps. Title
  (§3) with the primary New chat button on the same line; a 36px search input
  with a 16px icon at 12px.
- Rows: padding 12px, radius 10px; title 14px weight 500; date 12px
  `muted-foreground`; search snippets 13px / 1.5 with matches highlighted (light `tint`; dark #4A1E23, as in the prototype).
  Date group labels 12px weight 500.
- Loading: a skeleton row per item (title 40–70% wide, date 52px). Empty and
  no results: the `Empty` pattern (40px icon tile radius 10px, 16px semibold
  title, one sentence, one button).

**Settings dialog**

- Fixed 1000×680px whatever the section, radius 12px. Header 56px with
  "Settings" (16px semibold) and the close button. Navigation 240px on
  `sidebar`, padding 12px, group labels as the shell. Body padding 28px 32px,
  scrolling inside.
- Section: title (§3), description 13px `muted-foreground`, then rows (padding
  16px 0, 1px `border` below): label 14px weight 500 with a 13px description
  on the left, control on the right (inputs 280px × 36px). Save at the bottom
  right.
- Members and invitations: rows of avatar (32px), name and email, role
  control, and actions. Sessions: device icon tile (36px, radius 10px),
  device name ("Chrome on macOS"), location and last activity, "This device"
  badge, Sign out.
- Mobile: a full-screen sheet; 56px header with back, section name, and
  close; body padding 20px 16px; rows stack the control under the label
  (switches and single buttons stay on the right).

**Dialogs, menus, toasts**

- Dialog 440px wide (mobile: screen width minus 32px), padding 24px, radius
  12px; title 18px semibold; text `muted-foreground` / 1.5; buttons
  right-aligned, 8px apart, 16px above. Destructive confirm uses
  `destructive-fill`.
- Menus: radius 8px, padding 4px, items 32px, radius 4px, 14px with 16px
  icons.
- Toast: top right, 20px from the top and 24px from the right, 320px wide,
  radius 10px, padding 12px 16px, 14px with a check icon. Mobile: 12px from
  both sides. Never over the composer.

**Platform pages**

- Column max 880px, padding 28px 24px 40px, 24px gaps; title (§3) and a 14px
  description. Cards: 1px `border`, radius 12px, padding 20px, 16px gaps;
  card title 16px semibold with a 13px description. Fields 36px in two
  columns (one on mobile); actions right-aligned.
- Tables: 1px `border`, radius 12px; header row 40px on `muted`, 13px weight
  500; rows 56px; status as badges (warning badges in `red-text`); a chevron
  opens the detail. Mobile: each row stacks its cells. Loading, empty, and
  error use the skeleton, `Empty`, and error-row patterns.

**Controls**

- Buttons 32px (small 30px, large 40px), radius 8px, padding 0 12px, 14px
  weight 500. Inputs 36px (auth 44px), radius 8px, padding 0 12px. Badges
  20px, fully round, 12px weight 500. Switch 36×20px. Skeleton lines 12px,
  radius 6px, `muted` (`sidebar-accent` inside the sidebar).

### 5.6 Prototype fidelity (required in every slice that changes UI)

- **One state per capture.** The visual capture ids of a slice and the state
  names in its prototype are the same list. A screen or state without a
  prototype state is added to the prototype and approved before it is built.
- **Same content.** Visual fixtures use the prototype's data (names,
  organizations, chats, dates) so captures and prototype states can be
  compared directly.
- **Comparison sheets.** For every capture id, viewport (1440×900,
  390×844), and theme, the slice produces a sheet with the prototype state,
  the capture, and a difference overlay, rendered in the same browser with
  the same fonts, and reports the share of differing pixels. Animated parts
  (thinking indicator, caret, spinners) are masked.
- **Gate.** A sheet over 1.5% differing pixels fails. It is fixed, or listed
  in the slice's `deviations.md` with the reason and approved by the product
  owner before the goldens are locked. Review happens on the sheets, not on
  captures alone.

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
| 3.1 | **Changed (product owner, F4.1 visual review round 4, 2026-11-18):** the approved prototype now owns sizes, spacing, and type scale, and screens are built 1:1 with it; shadcn/ui and assistant-ui keep structure, behavior, and accessibility (rationale, §3, §5). This reverses the sizing rule of 1.3. **Added:** type scale (§3); page patterns with measured values (§5.5); prototype fidelity gate with comparison sheets (§5.6); chat title in the header, icon-only answer actions, status lines, error row, edit box (§5.3); Platform group in the sidebar. **Removed:** the "Tools" group label. Visual target: `docs/design/f4.1-prototype/` revision 14 |
| 3.0.2 | **Changed (product owner, F4.1 visual review, 2026-11-17):** invalid field labels stay ink; only the border and the error text are red (§5.1), as in the approved F4.1 prototype, for every form |
| 3.0.1 | **Added (product owner, F4.1 spec review, 2026-11-15):** `destructive-fill` token (`--lexon-destructive-fill`, Merah Segel Deep in both themes) for the confirm button of destructive dialogs, since the dark `destructive` token is the lighter error-text red |
| 3.0 | **Replaced (product owner, brand kit v4.1 and F4.1 prototype approval, 2026-11-13):** Royal Seal palette by brand v4.1 (White, Ink, Surface, Muted, Line Soft, Merah Segel, Merah Segel Deep, Night, Tint) with a derived dark theme and measured contrast; Georgia by EB Garamond for headlines; TeX Gyre Bonum added for legal quotations; brand source `docs/brand/lexon-2026-v4.1/`. **Added:** red-is-reserved and destructive-action rules (§2); inset shell, Tools/Recent groups, Personal monogram, job title (§4, §5); auth Night cover (§5); chat layout (§5.3); thinking indicator (§5.4). **Changed:** visual target is `docs/design/f4.1-prototype/` |
| 2.2 | **Added (product owner, F4 prototype approval):** chat visual target and workspace navigation (New chat, Chats, Recent) in §5 |
| 2.1 | **Added (product owner, prototype approval):** UI patterns (§5.1: fields and errors, password visibility toggle, pending buttons, form alerts, toasts, empty and loading states, destructive confirmation); one Settings dialog (§5.2, shadcn `sidebar-13`) for personal and organization settings; visual-target rule. **Changed:** logo placement (§4): tile mark in the organization switcher instead of a sidebar wordmark; sign-in pages use the compact wordmark at 128px; brand package v1.1 (more space around the L in marks and icons) |
| 2.0 | **Replaced (product owner, brand package v1.0):** the measured gray palette by the Lexon "Royal Seal" brand (Parchment, Vellum, Mist, Ink, Muted, Seal, Seal Deep, Sage, Midnight, Slate) with a full light/dark mapping onto shadcn variables and measured contrast; status colors re-measured on the new surfaces. **Added:** brand package in `docs/brand/lexon-2026/`; logo usage in the interface (§4); Inter (self-hosted) for the interface and Georgia for headlines (§3). **Changed:** radius token 5px → 10px (shadcn default, matches the brand scale) |
| 1.3 | **Changed (product owner, after F2 visual review):** component structure, sizes, spacing, and type scale come from shadcn/ui `base-nova` blocks/components and assistant-ui examples as published; this document keeps color tokens, fonts, the radius token, themes, and accessibility. Removed: the 8px-grid and 400ms motion rules, 40px/44px control sizes (target size is WCAG 2.2 AA 2.5.8), Lexon type scale for UI, the single-shadow rule, and the rectangular-only radius rule |
| 1.2 | Clarified (F2 design review): the 5px radius applies to rectangular elements; radio indicators, switch thumbs, initials avatars, and status dots stay circular (§4) |
| 1.1 | Dark theme added by product-owner decision (F2): `colors-dark` token set with measured contrast (§2.1); Light / Dark / System selection with System as default (§1). Light values unchanged |
| 1.0 | Adopted from the measured design file with corrections: text and primary moved to near-black; `#8e8ea0` restricted to non-text accent; inverted "text-muted" fixed; added surface, border, focus, status tokens, mono font, spacing scale, reduced motion, and AA as a requirement; components mapped to shadcn/ui `base-nova` and assistant-ui |
