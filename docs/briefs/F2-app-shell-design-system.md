# F2 — App shell & design system

## Goal

Give Lexon its real frame. After F2:
- every signed-in page sits inside one application shell: a left sidebar,
  a main area, and an optional right panel;
- the LEX-DS-001 tokens drive every component, in a light and a dark theme;
- the workspace home is the chat surface, scaffolded from the assistant-ui
  registry and ready for F4 to connect;
- user settings and organization settings live under one consistent URL
  scheme;
- every page has keyboard access, visible focus, and an automated axe check.

F1 built the identity pages with deliberately minimal styling. F2 replaces
that styling and moves those pages into the shell. F2 adds **no new business
capability**: no chat backend, no model call, no new tenant data.

## Users and permissions

| Actor | Can | Cannot |
|---|---|---|
| Visitor | See the auth pages (sign in, sign up, password reset, verify email, two-factor, accept invitation) in the new styling, in either theme | Reach any shell page; the shell never renders without a verified session |
| Signed-in user | Use the shell; switch the active organization from the sidebar; open their own settings (profile, security, appearance); change the theme | See navigation entries for features that do not exist yet |
| Organization **member** | See the organization's settings section with **Members** only | See or open Invitations or General settings |
| Organization **admin** | Members and Invitations | General settings (owner only) |
| Organization **owner** | Members, Invitations, General settings | — |
| **Platform administrator** | A **Platform** entry in the sidebar (provisioning, account status) | — |

Navigation is **presentation only**. Hiding an entry is a convenience; every
page and API call still relies on the backend's checks from F1 (TenantGuard,
role checks, platform-admin checks). Opening a hidden URL directly must give
the same denial as in F1, rendered inside the shell.

## Decisions already made (product owner, 2026-11-01)

1. **Dark mode is in the MVP.** User settings get an **Appearance** page
   with Light, Dark, and System (follows the operating system). LEX-DS-001 is
   revised to v1.1 with dark tokens; LEX-TS-001 is revised to v1.8 to add
   `next-themes` (the approach in shadcn/ui's official Next.js dark-mode
   guide).
2. **Scaffold, don't hand-build.** Build the shell from the shadcn/ui
   `base-nova` **Sidebar** component and its blocks, and the chat surface
   from the assistant-ui registry (`@assistant-ui/thread`,
   `@assistant-ui/thread-list`) and its examples. Restyle them through the
   tokens; do not fork their behavior.
3. **The sidebar shows only destinations that work.** No disabled or
   "coming soon" entries. Each later slice adds its own entries (F4 chat
   history, F6 projects, F7 library, and so on).
4. **The workspace home is the assistant-ui chat scaffold.** F2 shows the
   thread surface (welcome state and composer) and an empty conversation
   list. It does not send messages; F4 connects it to the backend.
5. **URLs are tidied without redirects.** The F1 URLs below have never been
   used outside development, and no email links to them, so the old paths are
   removed, not redirected.

## In scope

### Design tokens and themes

1. All colors come from CSS variables that map the LEX-DS-001 tokens
   (`background`, `surface`, `surface-raised`, `border`, `text`,
   `text-muted`, `primary`, `on-primary`, `accent`, `accent-strong`,
   `focus-ring`, `danger`, `warning`, `success`) onto the variable names
   shadcn/ui and assistant-ui components read (`--background`, `--card`,
   `--popover`, `--muted`, `--sidebar-*`, and so on). The mapping is written
   once in `globals.css`; components never hard-code a color.
   - F1's `globals.css` swaps `surface` and `surface-raised` against
     LEX-DS-001 and omits `accent`, `accent-strong`, and `warning`; F2
     corrects this.
2. Light and dark values for every token come from LEX-DS-001 v1.1. A unit
   test reads the token values from `globals.css` and checks the contrast
   pairs that LEX-DS-001 §2 requires, for both themes.
3. Typography, spacing, radius, and motion follow LEX-DS-001 §3–§5:
   system fonts only (no web font), 8px grid, one 5px radius, one 400ms
   `ease` transition, and `prefers-reduced-motion` turns transitions off.
4. **Theme selection:**
   - Light, Dark, or System, chosen on the Appearance page;
   - System is the default for a new browser;
   - the choice is applied before first paint, so a page never flashes the
     wrong theme;
   - the choice is stored per browser (`next-themes` storage), and it is not
     sent to the backend.

### Application shell

5. Every page in `(workspace)` renders inside one shell:
   - **left sidebar**: product name, organization switcher, navigation, and
     a user menu at the bottom;
   - **main area**: a page header (title, optional actions) and content;
   - **right panel**: an optional slot that pages can open (document viewer,
     sources, details). F2 builds the slot, opens and closes it, and keeps
     its width; no F2 page needs to fill it except a test fixture.
