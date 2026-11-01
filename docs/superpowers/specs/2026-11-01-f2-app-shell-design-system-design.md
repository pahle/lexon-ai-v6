# F2 — App shell and design system

Date: 2026-11-01. Status: proposed for approval; fresh builder check found nothing important left.
Branch: `f2-app-shell-design-system`; never commit to or push `main`.

## Intent and authority

Give signed-in users a consistent frame for legal work and identity management,
with accessible light and dark themes. Replace F1's deliberately minimal
presentation while preserving its authentication, authorization, organization,
security, and platform workflows. Home is an inert assistant-ui scaffold for F4.

Authority: LEX-TS-001 v1.9; LEX-ARC-001 §3.4, §3.5, §4.1, §4.7, §6;
LEX-DS-001 v1.1 §1–§6; `docs/briefs/F2-app-shell-design-system.md`;
F1 approved design and acceptance references. The product owner's conversation
amendments below bind the design. Existing backend checks remain authoritative.

### Goals, non-goals, and failure conditions

- One persistent workspace layout, sidebar, page header, and optional right panel.
- All F1 pages use the corrected design tokens, shared states, and both themes.
- Settings use the brief's new routes and role-based section navigation.
- Preserve five-second identity refresh, fallback, tenant transitions, sign-out,
  pagination, MFA requirements, and all F1 business rules.
- Prove accessibility, theme application before first paint, route protection,
  cross-tenant denial, and absence of chat effects.
- No chat backend, history, models, new tenant data, migrations, queues, events,
  image assets, uploads, command palette, or later-slice navigation.
- No direct Radix imports, new primitive library, panel resizing, or persistent
  panel state. No disconnected actions or decorative placeholders.
- Failure includes stale tenant content after loss of access, treating hidden
  navigation as authorization, bypassing MFA, exposing raw errors, or adding
  unused registry features merely because the generator supplies them.

## Approaches considered and selected

1. **sidebar-07, selected by the product owner.** Its icon collapse, team
   switcher placement, and bottom user menu fit F2. Adapt the owned block to real
   identity data, remove all sample destinations, and compose the optional panel
   separately. This minimizes structural changes while retaining Sidebar behavior.
2. **sidebar-08.** Its inset main surface and secondary navigation require more
   adaptation to Lexon's flat treatment and small destination set.
3. **sidebar-15.** Its two sidebars initially resemble the eventual frame, but
   its persistent calendar area does not match F2's optional page-owned panel.

This is a full slice, with one design and one subsequent implementation plan.
The human declined the visual companion; discussion and review stay in text.

## Current implementation and changes required

F1 has no `(workspace)/layout.tsx`. Individual pages own `<main>`, identity
loading, and metadata. `Workspace` combines polling, switcher, create-team form,
and sign-out. `OrganizationPage` separately polls identity. Security and
platform pages own their queries. `AuthCard` always creates an h1, so a page with
several cards currently risks several h1s. `globals.css` swaps surface and
raised values, lacks several tokens, and has no dark theme. `proxy.ts` protects
only the workspace prefix. The organization-list primitive orders by UUID,
which does not guarantee Personal appears on the first page.

F2 centralizes presentation and identity observation, retains typed clients and
backend policy, and adapts page composition to one main landmark and one h1.
It must not solve presentation by weakening any F0/F1 boundary or lint rule.

## Shell and identity lifecycle

The root layout retains the existing QueryProvider and adds the theme provider.
The `(auth)` layout remains outside the workspace shell. A new persistent
`(workspace)` layout obtains an initial identity through the existing internal
Backend API client, forwarding only the request's cookie as today. Never store
request identity in a process-global singleton or shared cross-request cache.

A client workspace provider owns the existing `['identity']` query, seeded from
that result, with the existing five-second interval and no retries. Shell and
pages consume that shared query instead of adding independent polling loops.
Next layouts persist across navigation; the server seed is not a permanent
access decision. Page/API authorization and client refresh continue to apply.
No protected children or stale tenant payloads render while identity is absent,
being repaired, expired, or invalidated. A service-unavailable refresh error
also hides stale protected content until successful recovery.

