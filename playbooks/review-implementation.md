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
