# F0 S6 findings

Status: in progress. No foundation acceptance criterion is complete yet.

## Task 1 toolchain

- Source generators: Nest CLI 12.0.11 ESM and assistant-ui CLI 0.0.127 default.
- Nest emitted Vitest/Vite configuration with no explicit metadata plugin; characterize this before selecting a transform.
- Exact dependency versions and peer evidence are recorded in F0-versions.md.
- Real runtime, database, queue, AI/MCP, storage and topology proofs remain pending.

### Verified result

- `pnpm exec vitest run --project backend-unit backend/test/unit/toolchain.spec.ts`: 1 test passes using native Vite 8 transformation, with no SWC plugin.
- The expected missing-metadata failure in the plan does not occur: the current scaffold/toolchain already implements this capability. Keep this characterization proof instead of disabling working behavior to fabricate a RED result.
- Product entrypoints and feature behavior are still absent; only a test-owned DI fixture exists.

Task 1 final checks: root test 1/1; backend typecheck; TS6 fixture compilation and Node ESM import; ESLint; single TS 6.0.3 and Zod 4.6.7 resolutions; frozen install with unchanged lockfile. Full application build and other-package suites are deliberately pending their owning tasks, not reported as passing empty suites.

## Task 2 contracts

18 contract cases pass (19 total with metadata proof). Shared build/typecheck, filtered package test, and Vite browser-target bundle/import succeed. The failing first run found the missing contract export; implemented only browser-safe schemas/types/interfaces.

## Task 3 boundaries

47 executable ESLint fixture cases pass, including alias/relative path normalization, type imports, re-exports, dynamic-import bypass rejection, privileged-driver ownership, and exactly one public eval entry. Root and filtered frontend lint execute the fixtures. Root application tests remain 19/19. Fixtures run in a temporary tree with real ESLint10/TypeScript parser; no blanket test-file exemption.

## Task 4 configuration and logging

Runtime-specific config and actual Pino/HTTP logging tests pass (36 tests total). Invalid URL exceptions were caught by the failing privacy test and are now reduced to configuration field names. A failing child-logger test demonstrated Pino child bindings bypass log formatters; a final streamWrite allowlist now removes arbitrary bindings while preserving request IDs. Captured real log JSON excludes all tested credential/content sentinels. Backend build/typecheck and root lint pass.

## Task 5 real test infrastructure

One Vitest integration global setup starts the pinned dependency stack, migrates as a non-superuser lexon_migrator, and clones a closed template per test file. Parallel A/B files prove the same logical row/key/object name remains isolated across databases, prefixes and buckets. Role ownership and grants, pg_trgm and idempotent migrations pass. Runtime role credentials are configured out of band. Default containers are torn down; local opt-in reuse still uses fresh templates/namespaces and is rejected in CI. Cleanup orchestration has failure-path unit proofs.

Observed compatibility details: SeaweedFS S3 config uses accessKey/secretKey (not AWS SDK accessKeyId/secretAccessKey). Its per-bucket collection growth required more than two volume slots; the integration image now allows 64 small volumes instead of failing concurrent bucket writes. Vitest5 requires separate sequence groupOrder when maxWorkers differs between integration and unit projects.

## Task 6 tenant boundary

Real PostgreSQL tests pass for fresh and size-one reused connections after both commit and rollback. The fixture is populated with a third tenant before no-context probes, avoiding an empty-table false proof. A/B read/update/delete/insert isolation, role restrictions, session expiration, missing-user reset and statement timeout recovery pass. Opaque sessions hold no public client/pool; runtime import-boundary fixtures reject private db/session and test-helper access. Public class declarations expose only options, callbacks, status and lifecycle. Root tests: 48/48; lint fixtures: 51/51; backend build/typecheck pass.
