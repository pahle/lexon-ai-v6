# F2 App Shell and Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The product owner selected fresh implementation subagents on gpt-6-luna with high reasoning effort; the main session reviews spec compliance, then code quality, for each task and owns the final whole-branch review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give F1 one accessible themed application shell, reorganized settings, and an inert assistant-ui Home, without changing identity business rules.

**Architecture:** A persistent workspace layout seeds one live identity query; page data remains guarded by backend policy and client query gates. Adapt shadcn base-nova sidebar-07 and assistant-ui registry components, mapping their presentation to LEX-DS-001. The optional panel is controlled by its page, fixed-width on desktop and a Base UI modal sheet on mobile.

**Tech Stack:** Existing Next16.4.3, React19.3.1, TypeScript6.0.3, Zod4.6.7, Tailwind4.3.3, Base UI1.9.0, TanStack Query5.105.0, assistant-ui/react0.15.32, Vitest5.0.5, Playwright1.64.1/axe4.14.0; add next-themes0.4.6 exactly.

**Spec:** [Approved design](../specs/2026-11-01-f2-app-shell-design-system-design.md), amended 2026-11-01, plus F2 brief and LEX-TS-001 v1.9 / LEX-DS-001 v1.2. Design amendment commit: `f9652b3`.

## Global Constraints