6. The sidebar can be collapsed with a button and with the keyboard
   shortcut the shadcn Sidebar provides. Its collapsed state survives a
   reload. Below 768px (LEX-DS-001's one breakpoint) the sidebar becomes an
   off-canvas sheet that opens from a menu button and closes on navigation
   and on Escape.
7. **Navigation entries in F2:**
   - **Home** (`/workspace`, the chat scaffold);
   - **Settings** for the user;
   - **Organization settings** when the active organization is a team (see
     item 11);
   - **Platform** for platform administrators only.
   The current page is marked in a way that does not rely on color alone.
8. **Organization switcher** in the sidebar header:
   - lists the user's organizations (Personal first, then teams), with
     pagination for long lists as in F1;
   - switching uses F1's server-side switch and the F1 cache-clearing
     transition, then reloads the shell for the new organization;
   - the F1 "enrollment required" result shows its message and leaves the
     current organization unchanged;
   - "Create a team" opens F1's create-team form in a dialog.
9. **User menu:** display name and email, links to Settings, and **Sign
   out**. Sign out keeps F1's behavior (cancel queries, clear the cache,
   sign out, go to `/sign-in`) and shows an error if it fails.
10. **Tenant changes in the background** (F1's 5-second identity refresh and
    `fallbackReason`) still work inside the shell: the switcher updates, the
    fallback notice shows once, and organization pages for an organization
    the user lost access to show F1's "no longer have access" state.

### Settings

11. **URL scheme (old F1 paths are removed):**

    | New path | Replaces (F1) | Who sees it |
    |---|---|---|
    | `/settings/profile` | profile part of onboarding (display name edit) | every user |
    | `/settings/security` | `/account/security` | every user |
    | `/settings/appearance` | — (new) | every user |
    | `/organizations/[orgId]/settings/general` | `/organizations/[orgId]/settings` | owner |
    | `/organizations/[orgId]/settings/members` | `/organizations/[orgId]/members` | member, admin, owner |
    | `/organizations/[orgId]/settings/invitations` | `/organizations/[orgId]/invitations` | admin, owner |
    | `/platform/provisioning`, `/platform/provisioning/[orgId]`, `/platform/accounts` | unchanged paths, now in the shell | platform admin |

    `/settings` opens `/settings/profile`; `/organizations/[orgId]/settings`
    opens `members`. Every in-app link, test, and document that names an old
    path is updated. Auth pages keep their paths (`/accept-invitation` is
    produced by the backend and does not change).
12. **Settings layout:** user settings and organization settings each have
    a section navigation (a vertical list on desktop, a select or tab list
    below 768px). Organization settings show only the sections the user's
    role allows.
13. **Profile page:** edit the display name with F1's profile contract and
    validation. Email is shown read-only with a link to the Security page,
    where F1's change-email flow lives.
14. **Security page:** F1's password, email, two-factor, recovery-code, and
    session features, restyled; no behavior change.
15. **Appearance page:** the theme choice from item 4, as a radio group
    with a visible label and a short preview of each option.

### Chat scaffold (home)

16. `/workspace` shows the assistant-ui thread from the `base-nova`
    registry, restyled through the tokens:
    - a welcome state addressed to the user by display name;
    - a composer that is **visibly disabled**, with the text
      "Chat is not available yet." (no send action, no model call, no
      network request);
    - an empty conversation list in the sidebar area that the assistant-ui
      thread-list component provides, with the empty state
      "No conversations yet.".
17. The runtime behind the scaffold is a local, in-memory assistant-ui
    runtime whose adapter is never called. F2 adds **no** Next.js Route
    Handler, Server Action, AI SDK call, or `/api/chat` endpoint (LEX-ARC-001
    §3.5, §4.1, §4.7). F4 replaces the runtime with the `ChatTransport` and
    adds history entries to the sidebar.
18. Registry components are added with the shadcn CLI and the
    `@assistant-ui` registry already configured in `components.json`. Their
    npm dependencies are pinned exactly in `frontend/package.json`.
    Components or example parts that need features F2 does not have
    (attachments, tool UIs, model pickers, voice) are left out, not stubbed.

### Shared states

