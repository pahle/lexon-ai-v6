# F3 AI Run Engine — Task 2 implementation report

Date: 2026-11-05
Branch: `f3-ai-run-engine`
Base: `f68e78c987beff4b5b61ebba5fe1fa29704f8265`

## Scope delivered

Task 2 adds durable run, step, attempt, checkpoint, and capacity storage; strict shared IDs/tenant context corrected from the Task 1 owner review; AI worker capacity configuration; RLS scoped repositories; and same-transaction global/per-organization admission. It does not add run execution, job transport, usage policy, or model/provider orchestration.

The schema is a single append-only migrator-owned migration, `backend/drizzle/0015_ai_engine.sql`, plus the journal entry and matching Drizzle schema. Tenant tables use forced RLS and composite tenant relationships. Admission is serialized by a singleton capacity-row lock and a same-trigger slot index; only the capacity path uses a narrowly scoped fixed-search-path `SECURITY DEFINER` helper. There is no SECURITY DEFINER run-to-org lookup. Runtime repository methods take tenant sessions; no raw client was exported.

Claim, renewal, and checkpoint operations preserve the expected run version/step sequence for the same durable delivery after a crash. Expired takeover succeeds with the original envelope version, advances the fencing token only, marks only the expired fence's active attempts `unknown`, and rejects the stale owner's later metadata, checkpoint, settle, and commit calls. Renewal/fencing does not advance run version.

## Task 1 contract correction TDD

Before new repositories consumed the shared contract, behavioral tests were added and run:

- RED: `pnpm exec vitest run --project contracts ai-run.spec` exited 1 with four behavioral failures: missing tenant context was accepted, Lexon message/operation IDs were not constrained to UUIDs, SDK opaque IDs were trimmed, and the positive run job fixture lacked required context. These were schema behavior failures, not import/setup errors.
- GREEN: the same command passed **8 tests / 1 file**, exit 0. Run start/advance/resume require strict `{orgId,userId}` UUID context and UUID run IDs; legacy `platform.noop` keeps optional `userId`. Stream run IDs, Lexon-generated message IDs, and operation IDs are UUIDs. SDK text/tool/approval IDs are nonempty opaque strings with max 256 code units and are preserved byte-for-byte (no trim).
- `pnpm --filter @lexon/contracts build` and `pnpm --filter @lexon/backend typecheck` passed, exit 0. The contracts test was rerun on final source and remained 8/8 passing.

## Storage/config TDD and behavior evidence

- Initial RED: `pnpm exec vitest run --project backend-integration --project backend-unit ai-storage.spec ai-capacity.spec ai-config.spec` failed because the new fixture/config exports did not yet exist. This established the expected missing-implementation boundary.
- GREEN: after implementation the focused command passed **14/14 tests / 3 files**, exit 0. Added tests cover tenant-scoped durable record roundtrip, schema/FK isolation, no-context fresh and reused connection fail-closed probes, claim takeover/fencing, usage metadata/checkpoint/commit, capacity configuration, refusal rollback, and concurrency.
- Positive roundtrip was added as requested. Existing repository behavior already supported the intended record flow; its initial RED was only the missing new test-fixture helper, not a production behavior failure. No artificial production regression was introduced to manufacture a behavioral RED.
- `pnpm exec vitest run --project backend-integration ai-storage.spec ai-capacity.spec tenant-isolation.spec auth-privileges.spec` passed **17/17 tests / 4 files**, exit 0.
- Capacity evidence: tests saturate global 24 across at least four organizations and verify a 25th refusal; saturate org A at six and verify org B still starts; exercise concurrent last-slot admission from independent connections, rollback, approval-held capacity, one-time terminal release, and startup fingerprint mismatch rejection.
- Measurement/config values follow the approved addendum and `F3-stream-memory.json`: `maxLen=1024`, `eventBytes=4096`, `slotBytes=6_291_456`; a 1024-entry Valkey stream observed 5,269,728 bytes on pinned Valkey 9.0.7/aarch64. Default memory budget is 30 slots; terminal capacity is 6; active capacity derives to 24; per-org active cap is 6.

## Official exact-version research

Read 2026-11-05; linked sources and decision notes are also recorded in `docs/superpowers/specs/2026-11-05-f3-ai-run-engine-design.md`:

- PostgreSQL 17.11: official [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html), [row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), and [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html). These support singleton-row serialization, forced RLS/default denial without tenant context, and constrained trigger helper configuration.
- Drizzle: official [migration guidance](https://orm.drizzle.team/docs/migrations); installed `drizzle-orm@0.45.4` and `drizzle-kit@0.31.11` were checked, and the installed migrator implementation was inspected. It consumes `_journal.json` in order, hashes SQL, and splits on `--> statement-breakpoint`; this supports the one append-only `0015` migration approach.
- Existing `0014_admin_setup.sql`, journal conventions, DB README, and repo transaction patterns were read. The new integration fixture seeds identities only through the migrator; behavior and RLS assertions use `lexon_app` and `withTenant`.

## Final verification

All commands below were run against the final source; each exited 0:

- `pnpm build` — shared, frontend, backend, and eval builds passed.
- `pnpm typecheck` — all four workspace typechecks passed.
- `pnpm lint` — passed, including 85/85 architecture boundary checks.
- `pnpm format:check` — all files passed Prettier.
- `git diff --check` — passed.
- `pnpm test` — **531 tests / 113 files passed**, 57.13s. It emitted the three known jsdom `Not implemented: navigation to another Document` warnings; no test failed. Baseline before Task 2 was 514 tests / 110 files with the same three warnings.

Intermediate validation issues were corrected before final gates: the first migration validation identified the need for a unique `(org_id,id)` key backing a checkpoint-to-attempt composite FK; an early test cleanup path could not delete forced-RLS rows, so cleanup was moved to tenant-scoped app transactions; and lint flagged a needless initializer in the integration fixture. No such failures remain in final verification.

## Files changed

- `shared/src/ai-run.ts`, `shared/test/ai-run.spec.ts`
- `backend/drizzle/0015_ai_engine.sql`, `backend/drizzle/meta/_journal.json`
- `backend/src/config/ai-config.ts`, `backend/src/config/runtime-config.ts`
- `backend/src/infrastructure/db/ai-records.ts`
- `backend/src/infrastructure/db/ai-{run,step,attempt,capacity}.repository.ts`
- `backend/src/infrastructure/db/{db.module.ts,index.ts,schema.ts}`
- `backend/src/infrastructure/db/testing/ai-fixture.ts`
- `backend/test/integration/ai-{storage,capacity}.spec.ts`, `backend/test/unit/ai-config.spec.ts`
- `docs/references/F3-acceptance.md`, `docs/superpowers/specs/2026-11-05-f3-ai-run-engine-design.md`

## Commit

Implementation commit: `c0c201d` (`feat(ai): add durable run storage and admission`). The final evidence correction is committed separately after this report update.

## Concerns

No known unresolved Task 2 issue. The three jsdom navigation warnings are existing baseline output. Later-task behavior remains deliberately out of scope.
