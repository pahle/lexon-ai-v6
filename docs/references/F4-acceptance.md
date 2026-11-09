# F4 acceptance evidence

Status: implementation in progress. Task 1 accepted locally after review;
Tasks 2–21 are pending. This is not F4 completion or visual approval.

Design and plan: [approved design](../superpowers/specs/2026-11-09-f4-chat-design.md),
[approved plan](../superpowers/plans/2026-11-09-f4-chat.md).
Branch: `f4-chat`. Draft [PR #29](https://github.com/pahle/lexon-ai-v6/pull/29).
No merge to main is authorized.

## Execution and owner gates

Implementation uses explicitly configured `gpt-6-luna`, reasoning `high`,
verified against the actual child turn context before implementation. Main
session accepts each task's spec compliance and code quality, with fresh scoped
review under Superpowers and a final whole-branch review still required.

STOP for owner feedback at Task 14 (thread preview), Task 15 (history/sidebar
preview), Task 17 (owner-run real smoke), and Task 19 (formal visual approval).
Normal Compose E2E remains on every PR push. Task 18 adds load dispatch and
relevant-change selection; final-head S2 evidence remains mandatory.

## Task 1 — approved pins and Caddy development/E2E routing

Source range: `e755c09..997a449`; initial implementation `5e97378`, port
compatibility correction `997a449`. Evidence below distinguishes the tested
revisions; the full Vitest run predates the focused port correction, whose
covering checks are recorded separately.

- Official Caddy and k6 exact images are in the shared manifest and loader,
  matching LEX-TS-001 v1.12. No UI dependency was installed or updated; k6 was
  not run.
- Caddy runs HTTP on host loopback, edge only, with no credentials or exposed
  admin endpoint. `infra/Caddyfile` forwards `/api/*` intact to the Backend API,
  other paths to Next.js, with immediate API flushing and 60-second upstream
  read timeout. Next.js no longer proxies API paths. SSR retains the internal
  Backend API URL.
- Browser/auth traffic and E2E descriptors use the Caddy public URL; direct API
  diagnostics stay on loopback. The actual pinned Caddyfile and running proxy
  were exercised, not only statically inspected.
- A held backend response emits frame A through Caddy while its release/end
  barrier remains closed. A new SSE request carrying `Last-Event-ID` and a
  synthetic cookie reaches the backend unchanged. Durable run replay and the
  client reconnect proof remain Tasks 8/10; this task proves proxy forwarding.
- Test-only probes are installed before Nest init by an explicitly passed
  bootstrap hook. The production API entrypoint does not pass it. F1 origin
  rejection and forged-forwarding-header protection remain covered.

Verification:

| Gate                                                  | Result / revision                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Clean baseline `pnpm test`                            | 895 tests / 148 files, exit 0, 129.38s at `e755c09`                                 |
| Implementer final `pnpm test` after bootstrap seam    | 896 tests / 148 files, exit 0, before port correction                               |
| Routing E2E through pinned Caddy                      | 3/3, repeated after port correction                                                 |
| Existing identity API/topology E2E                    | 6/6 at initial task source                                                          |
| Focused port-fix tooling                              | 11/11, including six routing tests                                                  |
| Controller full `node --test scripts/test/*.spec.mjs` | 133/133, exit 0, 743.71ms at `997a449`                                              |
| Omitted optional ports / actual Compose configuration | API 3001, frontend diagnostic 3002, public Caddy 3000                               |
| Typecheck, lint, format                               | Initial task gates passed; changed port scripts/Compose passed covering lint/format |

Existing local environments retaining `FRONTEND_HOST_PORT=3000` now receive an
explicit collision error recommending diagnostic port 3002. Caddy's public
port remains 3000; no local `.env` was read or rewritten by the fix.

TDD provenance: routing contract tests failed before implementation because
pins/loader/service/origin wiring were absent. The port regression had a focused
three-failure RED before its fix. The first behavioral E2E attempt failed from
registering test routes after Nest's not-found handler; that was a fixture
failure and is **not** historical behavioral RED evidence. No such evidence is
retroactively claimed. Actual barrier/header behavior subsequently passed.

Review: initial review found one Important default-port collision; fix round 1
addressed it, and scoped re-review found no new Critical/Important/Minor issues.
Main accepted the task after checking the source and covering evidence.
Retained nonblocking observations for final review: the small probe test assumes
its first read contains frame A (carry to actual stream parser work in Task 8),
and successful logs contain pre-existing Docker/color warnings. Output is not
described as pristine. Raw logs remain private because test infrastructure can
contain ephemeral credentials.

## Pending evidence

The runtime/tree/replay proof, Usage ledger and deletion/capacity races, summary
filter/timing cases, chat UI, search and evals, owner-run high/max smoke and
calibration, S2 load, visual approval and Linux golden evidence remain pending.
No real model request, paid eval dispatch or account/admin change was made.
Production TLS/hardening stays F20; P8 physical-region verification and F17
unknown-attempt cost reconciliation remain explicit follow-ups.
