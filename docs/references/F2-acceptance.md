# F2 acceptance notes

## UI import and circular-shape lint coverage

ESLint rejects direct `radix-ui` and `@radix-ui/*` imports in owned frontend and
Word add-in files while allowing `@base-ui/react`. The `lexon/circular-shape`
rule checks literal JSX `className` strings and literal base/variant strings
passed to `cva`, including modifier-prefixed `rounded-full` tokens. Circular use
is permitted only in the radio indicator,
switch thumb, initials avatar, and status dot owner files, with a matching
semantic `data-slot` on JSX elements.

Dynamic class construction is intentionally outside this check. It does not
evaluate `cn(...)`, template expressions, variables, imported class strings, or
arbitrary radius utilities. Shape-policy fixtures document and exercise only
the static cases above; this is a bounded lint guard, not a general Tailwind
class analyzer.

## Task 1 verification

Commits: `2da297e`, `1417f95`. The main session reviewed spec compliance first,
then code quality; both passed after one focused fix round. Initial policy
fixtures failed before implementation (4 failures), then passed (5 tests).
Review regressions reproduced package-cwd, disallowed-element, and prefixed-class
gaps (3 failures); the fix passed all 6 policy tests. Root lint passed all 84
boundary/presentation fixtures; frontend-cwd source lint also passed.

Implementation model and reasoning were verified from local runtime metadata as
`gpt-6-luna` / `high` under Codex CLI 0.166.0. Full scratch reports remain in the
ignored per-plan SDD workspace; this reference retains the reviewable evidence.

## Task 2 verification

Commits: `0052bcc`, `f003504`. Main-session spec and quality reviews passed
after one focused fix round. The initial token tests reproduced missing dark
and layout tokens (3 failures); added review regressions reproduced focus,
radius-alias, and grid gaps (3 failures). Final token checks passed6/6,
presentation checks6/6, boundary checks90/90, frontend tests21 across11 files,
and frontend typecheck/formatting/diff checks passed. Browser-computed style
verification remains in Task12; these are source-token and control-style checks.

## Task 3 verification

Commits: `51d019a`, `0a5750e`. Main-session spec and quality reviews passed.
Personal-first traversal preserves Page/UUID cursor schemas, actor binding and
existing pagination/selection/audit assertions; tests cover limits1/2, Personal
sorting late, all teams once, Personal cursor and Personal-only accounts. The
platform flag reuses the existing server-verified eligibility predicate. Real
identity HTTP tests deny an unenrolled administrator and an old session after
another session enrolls; those additional acceptance assertions passed immediately.

Initial behavioral RED had3 failures; corrected-project GREEN passed17 tests in
6 files. Contracts build, root typecheck/lint, backend typecheck and changed-file
formatting passed. The plan's `--project shared` typo was corrected to the actual
Vitest project `contracts`; the earlier separate unfiltered schema/client run
also passed7 tests. Listing adds two bounded Personal fact lookups, no new
endpoint or migration. Implementation model was verified as Luna/high.

## Task 4 review fix round 1

The original implementation attempt's first focused run failed during module
resolution before tests were collected because the provider file did not yet
exist. That was not a behavioral RED and is not claimed as valid TDD evidence.
In this review round, the new spacing assertion was added before changing the
styles; it failed on the rendered `gap-3` class. After correcting spacing, a
temporary local change from `attribute="class"` to `attribute="data-theme"`
made both theme application assertions fail on the expected missing HTML
classes. The provider was restored to `class`; the temporary edit was not
committed. A separate SSR render assertion confirms that no radio selection is
rendered before mount; it makes no browser first-paint or hydration-warning
claim.

Task 4 review validation: The spacing RED command,
`pnpm exec vitest run --project frontend frontend/test/theme.spec.tsx`, failed
with 1 test failure: expected the radio group to contain `gap-2`, received
`gap-3`. The controlled temporary-attribute run used the same command and
produced 3 failures: the two expected missing-class assertions, plus the SSR
case initially lacked a `window.matchMedia` stub after test cleanup. Adding a
per-test media query stub fixed that test-environment issue. After restoring
`attribute="class"`, the focused command passed 3 tests.