- Valid, onboarded identity: sidebar, header, content, optional panel.
- Valid identity with incomplete onboarding: same frame and theme, no sidebar;
  preserve F1 onboarding steps. Home redirects to onboarding as today.
- Identity MFA challenge: preserve F1 verification/recovery links and restricted
  security access. Do not admit the full shell using cookie presence or weaken
  the identity endpoint to make layout initialization succeed. Existing account
  security paths needed to enroll/verify remain usable in the restricted frame.
- 401: unmount protected content, cancel/clear relevant cached data, and use
  SessionBoundary's F1 sign-out/return-path behavior and safe failure message.
- 403: generic no-access or the existing MFA-specific recovery state; no raw
  backend exception crosses into rendered client props.
- Background fallback: suppress old tenant content immediately, await
  `transitionTenant`, update active organization, refresh organization choices,
  and display the existing fallback notice once for that transition. A refetch
  or layout render must not repeat its announcement. A later distinct fallback
  may announce again. Do not add URL, cookie, or backend notice tracking.
- A URL naming a departed organization stays in the shell with F1's no-longer-
  have-access state; it must not silently render the replacement org's members
  under the old URL. Personal becomes the selected organization when F1 says so.

Local section navigation uses Next Link to preserve layout and avoid document
reloads. Explicit organization switching keeps F1's full shell reload to Home
following its server mutation and cache transition.

## Sidebar adaptation

Generate `sidebar-07` through the shadcn CLI in the existing base-nova project.
Keep the Sidebar provider, collapse toggle, keyboard shortcut, cookie-backed
collapsed state, and mobile Sheet behavior. Read the cookie server-side for
initial state so reload does not first paint the wrong sidebar width. Use one
768px boundary for both CSS and the mobile hook, including tests at 767/768px.
Close the mobile sidebar on successful navigation and Escape, retaining the
primitive's focus behavior. Restore focus to its trigger on dismissal; after
navigation, provide a predictable route-heading focus target without fighting
modal teardown. Touch targets are at least 44 by 44px.

Brand is plain text **Lexon**. No logos, sample teams, project navigation,
favorites, subscription labels, support links, or sample keyboard shortcuts.

### Organization switcher

- Real F1 list endpoint and cursor pagination; no eager loading of all teams.
- Personal first, then teams. Always display the label Personal, never the
  personal organization's internal name, including accessible names and errors.
- Guarantee Personal-first ordering across pages at the backend read boundary,
  not by sorting one arbitrary UUID page in the browser. Keep the existing
  public UUID cursor shape: first page prepends the authorized Personal fact;
  subsequent team pages are stable by organization UUID, omit Personal, and
  derive cursor position from the authorized cursor organization. A cursor for
  Personal starts the team portion. No unbounded scan or frontend-only lookup
  of inaccessible organizations. Reuse Better Auth adapter reads; infrastructure
  returns facts and the organization module retains eligibility/policy decisions.
  Cover small limits, Personal UUID sorting late, all page boundaries, and no
  duplicates or omissions. No SQL outside the allowed DB infrastructure.
- A choice invokes F1's server switch, awaits `transitionTenant`, then reloads
  Home. Busy state prevents duplicate switches and hides stale tenant views.
- Enrollment-required response preserves current selection and content and shows
  F1's message with a Security link; no optimistic organization assignment.
- Create a team opens a named Base UI dialog containing F1's form. Successful
  creation refreshes choices; preserve F1's existing selection behavior. Cancel
  makes no mutation; close returns focus to the switcher/create trigger.
- Present pagination as real named controls. Choose a composed popover/dialog
  surface if needed for pagination and form launch; do not put arbitrary buttons
  inside an ARIA menu item. Retain Base UI keyboard/focus behavior.

### Navigation and user menu

