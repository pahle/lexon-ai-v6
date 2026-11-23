# Playbook: review an implemented slice

1. **Fetch** the feature branch; read the PR, the superpowers spec and plan,
   the brief, and the S6/findings docs the implementer wrote.
2. **CI first.** Check GitHub Actions for the head commit (unit +
   Testcontainers integration, Compose E2E). If your sandbox has no Docker,
   CI is the evidence for those layers.
3. **Run locally what you can:** `pnpm install --frozen-lockfile`,
   `pnpm lint`, `pnpm format:check`, `pnpm typecheck` per package,
   `pnpm test:unit`, `pnpm --filter @lexon/backend build`, mutation baseline
   if touched.
4. **Read the risky code**, starting with the plan's "Review Focus" items:
   tenant transactions/RLS, receipts/idempotency, concurrency/leases,
   health/lifecycle, boundary rules, secrets in Compose/env/logs, anything
   K1 (client content) near logs or telemetry.
5. **Check against the documents:** layering (domain → infrastructure only;
   lint rule `infrastructure-domain`), module boundaries, data classes K1–K3,
   accessibility for UI, English copy, no reference-product traces
   (`grep -ri mike`).
6. **Classify findings:** must-fix now (correctness, security, tenancy,
   architecture that later slices would compound) vs follow-up for a later
   brief (record in `STATE.md`).
7. **Fix must-fix items yourself** with TDD on a temporary branch from the
   feature branch, open a PR **into the feature branch**, wait for CI green.
   Record what changed in the implementer's findings doc.
8. **Write `reviews/F<n>-review.md`** here: what was checked, fixes,
   follow-ups. Update `STATE.md` and push this branch.
9. Tell the product owner (Indonesian): result, fixes, merge steps
   (fix PR → feature branch, then feature PR → `main`, Squash and merge,
   delete branches).

## Review habits (owner, 2026-11-23)

The brief generator is the only reviewer; there is no second reviewer
session. Apply these on every slice.

- **Decide gaps from the spec.** Before answering an implementer question
  about a visual or behavior gap, read the exact spec section (LEX-DS-001,
  LEX-ARC-001, the slice's superpowers spec) and the data contract. Decide
  from the spec, not from the prototype alone. A prototype value that
  contradicts its own pattern (for example hand-typed initials) is a
  prototype error: log it as a deviation.
- **No invented data.** Never add data the contract does not have (names,
  counts) to make a screen match the prototype. Use what the contract
  provides and log the difference.
- **Reuse first.** Prefer no new public route; reuse existing endpoints and
  components. Any contract change stops for the owner.
- **Visual review:** prototype comparison sheets are approved by eye, not by
  the 1.5% gate (that gate is for app goldens). Group differences as
  rendering noise, approved deviations, or real. Fix only real differences
  that violate the spec. Cap the rounds (at most 2 Linux UI rounds per area)
  and move leftovers to a named later slice.
- **Before every merge:**
  - check the head's CI yourself (`gh pr checks <n>`, once) and tell the
    owner the result;
  - check the branch contains `main` (`git merge-base --is-ancestor
    origin/main <head>`);
  - scan the diff for skipped tests (`.skip`, `.only`, `fixme`), removed or
    weakened assertions, working files (`.superpowers/`), secrets or `.env`
    content, and `console.*` / `TODO` leftovers.
- **Merge order:** merge the large feature PR first when the small PRs are
  only docs or config. Small PRs that touch code merge `main` afterwards.
- **PR hygiene:** every PR gets a real title, never the branch name. Remove
  temporary worktrees after their PR merges (for example
  `lexon-superpowers-skill` after #61).
- **Quota:** start implementer phases only when Claude quota is available
  on Devin.