`pnpm exec prettier --check frontend/src/components/theme-provider.tsx frontend/src/components/settings/appearance-settings.tsx frontend/src/components/ui/radio-group.tsx frontend/test/theme.spec.tsx` passed.
`pnpm --filter @lexon/frontend typecheck`,
`pnpm --filter @lexon/frontend build`, and
`pnpm --filter @lexon/frontend lint` passed; lint included all 90 boundary,
design-token, and presentation-policy assertions. `git diff --check` passed.

Task4 commits: `0a7a9cc`, `1d2cf9a`. Main-session spec and quality reviews
passed after the focused corrections, with the initial process limitation above
retained. Lockfile review confirms only next-themes0.4.6 was added; all other
pins remain unchanged. This task does not claim browser first-paint proof.

## Task 5 verification

Commit `6e37369`: main-session spec/quality reviews passed with no findings.
Behavioral RED11 failures/7 passes preceded the proxy change; GREEN23 tests,
frontend lint90, typecheck/format/diff checks passed. Every shell prefix and
slash descendant is protected without lookalike overmatching, existing return
path/auth-entry tests remain, and sidebar_state alone never authenticates.

## Task 6 verification

Commits `d205824`, `f678c13`: main-session spec/quality reviews passed after
spacing/heading corrections. Existing-component RED reproduced nested main and
multiple h1 problems; new-module assertions were reached through minimal export
skeletons before implementation (initial import failure excluded). Correction
RED reproduced spacing and heading mismatches; GREEN8 tests/3 files, frontend
types/ESLint,90 presentation/boundary checks, formatting/diff checks passed.
Embedded expiry retains F1 auto-sign-out and a sanitized sign-in recovery link.

## Task 7 verification

Commits `b994153`, `8073e8e`, `5f447b0`: main-session spec and quality reviews
passed after two focused correction rounds. Regressions covered stale bootstrap
cache, recovery/polling, authentication and role/MFA cache cleanup, late tenant
responses, fallback notices, onboarding redirect, cache-clear scope, and a neutral
panel host outside main. RED reproduced the review findings (9 then3 failures);
final focused25 tests/6 files and full frontend71 tests/15 files passed, as did
typecheck/build/lint90/format checks. Model/effort verified Luna/high. Browser
navigation proof remains in Task12. Task9 owns the actual named panel; an empty
host reserves no width. Duplicate tenant cleanup calls on MFA changes are minor
redundant work, retained for final review.

## Task 8 verification

Commits `aa98ae4`, `dab5b3f`, `214707a`: main-session spec and quality gates
passed after two correction rounds. Sidebar07 generated through CLI4.23.0,
then sample data/pages and unused registry variants removed; existing controls
and dependency pins preserved. Tests cover navigation by role, cursor paging,
MFA-denied and successful switch, team creation/cancel/focus, sign-out ordering,
collapse/cookie/shortcut and mobile navigation/Escape. Review RED reproduced7
behavior/style gaps, followed by focused dark-shadow/gutter/mobile-menu failures.
Final sidebar11 tests and frontend81 tests/16 files passed; backend283 tests/74
files include display-cookie independence. Typecheck/lint/build/format passed.
No dependency/lockfile changes. Browser proof remains Task12. Settings URLs
still use the working F1 destinations until the planned Task10 migration.

## Task 9 verification

Commits `f59a781`, `81d099f`: main-session spec/quality reviews passed.
Controlled desktop aside uses the320px CSS token; mobile uses the existing
full-width Base UI Sheet, with naming, Escape/close/focus return, breakpoint
handoff and no persistence. Initial assertion RED3 failures preceded implementation.
A synthetic Tab assertion was replaced during review with a real primitive
focus-guard test; temporarily disabling modal behavior made it fail, then restoring
modal passed. This proves guard containment in jsdom, not native browser Tab.
Focused5 tests/full frontend86 tests passed, with types/lint/build/format checks.
No new dependency, production fixture route, or navigation destination. Settings URLs
still use the working F1 destinations until the planned Task 10 migration.