Exactly Home (`/workspace`), Settings (`/settings/profile`), Organization settings
(active team only, default Members), and Platform (eligible administrator only,
default `/platform/provisioning`). No future-feature entries. A separate
assistant-ui conversation group may show **No conversations yet.** It is not a
navigation destination, has no New thread button, and has no inert action.

Current navigation uses `aria-current="page"` and a non-color cue such as weight
and an indicator. Nested routes keep the relevant top-level entry identifiable.
Organization sections are Members for all team roles, Invitations for admins
and owners, and General for owners. Platform pages retain working links between
provisioning and account status; these are page-local navigation.

Bottom user menu: initials fallback, display name, email, Settings, Sign out.
No avatar image or extra sample actions. Sign out cancels queries, clears cache,
invokes F1 auth sign-out, and navigates to `/sign-in` only on success. Failure
shows **Unable to sign out. Please try again.** and permits retry. Do not restore
cleared stale tenant data from a local snapshot after failure.

## Optional right panel

Product-owner decisions:

- At widths at least 768px, a named `<aside>` sits next to main content at one
  fixed token width, stable across navigation and open/close. No drag handle,
  resizing dependency, or stored user width.
- Below 768px, use a full-width Sheet built on the same Base UI Dialog primitive
  as the sidebar. It is a named dialog with focus trap, close button, Escape,
  and focus return to its opener. Do not nest an aside landmark inside it.
- Open/closed state belongs to the page. It is not stored in URLs, cookies,
  browser storage, or backend data. Navigating away disposes the page's state.
- Test through a component/E2E-only fixture, never a production route, visible
  placeholder destination, or navigation entry.

Builder call: `--right-panel-width: 320px` (40 grid units), sidebar expanded width
256px. These are presentation tokens, not new business configuration. Main
content uses min-width zero and handles narrow desktop space without page-level
horizontal overflow. A later content-heavy viewer can revise this design.

## Tokens, theming, and component ownership

`globals.css` defines the light/dark LEX-DS-001 values once and maps them onto
all retained shadcn/assistant variables. Canonical surface is #f7f7f8 in light,
raised is #ffffff; dark values come verbatim from v1.1. Cards/popovers map to
raised, sidebar/panels to surface, page to background. Text maps to text;
secondary text to text-muted; inputs/dividers to border; rings to focus-ring;
primary fills to primary with on-primary text. Add warning, success, danger,
accent, and accent-strong mappings. Accent is never body text. Shadcn's accent
surface role must use a safe surface/text pairing rather than copying the brand
accent into text. All sidebar foreground, primary, hover, border, and ring
variables are explicitly mapped; no leftover generator palette.

All retained radius utilities resolve to 5px (including sm/md/lg/xl/full used by
registry parts); remove unused rounded variants rather than leaving pill styles.
No decorative shadows; light overlays may have one subtle shadow, dark overlays
use borders. System fonts only. Apply DS typography, 8px layout spacing (4px
only tight inline gaps), 400ms ease reveals, and zero-duration reduced motion.
Replace generator 200ms/ease-linear defaults. Components consume semantic tokens
without component-local theme color overrides or hard-coded color values.
Secondary button text follows the dark-theme token table's dark foreground,
rather than the light-theme white foreground rule.

Pin `next-themes` **0.4.6** exactly. Root provider uses class attribute,
defaultTheme system, enableSystem, and disableTransitionOnChange; html has the
required hydration-warning suppression. The library's initial script applies
theme before paint, no theme HTTP call or server preference. Appearance renders
a labeled Light/Dark/System radio group with brief CSS-only previews, and delays
selected-value-dependent rendering until mount to avoid hydration mismatch.
System responds to OS changes. Auth and error pages inherit the same token sets.
No new auth-page theme toggle is required by the brief.

Registry output is owned code. Add through CLI, inspect it, trim it, then pin
only retained dependencies exactly. Do not install every advertised dependency
before determining the retained closure. Keep provenance (registry name/style,
CLI version/date and retained files) in research/acceptance notes.

## Home and the assistant-ui boundary

