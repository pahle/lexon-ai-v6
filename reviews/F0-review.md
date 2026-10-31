# F0 review (2026-10-31)

Branch `f0-foundation`, head 4cd9545, PR #6. CI (Linux) green on head:
unit+Testcontainers integration and Compose E2E jobs.

## Checked
- Review Focus items: receipt-first INSERT ON CONFLICT in the tenant tx
  (correct); claim/markSent token + lease conditional (correct); health
  snapshot/checker (tested); boundary resolver (paths, aliases, dynamic
  imports); per-file Testcontainers isolation.
- Compose: read-only rootfs, cap_drop ALL, tmpfs health, per-service limits,
  secret scoping, networks per §2.2, edge non-internal (F20 gap recorded).
- Allowlist has region; frontend has no chat route/secrets; clean-room grep ok.
- No behavior traced to the reference product; F0 is infrastructure only.

## Fixed by brief owner (PR #7 into f0-foundation)
1. withTenant released the client normally after a failed ROLLBACK
   (possible reuse of open tx + tenant context). Now release(err).
2. infrastructure/{db,queue,ai} imported modules/platform (cycle).
   New lint rule infrastructure-domain; envelope moved to db.

## Follow-ups recorded for later briefs
- F3: production ai-worker starts a consumer on `ai-interactive` with a
  no-op handler and a nested Nest context per consumer; F3 must replace it
  with a job-type → handler registry and real queue routing (§5.3 queues).
- Process: the design commit 5ad2e9f landed directly on main (harmless doc).