## Task 10 verification

Settings now use `/settings/profile`, `/settings/security`, and
`/settings/appearance`. Organization settings use
`/organizations/[orgId]/settings/{members,invitations,general}`; the two index
routes redirect to Profile and Members. Old F1 leaves have no compatibility
redirect. Organization bare-root, bare-ID, and nested unknown paths use the
workspace not-found view. App action links and MFA `returnTo` values use the new
settings routes. Organization navigation is filtered by the verified active
team role and ID, with a single vertical link layout at all widths. Existing
security and organization browser flows now use their current route and link
selectors. Root and workspace recovery views return to `/workspace`.

Coverage includes profile validation/update and read-only email, real section
links and active state, role and cross-org denial before loaders mount, role
refresh cache removal, platform loader denial, index redirects, shell-prefix
catch-alls, safe errors, and the three organization not-found cases. Detailed
RED/GREEN commands and commit are recorded in the Task 10 report.

Task10 review completion: commits `a5abc00`, `02ca5b6`, `cb4f901`. Main-session
spec/quality reviews passed after role-filtered navigation, embedded Security
composition, shared enrollment/recovery heading levels, skip links and lost-org
recovery corrections. Browser test URLs/selectors are migrated without dropping
F1 scenarios; actual browser execution remains Task12. Final frontend102 tests/19
files, focused29 tests, typecheck/lint90/root build/format passed. The approved
organization route tree compiles; the unit tests invoke its explicit notFound
branches. Native browser in-shell404 rendering is still a Task12 assertion.

## Task 11 verification

Commits `27cc3d8`, `639b0b5`: main-session spec/quality reviews passed after
strengthening the tenant-remount proof and bounding/hiding the collapsed
conversation group. Real LocalRuntime tests attempt Enter/form submit with
zero adapter/fetch calls. The lifecycle probe fails when its tenant key is
temporarily removed and passes when restored; this is additional sensitivity
coverage, not a historical TDD claim. Full frontend105 tests and focused15 pass,
with typecheck/lint/build/format checks. No dependencies/lockfile changes.
Registry inspection identified27 generated files/9 dependencies/5 overwrites;
only the inert Thread/Composer/List primitive closure was retained. No New,
Send, overflow, attachment, tool, voice, model or branch/edit/reload controls.

## Task 12 acceptance coverage