19. One set of shared components covers the states every later page needs:
    - **loading** (skeleton or status text with `role="status"`);
    - **empty** (title, one sentence, optional action);
    - **error** (plain message, retry where it makes sense, `role="alert"`);
    - **no access** (F1's 403 view, inside the shell);
    - **session expired / service unavailable** (F1's `SessionBoundary`).
    F1 pages switch to these components. No raw error message or status code
    from the backend is shown to the user (LEX-ARC-001 §6).
20. Next.js `not-found` and `error` boundaries exist for the `(workspace)`
    group (inside the shell) and for the app root (outside it), with a link
    back to Home.

### Auth pages

21. F1's auth pages (`login-02` / `signup-02` based, product-owner choice)
    keep their layout and behavior but use the tokens, both themes, and the
    shared states. F2 replaces F1's minimal auth styling.

### Route protection

22. `proxy.ts` redirects a request without a session cookie to
    `/sign-in?returnTo=…` for **every** shell route: `/workspace`,
    `/settings`, `/organizations`, `/platform`, and `/onboarding`, plus their
    sub-paths. It keeps F1's redirect of `/sign-in` and `/sign-up` to
    `/workspace` when a cookie is present, and F1's `safeReturnPath`. It
    still only checks cookie presence; access decisions stay in the backend
    (LEX-ARC-001 §3.5).

### Contract change

23. The identity summary tells the frontend whether the user is a platform
    administrator, so the shell can show the Platform entry. The backend
    computes it from the same source F1's platform-admin checks use. It is an
    additive change to the `shared/` contract, tested on both sides, and it
    grants nothing: platform endpoints keep their own checks.

### Accessibility and quality gates

24. Playwright with `@axe-core/playwright` (already pinned at the root)
    checks, in **both themes**, with no violations at WCAG 2.2 AA tags:
    sign in, sign up, two-factor, Home, each settings page, each
    organization settings page, and a platform page.
25. Keyboard-only E2E test: from sign-in to Home, open the organization
    switcher, switch organization, open Settings, change the theme, and sign
    out, without a mouse. Focus is visible at each step and returns to a
    sensible element after dialogs and the mobile sheet close.
26. Every page has one `h1`, landmark regions (`nav`, `main`, `aside` for
    the right panel), a skip link to the main content, and a descriptive
    `<title>`.

## Out of scope

- Sending messages, conversation history, model and reasoning selection,
  streaming → **F4**.
- Tool and approval UI → **F5**.
- Projects, project navigation, sharing → **F6**.
- Library, document viewer content in the right panel → **F7**.
- Memory, workflows, quick actions, web research, subagents settings pages
  → **F9–F12**.
- Connectors settings → **F16**.
- "My activity", audit views, usage → **F17**.
- Privacy and data pages, account deletion → **F18**.
- Profile photo or avatar upload (needs object storage) → not planned;
  F2 shows initials.
- Saving the theme choice across devices (backend preference) → not planned.
- Command palette and custom keyboard shortcuts beyond the sidebar toggle →
  not planned.
- Localization: English only (LEX-TS-001 v1.7).

## User flows

1. **First sign-in.** Sign in → F1 onboarding (now styled and inside the
   shell frame, without the sidebar until onboarding is complete) → Home with
   the welcome state and the disabled composer.
2. **Switch organization.** Open the switcher → choose a team → the shell
   reloads; the sidebar shows Organization settings with the sections the
   role allows → open Members.
   - Edge: the team requires 2FA and the user has none → message with a link
     to Security; the current organization is unchanged.
   - Edge: the user is removed from the team while on its Members page → the
     next identity refresh shows F1's "no longer have access" state inside
     the shell, and the switcher shows Personal.
3. **Direct URL without the role.** A member opens
   `/organizations/<id>/settings/invitations` → the shell shows the no-access
   state; no invitation data is requested or shown.
4. **Theme.** Settings → Appearance → Dark → the whole app changes at once,
   with no flash on reload. System follows the operating system and changes
   when the OS setting changes.
5. **Mobile.** At 375px: menu button → sidebar sheet → choose Settings →
   the sheet closes and Settings opens; Escape also closes the sheet.
6. **Signed out.** Open `/settings/security` without a cookie → redirect to
   `/sign-in?returnTo=%2Fsettings%2Fsecurity` → after sign-in, back to
   Security.
7. **Session expired inside the shell.** The backend returns 401 → F1's
   expired-session state with a sign-in link; no stale organization data
   stays visible.

## Data and contracts

- No new tables, migrations, queues, or events.
- `shared/`: the identity summary gains the platform-administrator flag
  (item 23).
- Theme preference: browser storage only, owned by `next-themes`.
- Sidebar collapsed state: the shadcn Sidebar's own cookie. It is a display
  preference, which LEX-ARC-001 §3.5 allows on the frontend.

## Non-functional requirements

- **Security:** the shell never decides access. Hidden navigation entries
  are never the only control. No new endpoint, Route Handler, or Server
  Action for data. The F1 `robots: noindex` and `referrer: no-referrer`
  metadata stay on auth and workspace layouts.
- **Tenancy:** organization settings pages read the organization from the
  backend's identity response, never from the URL alone. Negative tests:
  - a member of org A opening org B's settings URL → denied;
  - a member opening Invitations or General → denied, nothing fetched;
  - an admin opening General → denied;
  - a non-admin opening `/platform/*` → denied.
- **Privacy:** no K1 content in logs or error output (LEX-ARC-001 §6). The
  frontend shows generic messages for backend errors.
- **Performance:** the theme script and sidebar state add no client-side
  network request. Shell navigation between settings pages does not reload
  the whole document.
- **Accessibility:** LEX-DS-001 §6 (WCAG 2.2 AA) for both themes, enforced
  by items 2, 24, 25, 26. Touch targets at least 44×44px.

## Research first

Read these at the pinned versions before brainstorming and before each
planning task (`AGENTS.md`):

- shadcn/ui Sidebar (Base UI): https://ui.shadcn.com/docs/components/base/sidebar
  (append `.md` for markdown) — provider, collapse cookie, keyboard
  shortcut, mobile sheet.
- shadcn/ui blocks (sidebar blocks): https://ui.shadcn.com/blocks
- shadcn/ui dark mode for Next.js: https://ui.shadcn.com/docs/dark-mode/next
- shadcn/ui theming and CSS variables: https://ui.shadcn.com/docs/theming
- `next-themes` README (pin the current release; check React 19 support):
  https://github.com/pacocoursey/next-themes
- assistant-ui installation and registry: https://www.assistant-ui.com/docs/installation.md
- assistant-ui Thread and ThreadList: https://www.assistant-ui.com/docs/primitives/thread.md,
  https://www.assistant-ui.com/docs/primitives/thread-list.md
- assistant-ui CLI templates and examples (default template layout):
  https://www.assistant-ui.com/docs/cli.md, https://www.assistant-ui.com/examples
- assistant-ui `LocalRuntime`: https://www.assistant-ui.com/docs/runtimes/custom/local-runtime.md
- Next.js 16 `proxy.ts`, `not-found`, `error`, layouts and route groups:
  `node scripts/fetch-docs.mjs nextjs`
- Tailwind CSS 4 theme variables and dark variant: `node scripts/fetch-docs.mjs tailwind`
- axe with Playwright: https://playwright.dev/docs/accessibility-testing
- WCAG 2.2 contrast (1.4.3, 1.4.11) and focus (2.4.7, 2.4.11).

Record the verified facts and versions in the superpowers spec's
"Research notes", including every npm package the registry components add.

## Skills to use

- `.agents/skills/`: `shadcn`; the assistant-ui skills (`assistant-ui`,
  `setup`, `runtime`); `playwright-cli` and `vitest` for the tests;
  `karpathy-guidelines` for keeping the change small. The README there lists
  known conflicts with `docs/specs/`.
- No new skill is needed.

## Acceptance criteria

- [ ] All workspace pages render inside the shell; auth pages render outside
      it; both use the tokens in light and dark.
- [ ] Token contrast unit test passes for both themes.
- [ ] Theme: Light/Dark/System work, persist per browser, and do not flash on
      reload (E2E checks the first paint's theme).
- [ ] Sidebar collapses by button and shortcut, keeps its state after reload,
      and becomes a sheet below 768px.
- [ ] Sidebar shows only Home, Settings, Organization settings (team only),
      and Platform (platform admin only).
- [ ] Organization switcher works, including the enrollment-required and
      lost-membership edge cases from F1.
- [ ] New settings URLs work; the old F1 paths return 404; no link in the app
      or docs points to an old path.
- [ ] Role-based section visibility, with negative tests: member → no
      Invitations/General; admin → no General; non-platform-admin → no
      Platform; cross-org URL → denied.
- [ ] `proxy.ts` redirects every shell route without a cookie; unit tests
      cover each prefix and `returnTo`.
- [ ] Home shows the assistant-ui thread with the disabled composer and the
      empty conversation list; a test proves no network request and no
      adapter call happen when the page loads or the composer is focused.
- [ ] No Route Handler, Server Action, or AI SDK call added (lint or test
      check).
- [ ] Shared loading/empty/error/no-access states used by all F1 pages.
- [ ] axe passes on the listed pages in both themes; keyboard-only E2E
      passes.
- [ ] Identity summary platform-admin flag tested in backend and frontend.
- [ ] All F1 tests still pass (updated only for new paths and markup).

## References

- LEX-DS-001 v1.1: §1 visual theme, §2 color (light and dark), §3
  typography, §4 components, §5 layout, §6 accessibility.
- LEX-ARC-001: §3.4 frontend layout, §3.5 frontend–backend boundary and
  `proxy.ts`, §4.1 chat contract (for what F2 must not do), §4.7 one engine,
  §6 privacy.
- LEX-TS-001 v1.9: Next.js 16, shadcn/ui `base-nova` + Base UI,
  assistant-ui, Tailwind CSS 4, `next-themes`, Playwright.
- F1 brief and `docs/references/F1-*.md` for the identity behaviors F2 keeps.

## Open questions

None from the product owner. Brainstorming should settle implementation
choices only (for example, which shadcn sidebar block to start from), and
must ask the product owner before changing any behavior above.