- Work on `f2-app-shell-design-system`, never main. Use one fresh implementation subagent per task with explicit model `gpt-6-luna`, reasoning effort `high`, and no inherited conversation history. Main session performs the per-task spec-compliance gate followed by the code-quality gate; this owner instruction overrides the skill default of dispatching a separate task reviewer. Main session owns final whole-branch review before handoff.
- No production code before a meaningful failing test. Record RED/GREEN commands and actual results; setup failures are not valid behavioral RED evidence.
- Every task is independently verified and committed. Preserve existing branch/review conventions; do not merge without instruction.
- English only; no hard-coded component colors, web fonts, logos, sample navigation, or placeholder actions.
- One 5px radius for rectangular elements. Only radio indicators, switch thumbs, initials avatars, and status dots may use rounded-full. No pill buttons, badges, or inputs.
- One 768px breakpoint, 400ms ease transitions, zero duration under reduced motion; 44px minimum touch targets.
- Desktop right-panel width320px; expanded sidebar256px. No resizing or react-resizable-panels. Panel state is page-owned and unpersisted.
- Mobile settings use the same real-link component as desktop; only layout changes. No navigation on select/input change; aria-current on active link; no page-level horizontal overflow.
- `sidebar_state` is a frontend display preference only. Backend code never reads it and access never depends on its value.
- Personal-first ordering preserves F1's public list response and UUID cursor shape. Extend F1 pagination tests; never weaken their actor binding, limits, or audit/selection assertions.
- Backend checks remain authoritative. No new public endpoint, auth model, DB table/migration, queue/event, business Route Handler, Server Action, or model/chat call.
- Lexon never directly imports radix-ui or @radix-ui/*; assistant-ui's internal transitive radix-ui is allowed. Keep no Radix-dependent registry parts, including the thread overflow menu.
- Exact direct dependency pins and lockfile; retain all existing TS/Zod workspace overrides and boundary rules, including infrastructure-domain.
- Isolated tests remain self-starting `pnpm test`/package filters. Browser/topology tests remain `pnpm test:e2e`; both run in CI with existing cleanup and in-process mail.
- Before each task reread its cited Research notes and current official pages at installed versions; inspect generated files before retaining dependencies. Stop for an owner decision if new facts conflict with locked specs.

## Codex subagent configuration and verification

Official source, read 2026-11-01: [Subagents — choosing models and reasoning](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning), reached from https://developers.openai.com/codex/subagents. It documents explicit spawn overrides, inheritance when omitted, model gpt-6-luna, and reasoning configuration. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes config-file model_reasoning_effort; no global configuration edit is needed here.

Installed Codex CLI/version environment: **0.166.0**. This session's collaboration.spawn_agent tool exposes `model` and `reasoning_effort`; set both explicitly with `fork_turns:"none"`:

```json
{ "model": "gpt-6-luna", "reasoning_effort": "high", "fork_turns": "none" }
```

A no-edit probe `/root/f2_model_probe` completed. Its authoritative local rollout
metadata (thread `01a1979b-0e8d-7b32-b1fd-c3f8dedc69ff`) recorded turn_context
`model:gpt-6-luna`, `effort:high`, cli_version0.166.0. This verifies the
runtime selection independently of the agent's self-report. Inspect equivalent
safe metadata for each implementation thread before accepting its work. If the
model/effort cannot be selected and verified, stop and tell the product owner;
never substitute another model or rely on inherited defaults. Keep model
verification details in the task ledger; do not copy credentials or raw session
history into repository documents.

## Review Focus

1. A delayed old-org response arriving after removal/switch must not repaint old tenant data — Task7 deferred-response tests and Task12 real-browser regression.
2. Personal sorts last by UUID or a page limit is1 — Task3 full traversal tests must still show Personal first, then every team exactly once.
3. A user needs Security to complete MFA while normal identity bootstrap rejects them — Tasks7/10 preserve restricted recovery without exposing shell data.
4. Theme script must work with all Next static scripts blocked — Task12 deterministic pre-hydration tests, never timing/frame guesses.
5. A menu/dialog opener unmounts during navigation or a mobile breakpoint changes while open — Tasks8/9 focus and resize tests keep focus usable and avoid duplicate modal/aside content.

## File Structure and Interfaces

Follow existing F1 clients, test renderer, integration fixture, and Compose browser harness. New shell files live under `frontend/src/components/shell/`; settings under `components/settings/`; shared presentation states under `components/states/`. Generated shadcn controls stay in `components/ui/`, assistant registry files in `components/assistant-ui/elements/`. No shell business-policy module.

- `lib/workspace-bootstrap.ts`: request-local safe bootstrap union, using existing server identity client.
- `shell/workspace-provider.tsx`: one identity query and transition lifecycle; exports WorkspaceProvider and useWorkspace.
- `shell/workspace-shell.tsx`: verified frame, sidebar slot, one main, panel host, recovery/onboarding composition.
- `shell/page-header.tsx`: page h1/actions and route title/focus target.
- `shell/app-sidebar.tsx`, `organization-menu.tsx`, `user-menu.tsx`: adapted sidebar-07 with real F1 actions.
- `shell/right-panel.tsx`: controlled panel rendered into frame's desktop host or mobile Sheet.
- `settings/section-navigation.tsx`, `profile-settings.tsx`, `appearance-settings.tsx`: links and existing-contract forms.
- `theme-provider.tsx`: thin next-themes wrapper.
- `states/page-states.tsx`: shared presentation, no main ownership.
- `shell/chat-runtime-provider.tsx`: tenant-keyed local runtime; trimmed registry Thread and ThreadList share it.
- `scripts/eslint/lexon-presentation.mjs`: narrowly scoped rectangular/circular shape guard, integrated into existing local plugin/config; no generic design-system framework.
- Existing `shared/src/auth.ts`, identity summary projection, and organization-list read primitive receive only the documented additive/read-order changes.

---

### Task 1: Enforce owned UI dependency and shape rules

**Research:** R7/R15; re-read ESLint no-restricted-imports and TS parser JSX APIs before this task. Inspected exact assistant-ui0.15.32 npm metadata; no library upgrade.

**Files:** Modify `eslint.config.mjs`, `scripts/eslint/lexon-boundaries.mjs` only to register a separate presentation rule if needed, `scripts/check-boundaries.mjs`; create `scripts/eslint/lexon-presentation.mjs`, `scripts/test/presentation-policy.spec.mjs`.

**Interfaces:** Existing boundaries remain unchanged. Export `presentationRules` as ESLint rules; `lexon/circular-shape` reports forbidden rounded-full usage. no-restricted-imports applies to frontend and word-add-in source/test globs, with `paths: ['radix-ui']` and patterns covering `radix-ui/*`, `@radix-ui/*`.

- [x] **Step1 — Write failing actual-config fixtures.** Lint import/re-export/type-only forms for radix-ui and @radix-ui/react-dialog; assert ruleId no-restricted-imports, and permit @base-ui/react. Shape fixtures permit explicit radio indicator/switch thumb/initials avatar/status-dot slots, reject rounded-full on button, input, badge, and arbitrary div. Keep this rule small: allowlist semantic slots and their owning control files; cover static JSX className strings and cva base/variant strings only. Do not build a general cn/class-variable/arbitrary-radius analyzer. Fixed slots must belong to radio indicators, switch thumbs, initials avatars, or status dots; an attribute on a button is not an exemption. Document dynamic-expression coverage limits in F2-acceptance.

```js
assert.equal(
  messages.some((m) => m.ruleId === 'no-restricted-imports'),
  true,
);
assert.equal(
  shapeMessages.some((m) => m.ruleId === 'lexon/circular-shape'),
  true,
);
assert.equal(allowedMessages.length, 0);
```

- [x] **Step2 — RED:** `node --test scripts/test/presentation-policy.spec.mjs`; expect behavioral failures because restrictions are absent.
- [x] **Step3 — Implement policy.** Use existing typescript-eslint AST support for static JSX className and cva base/variant strings plus a small semantic-slot/file allowlist. Stop at that bounded coverage; do not expand into general class evaluation. Keep scope to owned code; no scanning vendor node_modules. Wire fixture command into existing check-boundaries runner so root/package lint and CI run it. Do not ban the allowed internal dependency in lockfile.
- [x] **Step4 — GREEN:** rerun fixture command and `node scripts/check-boundaries.mjs`; all existing boundary fixtures and new policy fixtures pass. Inspect existing owned source for violations and fix only actual shape violations, with tokens unchanged until Task2.
- [x] **Step5 — Commit:** stage only the changed config, rule, fixtures, runner, and any existing owned shape violations; commit `chore(ui): enforce Base UI imports and semantic circular shapes`.

### Task 2: Correct tokens and normalize existing controls

**Research:** R3/R9/R14; re-read theming, Tailwind theme variables, WCAG contrast and DSv1.2 before writing tests.

**Files:** Modify `frontend/src/app/globals.css`, existing `frontend/src/components/ui/{button,card,input,input-otp,field}.tsx` and auth presentation as required; create `scripts/test/design-tokens.spec.mjs`; extend `scripts/check-boundaries.mjs` to run token checks with other presentation fixtures.

**Interfaces:** CSS exports canonical theme tokens plus shadcn aliases; `--right-panel-width:320px`, `--sidebar-width:256px`, rectangular radius5px. No JS color constants. Token test uses node:fs and parses actual CSS variable sets; browser tests consume computed styles later.

- [x] **Step1 — Write failing token/contrast tests.** Read both :root and .dark sets, resolve var aliases, compare all DSv1.2 values (not just chosen colors). Assert surface light #f7f7f8/raised #ffffff; dark background #121214; all required aliases resolve. Text/muted/status vs applicable surfaces >=4.5, button text/fill >=4.5, focus and actual non-text accent adjacencies >=3. Assert rectangle radius5px; circular exceptions retained. Check no web-font import and reduced-motion duration0ms.

```js
assert.equal(light.surface, '#f7f7f8');
assert.equal(dark.background, '#121214');
assert.ok(contrast(light.text, light.surface) >= 4.5);
assert.equal(tokens.rightPanelWidth, '320px');
```

- [x] **Step2 — RED:** `node --test scripts/test/design-tokens.spec.mjs`; expect missing dark/mismapped surface assertions, not missing harness dependencies.
- [x] **Step3 — Implement mapping and control normalization.** globals.css owns values and aliases, including sidebar, popover, warning/success, accent-strong and safe foreground pairs. One5px rectangular scale, semantic circular controls, flat cards, overlays-only light shadows, dark overlay borders, system fonts, grid spacing, 400ms ease and reduced motion. Existing controls meet44px target and visible focus without per-component color literals. Avoid white secondary-button text in dark theme.
- [x] **Step4 — GREEN:** token command, presentation-policy fixtures, `pnpm --filter @lexon/frontend test`, `pnpm --filter @lexon/frontend typecheck`; all pass. Browser contrast verification belongs to Task12.
- [x] **Step5 — Commit:** stage only Task2 CSS/controls/checks; commit `feat(ui): apply Lexon light and dark design tokens`.

### Task 3: Publish safe platform flag and Personal-first cursor traversal

**Research:** R7/R12/R16 plus installed Better Auth1.7.14 adapter findOne/findMany; reread F1 organization-list service/primitive and pagination tests before modifying them. No new auth API assumption.

**Files:** Modify `shared/src/auth.ts`, `shared/test/auth.spec.ts`, `backend/src/modules/identity-access/identity-session.service.ts`, `backend/src/modules/organizations/organization.service.ts`, `backend/src/infrastructure/db/auth/organization-plugin.ts`, `backend/test/integration/organizations.spec.ts`, `backend/test/integration/identity-read-paths.spec.ts`, `frontend/test/identity-client.spec.tsx`; update existing IdentitySummary fixtures across shared/backend/frontend.

**Interfaces:** IdentitySummarySchema adds required `platformAdmin:z.boolean()` at top level; projection uses existing VerifiedIdentity eligibility, never a client claim. Existing list(input:Partial<Pagination>):Promise<Page<OrganizationSummary>> and UUID nextCursor unchanged. Private facts primitive may gain explicit presentation-order parameters; no policy imports in infrastructure.

- [x] **Step1 — Write failing schema/projection and cursor tests.** Required boolean accepted, missing/wrong type rejected; ordinary=false, eligible MFA-proven admin=true; pending/incomplete-MFA credentials retain existing denial. In real integration fixture create Personal with UUID after team UUIDs; traverse limits1 and2 until null, asserting Personal first then sorted teams, exact set, no duplicates. Assert personal cursor starts teams; unauthorized cursor cannot reveal another user's org; empty-team account yields Personal then null. Keep all F1 limit, selection and actor/audit assertions intact.

```ts
expect(all.map((o) => o.kind)).toEqual(['personal', 'team', 'team']);
expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
expect(first.pageInfo.nextCursor).toMatch(/^[0-9a-f-]{36}$/);
expect(summary.platformAdmin).toBe(false);
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project contracts --project backend-integration --project frontend shared/test/auth.spec.ts backend/test/integration/organizations.spec.ts backend/test/integration/identity-read-paths.spec.ts frontend/test/identity-client.spec.tsx`; expect schema/order failures.
- [x] **Step3 — Implement projection and bounded ordering.** Compute flag once from the same verified predicate already used by platform guards. First list page reserves a slot for actor's authorized Personal fact, then active teams in organization UUID order; subsequent cursors resume teams (Personal cursor means team start). Bound adapter reads and fill requested visible page/lookahead without counting Personal twice. Validate cursor against actor facts; retain existing F1 behavior for nonexistent/stale cursors unless tests/spec say otherwise. No broad SQL/native endpoint, parallel membership model, or cursor encoding change.
- [x] **Step4 — GREEN:** focused command, `pnpm --filter @lexon/contracts build`, root typecheck, backend identity privacy/platform HTTP tests. Verify exact preexisting list schema exported unchanged.
- [x] **Step5 — Commit:** stage Task3 files/fixture-only changes; commit `feat(identity): expose platform eligibility and order Personal first`.

### Task 4: Install theme provider and controlled appearance chooser

**Research:** R3/R4; reread versioned next-themes0.4.6 README and npm peers (React19 supported), hydration warning/initial script/storage key before this task.

**Files:** Modify `frontend/package.json`, `pnpm-lock.yaml`, `frontend/src/app/layout.tsx`; create `frontend/src/components/theme-provider.tsx`, `frontend/src/components/settings/appearance-settings.tsx`, `frontend/test/theme.spec.tsx`; add base-nova radio-group through CLI if needed.

**Interfaces:** `ThemeProvider({children}: {children:ReactNode}):ReactElement`; `AppearanceSettings():ReactElement`. next-themes owns `theme` localStorage and class attribute; no backend preference or new context API. Appearance route is added in Task10.

- [x] **Step1 — Write failing component tests.** Mount provider/chooser, assert labeled Light/Dark/System radio controls and default System after mount, set Dark and assert storage theme=dark and html.dark, set Light and assert html.light, emulate OS updates in System, spy fetch and assert no preference request. Assert circular radio indicator and rectangular preview card.

```ts
expect(localStorage.getItem('theme')).toBe('dark');
expect(document.documentElement.classList.contains('dark')).toBe(true);
expect(fetchSpy).not.toHaveBeenCalled();
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/theme.spec.tsx`; fail on absent provider/chooser behavior.
- [x] **Step3 — Implement minimal provider/chooser.** Install `pnpm --filter @lexon/frontend add --save-exact next-themes@0.4.6`; retain pins. Provider class/system/enableSystem/disableTransitionOnChange; html suppressHydrationWarning. Delay selection-dependent UI until mounted; labeled radio group and CSS-only previews. Generate base-nova control, inspect imports/dependency closure, and keep only used variants. Do not add a theme network call or auth toggle.
- [x] **Step4 — GREEN:** focused tests, token/shape checks, frontend typecheck/build. Confirm only intended dependency pins changed. Deterministic no-hydration browser proof is Task12, not a claim from jsdom.
- [x] **Step5 — Commit:** stage Task4 provider/controls/tests/manifests; commit `feat(ui): add browser-local light dark and system themes`.

### Task 5: Protect all shell route prefixes

**Research:** R8; reread Next16 proxy cookie API and safeReturnPath tests; proxy still does no access decision.

**Files:** Modify `frontend/src/proxy.ts`, `frontend/test/auth-proxy.spec.tsx`; extend `backend/test/e2e/auth-entry.spec.ts` for route-prefix smoke later if needed.

**Interfaces:** Existing `proxy(NextRequest):NextResponse` and exported matcher config; exact roots/slash descendants workspace/settings/organizations/platform/onboarding. Preserve safeReturnPath signature and auth-entry redirects.

- [x] **Step1 — Extend failing proxy table.** For each root and nested path without cookie, assert sign-in redirect and returnTo retains query. Cookie-present hint passes; sign-in/up with cookie goes Home. Prefix lookalikes not captured. Keep encoded/backslash/external return-path negatives.

```ts
expect(location.searchParams.get('returnTo')).toBe(
  '/settings/security?from=home',
);
expect(location.pathname).toBe('/sign-in');
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/auth-proxy.spec.tsx`; new-prefix cases fail while F1 cases remain meaningful.
- [x] **Step3 — Implement explicit prefix/matcher coverage.** No startsWith('/settings') overmatch; no cookie parsing/auth authorization on frontend. The backend never reads sidebar_state; include a request carrying only sidebar_state and assert it is still signed out.
- [x] **Step4 — GREEN:** focused command plus frontend lint/typecheck; cookie-hint-only semantics remain covered.
- [x] **Step5 — Commit:** stage Task5 files; commit `fix(ui): protect every application shell route`.

### Task 6: Extract shared states and heading composition

**Research:** R8/R13; reread Next boundary/main composition and existing SessionBoundary/AuthCard before extraction.

**Files:** Create `frontend/src/components/states/page-states.tsx`, `frontend/src/components/shell/page-header.tsx`, `frontend/test/page-states.spec.tsx`; modify `components/auth/{auth-card,session-boundary}.tsx`, `components/organizations/page-state.tsx` and `frontend/test/session-boundary.spec.tsx`.

**Interfaces:** `LoadingState({message?})`, `EmptyState({title,description,action?})`, `ErrorState({message?,onRetry?})`, `NoAccessState({message?})` produce sections/status/alert, no main. `PageHeader({title,actions?})` owns page h1. AuthCard adds `headingLevel?:1|2|3` default1; SessionBoundary adds `embedded?:boolean` defaultfalse, preserving existing state/children props and lifecycle.

- [x] **Step1 — Write failing composition tests.** Loading has role=status, error role=alert/retry calls once, empty optional real action, no-access safe copy; embedded SessionBoundary has no main and still signs out with safe returnTo. AuthCard headingLevel2 renders h2, standalone default h1. Error input with secret details is never rendered/logged; pass safe state/copy, not raw Error into shared view.

```ts
expect(container.querySelectorAll('main')).toHaveLength(1); // harness owns main
expect(container.querySelectorAll('h1')).toHaveLength(1); // page header only
expect(container.textContent).not.toContain('Private dependency detail');
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/page-states.spec.tsx frontend/test/session-boundary.spec.tsx`.
- [x] **Step3 — Implement presentational extraction.** Preserve F1 expired-session sign-out, errors and redirect behavior; do not put auth policy in state components. Use semantic tokens and owned controls.
- [x] **Step4 — GREEN:** focused tests, existing auth-primitives tests, presentation checks and frontend typecheck.
- [x] **Step5 — Commit:** stage Task6 files; commit `refactor(ui): share safe page states and heading composition`.

### Task 7: Introduce persistent verified workspace and identity lifecycle

**Research:** R8/R11/R12/R16; reread persistent layouts/useQuery, existing AccountRoute MFA exceptions, transitionTenant and SessionBoundary. Identity summary is account-scoped; org data checks stay independent.

**Files:** Create `frontend/src/lib/workspace-bootstrap.ts`, `frontend/src/components/shell/workspace-provider.tsx`, `workspace-shell.tsx`, `frontend/src/app/(workspace)/layout.tsx`, `frontend/test/workspace-shell.spec.tsx`; modify existing `lib/identity-page.tsx`, `components/organizations/{workspace,organization-page}.tsx` to consume shared state, with page main cleanup; update `frontend/test/identity-page.spec.tsx`.

**Interfaces:** `WorkspaceBootstrap = {status:'ready';identity:IdentitySummary}|{status:'mfa-required'|'expired'|'unavailable'}`; `loadWorkspaceBootstrap():Promise<WorkspaceBootstrap>` request-local, never global cache. `WorkspaceProvider({bootstrap,children})`; `useWorkspace():{identity:IdentitySummary|null,status:WorkspaceBootstrap['status']|'loading',transitioning:boolean,fallbackNotice:string|null,refreshIdentity:()=>Promise<void>}`. `WorkspaceShell({children,sidebar?})` owns main and desktop panel host. Export `usePanelHost():HTMLElement|null` for Task9; host stores a DOM node, never panel open state.

- [x] **Step1 — Write failing lifecycle tests.** Seed identity, mount navigation children and rerender without remounting provider; assert one identity query with5000ms interval. Test fallback once, later distinct fallback again; remove/demote while a deferred old-org query is pending, then resolve it and assert no old content/cache reappears. Test401/503 hiding protected children, incomplete onboarding no sidebar, MFA-required restricted frame keeps Security reachable but no protected children/nav. Inject sidebar_state values and assert backend identity request inputs are identical cookie-auth semantics, with no parsed display preference passed as policy input.

```ts
expect(queryClient.getQueriesData({ queryKey: ['tenant', oldId] })).toEqual([]);
expect(container.textContent).not.toContain('Old private members');
expect(identityCallCountAfterAdvance5000).toBe(identityCallCountBefore + 1);
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/workspace-shell.spec.tsx frontend/test/identity-page.spec.tsx frontend/test/tenant-queries.spec.tsx`.
- [x] **Step3 — Implement one owner for identity observation.** Seed shared ['identity'] with safe bootstrap; retain5s/no-retry. Hide protected descendants before transition, cancel/remove obsolete tenant and disallowed role data, then update active-org state. Keep existing page/API checks and targeted recovery branch so rejected normal bootstrap cannot block security enrollment. Onboarding has frame/no sidebar until complete. Do not mount sidebar/tenant runtime until verified ready; keep header/main/skip-link unique. Existing individual page loaders may verify data but must not create independent polling loops or global identity caches.
- [x] **Step4 — GREEN:** focused tests plus frontend organizations/security suites and typecheck. Ensure restricted recovery is a tested branch, not a newly permitted identity endpoint.
- [x] **Step5 — Commit:** stage Task7 files; commit `feat(ui): add persistent verified workspace shell`.

### Task 8: Adapt sidebar-07 to F1 organizations and sign-out

**Research:** R1/R2/R10/R11; rerun shadcn info/docs/view for sidebar-07 and retained dropdown/sheet/avatar/dialog controls before task. Record generated file/dependency provenance.

**Files:** Extend `backend/test/integration/session-http.spec.ts` for sidebar cookie authorization independence. Generate `frontend/src/components/ui/{sidebar,sheet,dialog,dropdown-menu,avatar,tooltip,skeleton}.tsx` and required `frontend/src/hooks/use-mobile.ts`; create `components/shell/{app-sidebar,organization-menu,user-menu}.tsx`, `frontend/test/sidebar.spec.tsx`; modify workspace layout/shell and `components/organizations/{organization-switcher,workspace}.tsx` to remove replaced controls.

**Interfaces:** `AppSidebar():ReactElement` consumes useWorkspace; `OrganizationMenu():ReactElement` consumes existing identityApi list/switch and transitionTenant; `UserMenu():ReactElement` consumes profile and authClient. SidebarProvider keeps native props; width256px; cookie sidebar_state; mobile boundary768px. No new shared business API.

- [x] **Step1 — Write failing sidebar tests.** Assert exact nav set by kind/role/platformAdmin, Lexon text only, initials/name/email, active aria-current/non-color cue. Real cursor list Personal label, page2, busy switch awaiting transitionTenant/reload, enrollment_required selection unchanged + Security link, create-team named dialog refreshes list without changing selection. Sign-out order cancel→clear→auth→navigate; failure exact F1 message/no navigation. Collapse cookie reload, shortcut, mobile close/Escape/focus, navigation opener removal and767→768 while open. Backend identity authorization succeeds/fails identically across sidebar_state=true/false/malformed, without backend code reading it.

```ts
expect(labels).toEqual([
  'Home',
  'Settings',
  'Organization settings',
  'Platform',
]); // eligible owner
expect(container.textContent).not.toContain(personalInternalName);
expect(events).toEqual(['cancel', 'clear', 'signOut', 'navigate']);
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/sidebar.spec.tsx`; distinguish missing block from failed meaningful behavior after harness loads.
- [x] **Step3 — Generate then adapt block.** Use `pnpm dlx shadcn@4.23.0 add sidebar-07` with existing base-nova config; dry-run/diff existing controls first, no blind overwrite. Remove projects/sample logos/data/actions and all unused variants/files. Use Base UI dialog/popover composition for cursor controls, F1 CreateTeam in dialog, real switch and sign-out sequences. Keep native Sidebar behavior; cookie is read only by Next layout for display. Layout attaches AppSidebar; user links use Next Link. Preserve org-switch full reload.
- [x] **Step4 — GREEN:** focused frontend tests, `pnpm exec vitest run --project backend-integration backend/test/integration/session-http.spec.ts`, lint/presentation checks, frontend typecheck/build; inspect package diff and pin any genuinely retained approved dependencies exactly (expected existing closure). No Radix-owned imports/menus.
- [x] **Step5 — Commit:** stage Task8 generated/owned files and exact dependency changes; commit `feat(ui): adapt sidebar to organization and session workflows`.

### Task 9: Add page-controlled responsive right panel

**Research:** R10; reread Base UI Dialog focus/modal API and actual generated Sheet props. No Resizable.

**Files:** Create `frontend/src/components/shell/right-panel.tsx`, `frontend/test/right-panel.spec.tsx`; modify shell host styling if needed; test-only harness lives inside test file, no app route.

**Interfaces:** `RightPanel({open,onOpenChange,title,triggerRef,children}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;triggerRef:RefObject<HTMLElement|null>;children:ReactNode}):ReactElement|null`. Consumes usePanelHost. Page owns open state; desktop aside portals into shell host; mobile same Base Sheet/Dialog. No URL/storage API.

- [x] **Step1 — Write failing controlled harness tests.** At768desktop assert named aside,320px token width across close/open/navigation to a new page harness, no drag control. At767 assert named dialog, no aside duplicate, focus cannot escape, Escape and close call false and return focus. Change breakpoint while open: exactly one semantic surface, focus remains usable. Unmount page disposes panel; reopen on another page starts false. Storage/URL spies observe no writes.

```ts
expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
expect(document.querySelectorAll('aside[aria-label="Details"]')).toHaveLength(
  0,
);
expect(document.activeElement).toBe(opener);
```

- [x] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/right-panel.spec.tsx`.
- [x] **Step3 — Implement controlled surface.** Use existing mobile hook and Sheet; override mobile width/max-width to full viewport. Desktop fixed token width, min-width-zero main. Primitive handles focus trap; explicit triggerRef supplies return target when no declarative Trigger exists. Use named fallback focus target if opener unmounts. No sidebar-state coupling or new persistence.
- [x] **Step4 — GREEN:** focused test, presentation checks and frontend typecheck. Same modal behavior also exercised by real mobile sidebar in Task12; no browser fixture dependency is required for panel component tests.
- [x] **Step5 — Commit:** stage Task9 files; commit `feat(ui): add controlled desktop panel and mobile sheet`.

### Task 10: Migrate settings and integrate F1 pages with shared frame/states

**Research:** R8/R12; re-read Next Link/not-found/error and F1 forms/role gates before moving routes. Current error-boundary types support retry/reset; never copy vendor logging examples.

**Files:** Create `components/settings/{section-navigation,profile-settings}.tsx`; new workspace `settings/{page,profile/page,security/page,appearance/page}.tsx` and `organizations/[orgId]/settings/{page,general/page,members/page,invitations/page}.tsx`; create root/workspace `error.tsx`, `not-found.tsx` and scoped catch-all pages at `(workspace)/{workspace,settings,platform,onboarding}/[...unmatched]/page.tsx` calling notFound(). For organizations create `(workspace)/organizations/page.tsx`, `organizations/[orgId]/page.tsx`, and `organizations/[orgId]/[...unmatched]/page.tsx`, each calling notFound(). Never add organizations/[...unmatched] beside [orgId]. Remove old account/security and org members/invitations leaves; modify org settings index. Update all existing auth/org/platform/onboarding page wrappers and action links. Test `frontend/test/settings.spec.tsx`, `route-boundaries.spec.tsx`, and existing organizations/account-security/platform suites. Update actionable links in docs/references and current app guidance.

**Interfaces:** `SectionNavigation({items}:{items:readonly {href:string;label:string;current:boolean}[]}):ReactElement` same links at all widths, no select/input. `ProfileSettings():ReactElement` uses ProfileInputSchema/updateProfile and refreshIdentity. Existing AccountSecurity/Members/Invitations/OrganizationSettings keep their business props/contracts; compose h2 cards under PageHeader. No extra endpoint.

- [ ] **Step1 — Write failing page/route tests.** Profile validates and updates name, email read-only and Security link. Settings/organization-settings index redirects; removed leaves404. `/organizations`, `/organizations/<id>`, and `/organizations/<id>/x/y` each render the in-shell not-found view (authenticated shell landmarks remain); the bare org route deliberately calls notFound rather than redirecting. Real links/mobile layout/aria-current44px; current route changes only on activation. Team member Invitations/General, admin General, cross-org route, Personal org controls, and non-platform-admin Platform deny before data loaders run. On role refresh, disallowed existing view/cache disappears. MFA-required Security remains reachable; one h1/main and safe boundaries. Keep all F1 security and organization mutations unchanged.

```ts
expect(invitationFetch).not.toHaveBeenCalled(); // member on invitations URL
expect(container.querySelector('select')).toBeNull();
expect(
  container.querySelector('[aria-current="page"]')?.getAttribute('href'),
).toBe('/settings/security');
```

- [ ] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/settings.spec.tsx frontend/test/route-boundaries.spec.tsx`; new URLs/views fail before migration.
- [ ] **Step3 — Implement routes and composition.** `/settings`→profile; org settings root→members; General moves to /general. Gate by live identity ID/kind/role before mounting child query components, backend checks unchanged. Use shared states across every F1 auth/workspace view; auth login-02/signup-02 layout retained. Scoped catch-alls call notFound for unmatched shell-prefix paths; organizations nests its catch-all beneath [orgId], with explicit bare-root and bare-id notFound pages. Root handles other404s. Layout failures go to ancestor boundary. Keep robots/referrer metadata and give every page descriptive title, skip link target and single h1. No legacy redirect except explicit index routes; API/email link paths unchanged.
- [ ] **Step4 — GREEN:** focused + full frontend tests/typecheck and `pnpm build` (required route-tree compilation check), presentation fixtures; search old paths and fix live links/tests/docs, retaining intentional migration/404 assertions only. Extend F1 browser selectors/paths rather than dropping scenarios.
- [ ] **Step5 — Commit:** stage Task10 files; commit `feat(ui): unify settings routes and accessible page states`.

### Task 11: Add inert registry chat Home and empty conversation group

**Research:** R5/R6/R7; rerun CLI view thread/thread-list; inspect all retained source/dependency closure and installed LocalRuntime disabled controls before generation.

**Files:** Add trimmed `frontend/src/components/assistant-ui/elements/{thread.aui,thread-list.aui}.tsx`; create `components/shell/chat-runtime-provider.tsx`, `frontend/test/chat-scaffold.spec.tsx`; modify workspace Home, shell provider/sidebar group and `frontend/test/assistant-runtime.spec.tsx`; update package/lock only if retained approved closure needs exact existing pins.

**Interfaces:** `ChatRuntimeProvider({tenantId,children})` creates tenant-keyed useLocalRuntime with inert ChatModelAdapter; `Thread({displayName}:{displayName:string})` and `ThreadList()` consume same runtime. Run adapter fails safely if reached; tests prove it is unreachable. No data transport/network/AI call. Sidebar group is not a nav destination.

- [ ] **Step1 — Write failing real-runtime tests.** Mount seeded Home/list, assert welcome uses name as text, disabled composer plus exact unavailable copy, exact empty-list copy, no send/new/overflow control. Focus surrounding composer area, dispatch Enter and attempted form submit; adapter and isolated fetch spies stay zero. Tenant key change/sign-out unmounts old runtime. Tests assert no focus stealing and no attachment/tool/model/voice/branch/edit/reload UI.

```ts
expect(run).not.toHaveBeenCalled();
expect(network).not.toHaveBeenCalled();
expect(container.textContent).toContain('Chat is not available yet.');
expect(container.textContent).toContain('No conversations yet.');
```

- [ ] **Step2 — RED:** `pnpm exec vitest run --project frontend frontend/test/chat-scaffold.spec.tsx frontend/test/assistant-runtime.spec.tsx`.
- [ ] **Step3 — Add registry files via CLI then trim.** Remove out-of-scope parts and their dependency graph before retaining generated files. Keep real Thread/Composer and ThreadList runtime composition, use pinned read-only/disabled mechanism and disabled native controls; no fake replacements. No New/Send/overflow or suggestions. Preserve exact F0 client package pins and avoid markdown/tools/voice dependencies not used. Add no Route Handler/Server Action/chat API.
- [ ] **Step4 — GREEN:** focused tests, frontend typecheck/build, presentation/import fixtures. Add negative static fixture to presentation-policy tests for business Route Handlers, use-server files, or model-generation imports/calls under owned frontend; existing health route allowed. Browser shell identity traffic is not counted as a chat effect.
- [ ] **Step5 — Commit:** stage Task11 files/provenance; commit `feat(ui): scaffold disabled assistant Home and empty thread list`.

### Task 12: Prove both-theme accessibility and complete regression gates

**Research:** R13/R14 and versioned next-themes0.4.6 inline-script behavior; read https://playwright.dev/docs/api/class-page#page-add-init-script, https://playwright.dev/docs/api/class-page#page-route, https://playwright.dev/docs/api/class-page#page-emulate-media and current F1 mail/browser harness. No new screenshot or component-test framework.

**Files:** Create `backend/test/e2e/app-shell.spec.ts`, `theme-before-hydration.spec.ts`, `shell-accessibility.spec.ts`; extend `backend/test/e2e/{auth-entry,account-security,organizations,platform-identity}.spec.ts`; modify `playwright.config.ts` and `scripts/e2e-projects.mjs` only to include new suites in existing frontend/backend package mappings. Create `scripts/test/f2-route-inventory.spec.mjs` for route/metadata and no-data-frontend checks; update `docs/references/F2-acceptance.md` (new) and live README route guidance. Keep test-only fixtures outside production build.

**Interfaces:** Reuse existing descriptor()/readCapturedMail()/authenticated fixture setup, Compose project ownership and cleanup. New tests run in identity-browser project and filtered frontend E2E includes it. No public test endpoint or production fixture route.

- [ ] **Step1 — Write failing browser assertions and gate coverage.** Axe each required page in light/dark: sign-in/up,2FA,Home,Profile,Security,Appearance,General,Members,Invitations,platform page. Use all applicable wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa tags, report zero violations. Assert one h1/main, titles/skip links,44px targets/no overflow and keyboard focus.

```ts
expect(
  (
    await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations,
).toEqual([]);
await expect(page.locator('h1')).toHaveCount(1);
expect(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
).toBe(true);
```

Add keyboard-only sign-in→Home→switch team→Settings→Appearance→theme→sign-out. Mobile375px sidebar navigation/Escape/focus and767/768 behavior; collapse button/shortcut/reload. Real browser removal/demotion during active page, fallback once, stale-cookie rejection, cross-org/role denied with no prohibited fetch. Verify `/organizations`, `/organizations/<id>`, and `/organizations/<id>/x/y` render in-shell404s after real navigation. Existing F1 scenarios remain, paths/selectors updated only.

- [ ] **Step2 — Add deterministic pre-hydration acceptance test.** In a fresh page/context per case, addInitScript writes localStorage key theme to light/dark/system; emulateMedia colorScheme for both system resolutions. Route `**/_next/static/**` and abort every request whose resourceType is script (also assert matching script requests were aborted). Navigate auth page with waitUntil domcontentloaded; do not wait for networkidle or React. Assert html expected class and computed body background `rgb(255, 255, 255)` or `rgb(18, 18, 20)`. Inline next-themes script must execute while React never hydrates. Separately verify hydrated chooser/live OS updates and no theme HTTP request. This test may already be green because Task4 implemented behavior; never claim historical RED for it. If already green, record it as new acceptance coverage; Task12 RED comes from whichever new browser requirement actually fails, or document verification-only status when all pass.

```ts
await page.addInitScript(({ theme }) => localStorage.setItem('theme', theme), {
  theme: 'dark',
});
await page.route('**/_next/static/**', (route) =>
  route.request().resourceType() === 'script'
    ? route.abort()
    : route.continue(),
);
await page.goto(baseUrl + '/sign-in', { waitUntil: 'domcontentloaded' });
await expect(page.locator('html')).toHaveClass(/\bdark\b/);
await expect(page.locator('body')).toHaveCSS(
  'background-color',
  'rgb(18, 18, 20)',
);
```

- [ ] **Step3 — Run focused E2E:** `pnpm test:e2e -- --project identity-browser --grep 'F2'`; inspect real behavioral failures. Fix only demonstrated F2 gaps test-first; do not weaken axe, focus, privacy, MFA, or old F1 assertions. The existing e2e runner filters argument separators and forwards --project/--grep to Playwright; prefix all new test titles with F2 so this command selects them.
- [ ] **Step4 — Full gates:** `pnpm format:check`; `pnpm lint`; `pnpm typecheck`; `pnpm build`; `pnpm test`; `node --test scripts/test/*.spec.mjs`; `pnpm --filter @lexon/backend test:mutation:identity`; `pnpm test:e2e`. Each must exit0; inspect counts and owned-stack teardown. Verify root and per-package test/E2E mappings still self-start. Do not report success from a partial/old run.
- [ ] **Step5 — Record acceptance and commit.** F2-acceptance maps brief items1–26 to files/tests, notes exact retained package versions/CLI provenance, RED/GREEN evidence and limitations, confirms unchanged cursor/public list schema and backend ignorance of sidebar_state. Commit `test(ui): verify shell themes accessibility and F1 regressions`. Use superpowers:requesting-code-review for one fresh whole-branch reviewer; fix confirmed findings with failing tests and rerun affected gates. Use verification-before-completion, then finishing-a-development-branch; retain branch and present concrete review/PR state without merging.

## Self-review and execution handoff

Coverage checked against every approved design section and F2 brief item1–26:
tokens/themes2/4/12; shell lifecycle7/8; panel9; URL/settings10; chat11;
states6/10; protection5; contracts/pagination3; owned-library/radius policy1/2;
accessibility/regression12. All five Review Focus cases have named owning tests.
Task interfaces use the same names across dependencies; no helper or fixture
requires a new unapproved package. Task12 acceptance-only tests may pass on first
run and must be recorded honestly rather than manufacturing a RED.

The product owner approved execution with the amendments above. The design and
amended plan are committed before dispatching implementation. The plan itself
introduces no product code or dependency changes.