| Brief item | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–3        | `scripts/test/design-tokens.spec.mjs` checks the single light/dark token map, contrast, radius, spacing, focus, shell dimensions and reduced-motion tokens; `backend/test/e2e/app-shell.spec.ts` checks computed sidebar transition at normal and reduced motion.                                                                                                                                                                                                                            |
| 4          | `backend/test/e2e/theme-before-hydration.spec.ts` checks light/dark/local-system values before React hydration while external scripts are blocked; `backend/test/e2e/shell-accessibility.spec.ts` checks System follows light/dark OS changes and no theme API request occurs; `backend/test/e2e/account-security.spec.ts` checks a saved browser theme survives reload and navigation.                                                                                                      |
| 5          | `frontend/test/right-panel.spec.tsx` exercises the existing named RightPanel fixture and focus return; the live mobile sidebar sheet in `backend/test/e2e/app-shell.spec.ts` exercises actual browser Tab/Shift+Tab containment and close/Escape focus return. No production fixture route was added.                                                                                                                                                                                        |
| 6          | `backend/test/e2e/app-shell.spec.ts` checks collapse button, Ctrl+B, persisted collapsed state after reload, mobile sheet at 375/767px and desktop sidebar at 768px; it checks route navigation closes the sheet.                                                                                                                                                                                                                                                                            |
| 7          | `backend/test/e2e/app-shell.spec.ts`, `backend/test/e2e/organizations.spec.ts`, and `backend/test/e2e/platform-identity.spec.ts` exercise Home/settings/org/platform links, active-page state, organization-role visibility and platform hiding.                                                                                                                                                                                                                                             |
| 8          | `backend/test/integration/organizations.spec.ts` and `frontend/test/sidebar.spec.tsx` retain F1 pagination and UUID cursor assertions; existing switch/create coverage remains in `backend/test/e2e/organizations.spec.ts`. The F2 keyboard flow waits for a real organization list response and performs a keyboard switch/full reload; the active-page test covers 2FA standby without selection change.                                                                                   |
| 9          | Existing user-menu sign-out/error coverage remains in `frontend/test/sidebar.spec.tsx`; that fixture now selects by the rendered collapsed-state title and verifies no overriding accessible label. Keyboard sign-out runs in `backend/test/e2e/organizations.spec.ts`.                                                                                                                                                                                                                      |
| 10         | `backend/test/e2e/organizations.spec.ts` changes a real active member from admin to member, verifies denied settings and no invitations-data fetch, then removes the member while active and checks Personal fallback/one notice after a subsequent identity refresh. `backend/test/e2e/platform-identity.spec.ts` verifies an ordinary user's denied route makes no platform API request.                                                                                                   |
| 11–15      | `backend/test/e2e/shell-accessibility.spec.ts` scans actual Profile, Security, Appearance, General, Members and Invitations pages in both themes; `backend/test/e2e/platform-identity.spec.ts` scans the actual platform page in both themes under an operator session. `backend/test/e2e/auth-entry.spec.ts` covers auth landmarks; `backend/test/e2e/account-security.spec.ts` covers browser-local appearance persistence. Existing role, contract and F1 security flows remain in place. |
| 16–18      | `backend/test/e2e/app-shell.spec.ts` verifies the Home welcome/empty scaffold, disabled composer, no `/api/chat` request, collapse state and in-shell error routes. `scripts/test/f2-route-inventory.spec.mjs` asserts the frontend contains no chat endpoint or backend theme-preference API path.                                                                                                                                                                                          |
| 19–20      | `backend/test/e2e/app-shell.spec.ts` verifies workspace not-found for `/organizations`, valid organization bare-root, and unknown nested path while retaining Workspace navigation; it distinguishes root `/not-a-route` and legacy `/account/security` not-found from the shell and checks removed organization `/members` and `/invitations` paths. `backend/test/e2e/organizations.spec.ts` checks a stale session route and cross-organization no-access without protected data fetch.   |
| 21         | `backend/test/e2e/shell-accessibility.spec.ts` scans rendered Sign in, Sign up and two-factor pages in both themes; `backend/test/e2e/auth-entry.spec.ts` retains sign-up/verification browser behavior.                                                                                                                                                                                                                                                                                     |
| 22         | Existing `frontend/test/auth-proxy.spec.tsx` retains unauthenticated shell redirects and signed-in auth-entry redirects; `backend/test/e2e/organizations.spec.ts` verifies stale-session clearing.                                                                                                                                                                                                                                                                                           |
| 23         | Existing identity contract/integration coverage retains the additive platform-admin summary and backend authorization checks; `backend/test/e2e/platform-identity.spec.ts` exercises real ordinary-user denial and a real operator's platform page. Default rate limits are covered by `backend/test/integration/auth-limiter.spec.ts` and `backend/test/integration/auth-http.spec.ts`, not by the identity policy mutation gate.                                                           |
| 24         | `backend/test/e2e/shell-accessibility.spec.ts` scans auth, Home, Profile, Security, Appearance, General, Members and Invitations in light and dark with axe tags WCAG 2.0 A/AA, 2.1 A/AA and 2.2 AA. `backend/test/e2e/platform-identity.spec.ts` scans the rendered platform provisioning page in both themes under a real operator session.                                                                                                                                                |
| 25         | `backend/test/e2e/organizations.spec.ts` performs sign-in, organization switch, Settings/Appearance, theme selection and sign-out by keyboard. The test waits for the real organizations-list response before tabbing to the switcher; settings client navigation retains document time origin while organization switching performs a full reload.                                                                                                                                          |
| 26         | Every scanned auth/shell/settings/org/platform page asserts one `h1`, one `main`, one skip link, and a nonempty title. `backend/test/e2e/app-shell.spec.ts` separately checks workspace and root not-found landmarks.                                                                                                                                                                                                                                                                        |

