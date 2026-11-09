# F3 review and F0–F3 holistic check

Date: 2026-11-09. Main at `0ce5215` (F3 squash, PR #27). CI green (run 42582689388).

## F3 during implementation
- Spec/plan reviewed; Codex Tasks 1–4 and the final review (R1–R4) reviewed in chat.
- Brief-generator fix: `backend/test/e2e/valkey-policy.spec.ts` asserted CONFIG GET
  order; now parses pairs into a map (PR #26 into the feature branch).
- Session 2: Task 9 hop-latency gate diagnosed as a measurement artifact; fix PR #25 (uncontended hop test, DB org-cap claim no longer acked as noop).

## Holistic check on main (F0–F3)
| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile`, lint, format | pass |
| tooling tests | 127/127 pass |
| typecheck | pass after `@lexon/contracts` and `@lexon/backend` builds; a stale `backend/dist` makes `evals` fail locally (evals types resolve through backend `dist`). CI builds first. DX note only. |
| CI triggers | push on `main` only + PR + dispatch (old feature-branch list gone). Feature branches need an early draft PR to get CI. |
| Real evals workflow | `workflow_dispatch` only, `main` and non-fork guard, `contents: read`, concurrency 1, 10 min timeout, key from secret, ZDR and allocation attestations from repo variables. OK. |
| Secrets | `OPENROUTER_API_KEY` read only from env (ai.module, smoke, real-evals); `.env` ignored; tests use fake values. OK. |
| Migrations 0015–0022 | `app.ai_*` tables FORCE RLS with `tenant_boundary` to `lexon_app`; SECURITY DEFINER functions pin `search_path`, revoke PUBLIC, and actor facts require matching `app.org_id`/`app.user_id` context. Approval decision columns constrained by lifecycle CHECKs; decider FK RESTRICT. OK. |
| Worker composition | real queues + job-type registry replace the F0 no-op consumer (follow-up closed). Consumer still builds a small internal Nest context for BullMQ processors; acceptable. |
| Repo hygiene | clean tree; largest tracked files are the lockfile and the brand PDF. |

No defects requiring a fix PR.

## Carried follow-ups
- F4: replace the inert runtime with the ChatTransport; SSE hub over the F3 streams.
- F5: approval expiry; external tool adapters on the F3 idempotency modes.
- F8 (before): calibrate the token estimator with real usage.
- F17: reconcile cost for unknown attempts; customer quotas; audit RLS note.
- P8: production region decision (OpenRouter Azure/US routing today).
- PO setup: real smoke + paid evals need the new key secret, ZDR-only account, attestation variables.
