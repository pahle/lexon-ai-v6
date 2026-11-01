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