The F1 public `Page<OrganizationSummary>` response and UUID cursor shape are
unchanged. `backend/test/integration/organizations.spec.ts` retains backend
pagination/selection assertions, and `frontend/test/sidebar.spec.tsx` retains
the list cursor UI coverage. Backend source continues to have no
`sidebar_state` reference; the cookie controls display only.

## Task 12 tools and harness

No new dependency or test framework was added. The installed pins are
`@playwright/test`/`playwright-core` 1.64.1, `@axe-core/playwright` 4.14.0,
`next-themes` 0.4.6, and Playwright's browser installer supplied Chromium for
the local acceptance run (`pnpm exec playwright install chromium`). The
versioned Playwright API references were read on 2026-11-02:
[page.addInitScript](https://playwright.dev/docs/api/class-page#page-add-init-script),
[page.route](https://playwright.dev/docs/api/class-page#page-route),
[page.emulateMedia](https://playwright.dev/docs/api/class-page#page-emulate-media),
and [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).
The official [next-themes v0.4.6 documentation](https://github.com/pacocoursey/next-themes/tree/v0.4.6)
supports the inline pre-hydration storage/class behavior under test. WCAG
contrast and non-text contrast thresholds were checked against the W3C WCAG
2.2 Recommendation on 2026-11-02.

The owned disposable E2E Compose stack supplies a test-only IP budget of 100
per 600 seconds for the `signup` and `verification-resend` actions through
`compose.identity.yml`; each account limit remains 3 and each window remains
600 seconds. Signup verification links consume the latter action. This override
is not in the default production Compose file or production application
configuration. The full E2E suite exercises auth flows without exhausting its
single shared test client IP; `backend/test/integration/auth-limiter.spec.ts`
and `backend/test/integration/auth-http.spec.ts` retain proof of the default
production rate limits.

## Task 12 final verification

Final complete outputs are captured in `/tmp/task12-gates/*-final.log` and
`/tmp/task12-gates/e2e-final.log`:

- `pnpm format:check` — PASS.
- `pnpm lint` — PASS, including 91 boundary/design-policy assertions.
- `pnpm typecheck` — PASS across shared, backend, frontend and evals.
- `pnpm build` — PASS across workspace packages; Next.js 16.4.3 emitted all
  workspace/auth/settings/platform routes.
- `pnpm test` — PASS, 421 tests across 99 files.
- `node --test scripts/test/*.spec.mjs` — PASS, 104/104 tests.
- `pnpm --filter @lexon/backend test:mutation:identity` — PASS, 218/218
  mutants killed, 100.00% mutation score against an 80% break threshold.
- `pnpm test:e2e` — PASS, 31/31 Playwright browser/API/topology tests, 0
  failures; the command started and cleaned up its owned Compose stack.

The required focused command was run during the verification cycle. Its early
failures were setup/selector corrections and the user-menu axe defect described
above; the final full E2E run includes the settled F2 cases and passes 31/31.
The user-menu accessible-name correction is the only production source change
in Task12 and is supported by the observed axe failure. The E2E-only override
also received a test-first Compose assertion that failed before the overlay
mapping and passed after it. Existing test selectors, CI branch trigger, route
guidance and test-only harness settings do not alter production auth rules,
public identity contracts, cursor behavior or backend authorization.

Task12 commit `25fa7bc`: main-session spec-compliance and code-quality reviews
passed. Reviewed the complete task diff and clean final logs; all eight required
gates passed. The owned E2E stack was removed. Whole-branch review follows.

## Final review fix wave

The consolidated final-review fixes retain the approved F1 auth, tenant,
contract, and cursor boundaries. `scripts/test/f2-route-inventory.spec.mjs`
now performs source traversal with Node APIs; the earlier no-`rg` failure was
reproduced locally as `spawn rg ENOENT`, and the no-`rg` fixture now passes 2/2.
The previous remote CI failure was not re-run remotely during this wave.

Unavailable bootstrap recovery now requires a fresh verified identity and
resumes five-second polling after recovery. Retry failure and failed sign-out
with failed fresh identity verification leave protected content hidden and
offer a safe retry; expired sessions remain terminal. Explicit switch and
sign-out pending state suppresses protected content and runtime across async
menu unmounts. It is tracked separately from access-key transitions, so MFA
recovery preserves the current selection without duplicate tenant cleanup.

The organization popup uses Base UI's position-aware `--available-height`,
scrolls internally, and enters the list on keyboard open. Browser coverage
checks 20 choices, viewport containment and keyboard reachability of Next/Create
at 375×812 and 1024×460. The 768px shell/panel check uses the live host and
production CSS with exact 256px sidebar/320px panel widths and text paint-bound
measurement. Its test-only aside mirrors RightPanel markup; it is not an
instance of the React RightPanel component, and no prior-constraint-disable
sensitivity run is claimed. Existing RightPanel tests remain its component
behavior check.

Mobile sidebar and UserMenu route navigation focus the new level-one heading;
Escape continues to return focus to the opener. Auth heading levels, 16px row
spacing, panel surface tokens, scoped distinct theme previews, and destructive
variant removal are covered by current unit/browser checks. The redundant MFA
tenant cleanup call was removed.

Final logs are captured in `/tmp/f2-finalfix-logs/`: `format-final.log`,
`lint-final.log` (91 boundary/design-policy checks), `typecheck-final.log`,
`test-final.log` (427 tests/99 files), `tooling-final.log` (104/104), and
`e2e-final.log` (34/34). Focused popup and UserMenu keyboard runs passed 1/1 in
`popup-focus2.log` and `usermenu-focus2.log`. The current source was rebuilt
inside the final owned Compose E2E run; the separately captured local root
`pnpm build` predates only the final Popover `initialFocus` setting. No remote
CI rerun is claimed. Deferred-transition sensitivity evidence is documented
as such, not as historical strict TDD RED. The existing E2E-only
signup/verification-resend IP override remains 100/IP/600s with account limit
3 and does not affect production configuration.

## Final review correction 2: identity response ordering

The scoped re-review identified one additional race: an identity poll already
in flight could complete after a newer manual verification and restore stale
platform eligibility in rendered state and the query cache. The supplied
actual-provider repro failed before the correction with `RefreshOld admin:true`
after the fresh ordinary identity had rendered. A repository regression in
`frontend/test/workspace-shell.spec.tsx` reproduced the same stale state and
cache publication before provider edits.

Identity polls, direct retries, and bootstrap synchronization now share a
monotonic request version and latest-verified ref. Manual verification cancels
the active `['identity']` query before the direct request; superseded query
responses cannot update local state or overwrite the query cache. Requiring a
fresh identity disables background polling and clears the accepted identity;
successful retry repopulates the cache and resumes five-second polling. This
preserves retry after `query.clear()`.

The regression checks both completion orders: old poll after the fresh manual
result, and old poll before the manual result completes. Both assert rendered
and cached identity. The repository race tests pass 2/2, the supplied temporary
repro passes 1/1, and the full workspace-provider file passes 26/26. Root
typecheck, root lint (91 checks), targeted Prettier/diff checks, and the
frontend production build pass. Logs: `/tmp/f2-finalfix-logs/identity-race-workspace.log`,
`identity-race-typecheck-final.log`, `identity-race-lint-final.log`, and
`identity-race-build-final.log`. The prior 427-unit and 34-E2E results belong
to the preceding fix commit and were not rerun for this narrow correction.

## Final review correction 3: same-URL reload test synchronization

CI run `41430736312` passed unit/integration checks, then failed one of 34 E2E
cases at the organization switch reload assertion. The switch intentionally
reloads `/workspace` at the same URL. Polling `page.evaluate(performance.timeOrigin)`
could overlap that document replacement and throw `Execution context was
destroyed`. The failure was in test synchronization; the app completed the
expected full-document navigation.

The browser test now registers `page.waitForEvent('domcontentloaded')` before
Enter, awaits the next document event, verifies the changed document time
origin, then confirms the newly selected organization. This avoids an already
matching URL wait and does not retry evaluation errors or add a delay. The
Playwright 1.64.1 Page API was checked against the official documentation on
2026-11-02: https://playwright.dev/docs/api/class-page.

The filtered keyboard-flow E2E passes 1/1 in the disposable stack at
`/tmp/f2-finalfix-logs/reload-sync-e2e.log`; Prettier, focused ESLint, and backend
typecheck pass. The full local E2E suite was not repeated; CI is expected to
rerun all cases at the new commit.

## Review closure and execution decisions

The main session accepted the whole-branch review and scoped corrections.
Commit `de996f2` addressed all five Important and five Minor original findings.
The scoped review then reproduced an identity-response race introduced by that
fix. Commit `72ed364` corrected it with test-first regressions for both response
orders. The final scoped review found the race addressed and no new breakage.
No Critical or Important finding remains open. Remote CI on the final branch
head is the final full-suite gate; its outcome is published on the pull request.

The following records every execution ruling from the temporary SDD ledger,
in order, including its reason and practical limit:

| Decision                                                                  | Reason and limit                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continue in the existing feature checkout.                                | The owner selected this branch/location; isolation is by feature branch rather than an additional worktree.                                                                                                                                                                        |
| Main performs per-task spec then quality review.                          | The owner's instruction overrides separate reviewer dispatch; independent task-review seats are not claimed.                                                                                                                                                                       |
| Keep every implementer on verified Luna/high, including fixes.            | The owner fixed the model; usage-limit interruptions were resumed without substituting a model.                                                                                                                                                                                    |
| Bound shape lint to static JSX and cva strings plus semantic slots/files. | The owner capped analyzer scope; dynamic class expressions require manual review.                                                                                                                                                                                                  |
| Use scoped notFound routes for bare and unknown organization URLs.        | This is the approved route-tree choice; build and browser tests cover it.                                                                                                                                                                                                          |
| Correct the plan's Vitest project name from shared to contracts.          | This matches the installed configuration; earlier test evidence was not relabeled.                                                                                                                                                                                                 |
| Retain the initial theme implementation with an explicit TDD exception.   | Later regression/sensitivity evidence supports behavior but cannot establish historical test-first order. The later shared-pending fix has the same documented evidence limit.                                                                                                     |
| Add the safe expired-session sign-in link.                                | The brief requires recovery; the link does not alter sign-out policy or clear credentials directly.                                                                                                                                                                                |
| Keep both old/new MFA security paths during task sequencing.              | This preserved restricted recovery before Task10 migration; old production routes are deleted in the final tree.                                                                                                                                                                   |
| Keep the closed panel host neutral, outside main.                         | The controlled panel owns its aside/dialog; a closed panel reserves no width or landmark.                                                                                                                                                                                          |
| Raise signup's E2E-only IP budget to 100/600s.                            | One simulated IP serves the expanded suite; account3/window600 and production defaults remain unchanged. Browser E2E does not prove the default-volume IP cap.                                                                                                                     |
| Apply the same E2E-only IP budget to verification-resend.                 | Email verification uses that action; backend integration tests retain default-volume limiter proof.                                                                                                                                                                                |
| Accept bounded live-shell structural panel geometry coverage.             | It uses the real host/CSS and measured256/320 widths but mirrors the desktop aside rather than mounting React RightPanel. No prior-constraint-disable sensitivity run is claimed; component tests cover actual panel behavior. The fixture could diverge from future panel markup. |
| Correct the new identity race beyond the one-wave process cap.            | A confirmed load-bearing regression could not be handed off as complete; the cost was one additional narrow fix/review cycle, without reopening broad scope.                                                                                                                       |

The temporary SDD workspace may be removed after final verification. The
committed design, plan, acceptance evidence and this decision record remain
the durable history; no ignored report is required to review the result.