Add thread and thread-list from the configured base-nova assistant-ui registry.
Retain the real Thread/Composer and ThreadList structure needed for the empty
surface. Personalize the welcome state with the display name, rendered as text.
The composer is visibly disabled with **Chat is not available yet.**, no send
control, form submission, suggestions, autofocus stealing, or New thread action.
Use the pinned runtime's disabled/read-only mechanisms and disabled native
controls; prevent Enter/submission as well as pointer activation.

An in-memory `useLocalRuntime` sits in a tenant-keyed client provider so the
sidebar list and Home share runtime context. Its adapter has no network or
model implementation and must never be invoked. Reset runtime on tenant change
and sign-out. Mounting, focusing the composer area, Enter, and attempted submit
must produce zero adapter calls and zero chat/network effects. Existing shell
identity/list traffic is expected and tested separately from isolated scaffold
network assertions. No persistence, Assistant Cloud, or history adapter.

Remove attachments, file/image renderers, tool fallback/group UI, markdown and
reasoning UI, model picker, voice, branch picker, edit/reload, and overflow menu
parts and their imports when unused. Do not replace them with stubs. F4 adds the
features it needs against its approved design. The retained direct runtime
packages stay pinned: @assistant-ui/react 0.15.32, @assistant-ui/ai-sdk 0.0.16,
ai 7.0.159, @ai-sdk/react 4.0.163. No generation API is called.

No chat Route Handler, Server Action, /api/chat endpoint, transport, model client,
or backend business endpoint is added. Existing health route remains allowed.

## Settings, routes, and access

