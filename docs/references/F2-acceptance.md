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
