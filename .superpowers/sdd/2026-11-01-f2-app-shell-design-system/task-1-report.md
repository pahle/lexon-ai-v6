# Task 1 report: owned UI dependency and shape rules

## Implementation

- Added `no-restricted-imports` for frontend and Word add-in source/test files:
  direct `radix-ui` imports and `radix-ui/*` / `@radix-ui/*` subpaths are
  rejected, while `@base-ui/react` remains allowed.
- Added the `lexon/circular-shape` ESLint rule. It checks static JSX
  `className` strings and static `cva` base/variant strings. Circular use is
  permitted for matching semantic slots in the radio group, switch, avatar,
  and status-dot owner files.
- Added actual-config fixtures and included them in `scripts/check-boundaries.mjs`.
- Documented dynamic expression coverage limits in
  `docs/references/F2-acceptance.md`.
- No frontend/backend business code, dependencies, or lockfile changed.

## Research notes

- ESLint `no-restricted-imports`: [official rule documentation](https://eslint.org/docs/latest/rules/no-restricted-imports), read 2026-11-01. Installed ESLint version checked from the root manifest: `10.14.0`. The docs confirm path and pattern restrictions are configured through this rule; used exact root path plus requested subpath globs.
- typescript-eslint parser: [official parser documentation](https://typescript-eslint.io/packages/parser/), read 2026-11-01. Installed `typescript-eslint` version checked from the root manifest: `8.72.1`. The docs confirm `.tsx` is parsed as JSX and the parser supplies ESLint-compatible AST nodes; the rule uses those nodes without type-aware analysis.
- Design source: `docs/specs/LEXON-03-DESIGN-SYSTEM.md` §4, and approved F2 design §4/research R15. Circular shapes are restricted to radio indicators, switch thumbs, initials avatars, and status dots; direct Radix imports are prohibited while the assistant-ui transitive dependency remains allowed.

## TDD evidence

### RED

Command: `node --test scripts/test/presentation-policy.spec.mjs`

Before implementation, exit code was `1`: 1 test passed and 4 failed. The
meaningful failures showed Radix imports were not rejected, circular shapes on
buttons were not rejected, and static `className`/`cva` strings produced no
shape diagnostics. The allowed-slot fixture passed. A Base UI assertion also
initially picked up an unrelated unused-import diagnostic; the fixture was
changed to a side-effect import before implementation.

### GREEN

Command: `node --test scripts/test/presentation-policy.spec.mjs`

Result after implementation and formatting: exit code `0`; 5 tests passed, 0
failed.

Command: `pnpm lint`

Result: exit code `0`; ESLint succeeded and the boundary runner passed 83 tests
(83 passed, 0 failed), including all existing boundary fixtures and the new
presentation-policy fixtures.

Command: `pnpm exec prettier --check eslint.config.mjs scripts/check-boundaries.mjs scripts/eslint/lexon-boundaries.mjs scripts/eslint/lexon-presentation.mjs scripts/test/presentation-policy.spec.mjs docs/references/F2-acceptance.md`

Result: exit code `0`; all matched files use Prettier code style. The
`git diff --check` command also succeeded.

## Changed files

- `eslint.config.mjs`
- `scripts/check-boundaries.mjs`
- `scripts/eslint/lexon-boundaries.mjs`
- `scripts/eslint/lexon-presentation.mjs`
- `scripts/test/presentation-policy.spec.mjs`
- `docs/references/F2-acceptance.md`
- `.superpowers/sdd/2026-11-01-f2-app-shell-design-system/task-1-report.md`

## Self-review and limitations

- Rule scope is limited to the semantic allowlist and static literals requested.
  It does not evaluate `cn(...)`, template expressions, variables, imported
  class strings, or arbitrary radius utilities. These limits are recorded in
  F2 acceptance notes.
- `word-add-in/` does not exist yet in this checkout. Its source/test glob is
  configured and actual-config fixtures verify it will be covered when added.
- The owned frontend currently has no direct Radix imports or static
  `rounded-full` violations, so no production component files needed edits.
- No changes were made to business behavior, dependencies, lockfile, or
  existing boundary rules.

## Review fix 1

Addressed review commit `2da297e` findings:

- Resolve allowlist paths from the rule module's repository root, so package
  lint invocations use the same file keys as root lint.
- Do not honor circular slots on `button`, `input`, or `Badge` elements.
- Match `rounded-full` tokens preceded by static Tailwind variants, such as
  `md:rounded-full` and `hover:rounded-full`.
- Added regressions for frontend-cwd package lint, same-owner disallowed
  elements, and variant-prefixed classes.

### Fix RED

Command: `node --test scripts/test/presentation-policy.spec.mjs`

On the reviewed implementation: exit code `1`; 6 tests, 3 passed and 3 failed.
The failures showed a valid radio slot rejected with ESLint cwd `frontend`, a
button carrying that slot allowed in the owning file, and variant-prefixed
classes unreported.

### Fix GREEN

Command: `node --test scripts/test/presentation-policy.spec.mjs`

Result: exit code `0`; 6 tests passed, 0 failed.

Command: `(cd frontend && pnpm exec eslint src)`

Result: exit code `0`; frontend package source lint passed with package cwd.

Command: `pnpm lint`

Result: exit code `0`; root ESLint succeeded and the boundary runner passed 84
tests (84 passed, 0 failed).

Command: `pnpm exec prettier --check scripts/eslint/lexon-presentation.mjs scripts/test/presentation-policy.spec.mjs .superpowers/sdd/2026-11-01-f2-app-shell-design-system/task-1-report.md`

Result: exit code `0`; all matched files use Prettier code style. The
`git diff --check` command also succeeded.