| Route                                                         | Contents and visibility                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/settings/profile`                                           | Display-name form using existing ProfileInputSchema and update API; read-only email with Security link |
| `/settings/security`                                          | Existing password, email, MFA, recovery, reauthentication, and session controls; behavior unchanged    |
| `/settings/appearance`                                        | Browser-only Light/Dark/System choice                                                                  |
| `/organizations/[orgId]/settings/members`                     | Existing Members UI; all team members                                                                  |
| `/organizations/[orgId]/settings/invitations`                 | Existing Invitations UI; admin or owner                                                                |
| `/organizations/[orgId]/settings/general`                     | Existing name/slug/require2fa controls; owner                                                          |
| `/platform/provisioning` and `/platform/provisioning/[orgId]` | Existing provisioning list/detail; platform administrator                                              |
| `/platform/accounts`                                          | Existing account-status controls; platform administrator                                               |
| `/onboarding`                                                 | Existing flow in frame without sidebar until complete                                                  |

`/settings` redirects to Profile; `/organizations/[orgId]/settings` redirects to
Members. That organization root is explicitly retained as an index redirect,
although it formerly hosted General. Removed leaf paths `/account/security`,
`/organizations/[orgId]/members`, and `/organizations/[orgId]/invitations` return
404, with no compatibility redirects. Update links, returnTo values, tests,
and operational documentation. Historical route-migration descriptions may
name old paths as removed examples; do not leave actionable stale links.
Backend `/api/...` routes and verification/invitation email URLs are unchanged.

Settings sections use vertical named navigation on desktop and a labeled select
below 768px (builder call), using client navigation. One page header/h1 and
descriptive title per page. Cards inside pages use h2/h3 via explicit heading
composition; retain h1 for standalone auth cards only. Remove nested main tags.

Before mounting org data queries, require active identity organization ID equals
the URL ID, kind team, and role permits the section. Cross-org URLs never request
that org's protected data. Backend F1 guards independently enforce every direct
HTTP access. Non-admin platform URLs render no-access without mounting platform
data loaders. An identity refresh that lowers a role unmounts the old section
and cancels/removes its cached protected data before another render exposes it.
A client visibility flag is never trusted by the backend.

Extend IdentitySummary v1 with a required boolean `platformAdmin`, projected from
the exact existing VerifiedIdentity predicate: native admin role, enrolled 2FA,
and valid session MFA evidence. It grants no authority and exposes no role table
or credential fields. Tests cover eligible admin, ordinary user, pending setup,
and missing MFA evidence (denied/challenge where existing policy requires it,
never a bypass response solely to publish false). Update fixtures and both
strict-schema consumers together; backend and frontend deploy together in F2.
No new DB read or role model is needed.

Proxy matches exact route roots or slash-delimited descendants for workspace,
settings, organizations, platform, onboarding. Cookie absence redirects with
safeReturnPath and encoded pathname/query. Cookie presence only is a fast hint;
a forged/expired cookie still fails backend identity validation. Preserve auth
entry redirects when cookies exist and all F1 open-redirect defenses. Prefix
lookalikes such as `/settings-example` are not shell routes.

## Shared states and boundaries

Shared loading (status), empty (title/sentence/optional real action), error
(alert and safe retry), and no-access components replace repeated F1 page states.
SessionBoundary remains the lifecycle authority for expired/unavailable sessions,
with a composition mode that avoids nested main landmarks inside the shell.
Recovery-code/token handling and generic account-existence messages are unchanged.

Workspace `error.tsx` and `not-found.tsx` render inside the verified shell with
Home links and safe copy. Root boundaries render outside it. A layout failure
bubbles to the appropriate ancestor/root boundary; same-segment error.tsx cannot
catch its own layout. Cover unmatched authenticated shell-prefix paths with a
scoped not-found strategy so they do not escape to an unrelated root view;
root unknown paths still use the root 404. This is presentation routing only.
No fixture becomes a production destination. Never log/display raw error.message,
error.stack, status codes, or backend detail in fallback UI.

## Dependency and lint policy

LEX-TS-001 v1.9 permits assistant-ui's internal radix-ui dependency. Lexon-owned
source may not import `radix-ui` or `@radix-ui/*` directly, including type-only
imports and re-exports. Add ESLint no-restricted-imports for the exact package,
its subpaths, and the scoped pattern in frontend and the future word-add-in
source glob. Add fixtures that invoke the actual ESLint config and prove those
imports fail while @base-ui/react remains permitted. Existing custom boundaries
and infrastructure-domain rule stay intact. No Radix-dependent registry part is
retained, including the ThreadList overflow menu.

No react-resizable-panels. The expected retained registry dependencies are
existing React, assistant-ui, Base UI, Lucide, clsx/CVA/tailwind-merge and local
shadcn controls; next-themes is the only intended new direct runtime package.
Audit actual CLI output before writing each implementation task, record any
additional retained dependency's exact version and purpose, and stop for a
technology-spec decision if it introduces an unapproved technology. No broad
upgrades of existing packages; one TypeScript 6.0.3 and Zod 4.6.7 remain enforced.

## Verification and acceptance

Use TDD for new behavior and regressions. Keep isolated unit/integration tests
under `pnpm test` and package filters without a prestarted stack; full topology
and browser checks remain `pnpm test:e2e`, both in CI. Reuse F0/F1 ownership and
cleanup, in-process test mail, and production-denied test controls.

1. Parse both CSS theme variable sets, resolve aliases, compare canonical values
   to DS v1.1, and calculate WCAG contrast: normal/muted/status text against
   applicable background/surface/raised (4.5:1), on-primary/primary (4.5:1),
   secondary foreground/fill (4.5:1), focus and applicable non-text accents
   against their actual adjacent surfaces (3:1). Accent cannot become text.
   Do not demand 3:1 from decorative borders exempt under DS; focus supplies
   input's non-text cue. Browser axe complements, not replaces, these tests.
2. Shell tests: shared query lifecycle, identity failures, once-only fallback,
   removal/demotion, cache teardown, full sign-out success/failure sequence,
   switch busy/success/MFA-denied, pagination, Personal label, create-team dialog.
3. Backend/shared/frontend tests for platformAdmin projection and strict schema;
   all negative role/cross-org tests prove both no client fetch and backend
   denial. Test Personal-first cursor pagination with more than one page.
4. Route/proxy tests for every root and descendant, safe return paths, forged
   cookie, old-leaf 404s, index redirects, root/workspace not-found/error views,
   and preservation of MFA/security and onboarding recovery paths.
5. Isolated real-runtime scaffold test spies adapter/fetch, mounts and attempts
   interaction, and proves no chat effect. Static checks reject Server Actions,
   model-generation calls, or new data Route Handlers; lint fixtures reject
   direct Radix imports. Kept library imports still compile on React19/TS6.
6. Compose E2E axe on sign-in, sign-up, challenge, Home, Profile, Security,
   Appearance, General, Members, Invitations, and a platform page in both themes
   with WCAG 2.2 AA tags (include lower-level A/AA tags). Include auth-flow state
   tests and onboarding shared-state coverage. Every page has one h1, landmarks,
   skip link, descriptive title, visible focus, 44px targets, and no overflow.
7. Keyboard-only sign-in to Home, switch team, Settings, theme change, sign-out;
   dialogs/sheets return focus appropriately. Mobile 375px plus 767/768 boundary;
   sidebar button/shortcut collapse, persistence, sheet navigation/Escape.
8. Theme reload tests seed saved preference before navigation, observe the first
   painted frame (not just eventual hydration), cover system default and live OS
   changes, and verify no new theme request. Reduced-motion tests verify zero
   transition duration. Test panel aside/dialog/focus/width via test-only harness.
9. Full F1 regression suite, formatting, lint, typecheck, production build, root
   tests, existing tooling fixtures, and Compose E2E. Do not alter F0/F1 security
   expectations merely to accommodate the new layout.

## Research notes

Read 2026-11-01. Docs are rolling unless versioned below; installed exact package
source/types and npm manifests were checked where API details mattered. The
implementation plan must reverify each task's dependencies and cite these notes.
Downloaded vendor documentation is research cache, not product source. No
third-party legal AI source or brief-generator branch was accessed.

| ID  | Source and version checked                                                                                                                                                                                   | Decision supported                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | shadcn CLI info/search/view/docs in frontend; project base-nova/Base UI, Next16.4.3, Tailwind4; root pinned and live CLI4.23.0; live registry sidebar-07/-08/-15                                             | Chose07; identified sample data and generated files to trim; use existing aliases and registry                                                                                                              |
| R2  | https://ui.shadcn.com/docs/components/base/sidebar.md                                                                                                                                                        | Provider/cookie collapse, keyboard toggle, mobile Sheet; use native behavior, align breakpoint                                                                                                              |
| R3  | https://ui.shadcn.com/docs/dark-mode/next.md and https://ui.shadcn.com/docs/theming.md                                                                                                                       | class ThemeProvider, system default, initial script, hydration suppression and CSS variable mapping; examples do not override Base UI or DS constraints                                                     |
| R4  | https://registry.npmjs.org/next-themes/0.4.6 and https://github.com/pacocoursey/next-themes/tree/v0.4.6                                                                                                      | Exact new pin0.4.6; peers include React19/react-dom19; no runtime dependencies; defer selected UI until mounted; browser storage only                                                                       |
| R5  | https://www.assistant-ui.com/llms.txt ; /docs/installation.md ; /docs/cli.md ; /docs/primitives/thread.md ; /docs/primitives/thread-list.md ; /docs/runtimes/custom/local-runtime.md on same official origin | Runtime/provider and Thread/Composer/list composition; local adapter only runs on generation; no cloud or network adapter; remove send/new/overflow paths                                                   |
| R6  | CLI view @assistant-ui/thread and @assistant-ui/thread-list through configured base-nova registry; @assistant-ui/react0.15.32 installed source/types and real F0 runtime test                                | Current thread generates many out-of-scope imports (attachments/tools/markdown/reasoning/voice); list includes New and Radix-backed overflow. Trim retained closure, do not blindly keep generator features |
| R7  | https://registry.npmjs.org/%40assistant-ui%2Freact/0.15.32                                                                                                                                                   | Confirmed dependencies below; justified product-owner-approved TSv1.9 clarification and direct-import lint guard                                                                                            |
| R8  | https://nextjs.org/docs/app/api-reference/file-conventions/layout.md ; /error.md ; /not-found.md ; /proxy.md ; installed next16.4.3 error-boundary.d.ts                                                      | Persistent layouts need live client identity; root/scoped boundaries; own-layout error exclusion; current retry and reset exist in pinned types; proxy is cookie-presence hint                              |
| R9  | https://tailwindcss.com/docs/theme and https://tailwindcss.com/docs/dark-mode ; installed Tailwind4.3.3                                                                                                      | CSS variable aliases via theme inline and class dark variant; tokens shared by themes rather than local dark colors                                                                                         |
| R10 | https://base-ui.com/react/components/dialog ; installed @base-ui/react1.9.0; shadcn Base Sheet/Sidebar docs                                                                                                  | Same accessible modal primitive for mobile surfaces and create-team dialog; no new primitive library                                                                                                        |
| R11 | https://tanstack.com/query/v5/docs/framework/react/reference/useQuery.md and /guides/query-cancellation.md ; installed5.105.0                                                                                | Shared identity polling, gated data loaders, cancel/remove tenant queries; retain F1 transition behavior                                                                                                    |
| R12 | https://react.dev/reference/react/cache ; installed React/react-dom19.3.1; https://react-hook-form.com/docs/useform (installed7.91.0) and https://zod.dev/api (installed4.6.7)                               | Request-local server work and existing form/schema reuse; no cross-request identity caching or parallel form model                                                                                          |
| R13 | https://playwright.dev/docs/accessibility-testing ; @playwright/test1.64.1, @axe-core/playwright4.14.0; https://vitest.dev/guide/ (installed5.0.5)                                                           | Existing Compose browser/axe and isolated component tests; scans complement keyboard and state tests                                                                                                        |
| R14 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html and /non-text-contrast.html                                                                                                                | Contrast thresholds and decorative-border distinction; actual surface pairs, focus and keyboard assertions                                                                                                  |
| R15 | https://eslint.org/docs/latest/rules/no-restricted-imports ; installed ESLint10.14.0; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html ; installed6.0.3                        | Actual-config rejection fixtures for direct Radix imports; retain pinned toolchain and boundary enforcement                                                                                                 |
| R16 | https://docs.nestjs.com/controllers ; installed Nest12.3.2; F1 identity policy/session/controller and Better Auth1.7.14 adapter primitives                                                                   | Add safe summary projection and bounded organization read ordering only; no new auth policy or SQL path                                                                                                     |

### npm metadata verified for @assistant-ui/react@0.15.32

Dependencies from the versioned npm manifest (R7), also matching the installed
package manifest:

- @assistant-ui/core ^0.3.32; @assistant-ui/store ^0.3.22; @assistant-ui/tap ^0.9.24.
- assistant-cloud ^0.2.9; assistant-stream ^0.3.55; radix-ui ^1.8.1.
- react-textarea-autosize ^8.5.9; safe-content-frame ^0.0.34;
  zustand ^5.0.16; zod ^4.6.7.
- Peers: react/react-dom ^18 or ^19; @types/react and @types/react-dom wildcard.

These are vendor dependency ranges, not proposed Lexon direct dependency ranges.
The lockfile resolves transitives; Lexon direct dependencies remain exact pins.
The internal radix-ui dependency is allowed by the owner's v1.9 clarification;
Lexon-owned menus and sheets use Base UI. No owned registry overflow component
using ThreadListItemMorePrimitive is kept. The manifest's assistant-cloud
presence does not authorize cloud initialization, persistence, or outbound calls.

### Builder calls to review

320px fixed right panel; 256px expanded sidebar; mobile settings section select;
Platform entry opens provisioning; preserve full reload on explicit org switch;
scoped unmatched-route handling stays presentation-only. Detailed file names,
component extraction, and test fixture mechanics are left to planning, bounded
by the behavior and dependency constraints above.
