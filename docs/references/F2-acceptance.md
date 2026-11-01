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
