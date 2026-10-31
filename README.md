# Lexon

English-language legal AI workspace. The repository is being built slice by slice from `docs/`.

## Foundation development (in progress)

Prerequisites: Node 24.22.1, pnpm 10.33.1, and a running Docker Engine. Install with `pnpm install --frozen-lockfile`. Application startup and full Compose E2E are introduced later in F0; their scripts are not yet usable.

`pnpm test` starts one private Postgres/Valkey/SeaweedFS test stack. Each integration file owns a fresh database cloned from a migrated template, Valkey prefix, and S3 bucket. The default has no pre-started-stack requirement and destroys its owned resources at teardown. `pnpm --filter @lexon/backend test` runs backend unit and integration projects. `pnpm test:unit` runs unit/contract projects without containers. Integration parallelism is capped at two files; image pulls/startup are outside the unit-suite speed target.

Optional local speed-up: `LEXON_TEST_REUSE=1 pnpm test` retains reusable test containers but still creates fresh migrated templates and per-file resources. Its local credential is generated in ignored `.cache/` with restrictive file permissions. Never enable reuse in CI; the runner rejects it. Stop retained test containers through Docker when finished. No test cleanup flushes all Valkey keys or drops a database outside its generated namespace.

Container pins live only in `config/container-images.env`, as exact tags and digests. Testcontainers reads this file; the Compose task uses the same manifest.

Migration bootstrap connects with an administrative identity only to provision the non-superuser migrator login and database. Versioned SQL migrations then run as `lexon_migrator`, which owns `app`, `auth`, and `ops`. `lexon_app` and `lexon_auth` are created by those migrations; their passwords come from secret runtime inputs, never committed SQL. Runtime processes must never receive administrative or migrator credentials. `backend/drizzle.config.ts` describes the Drizzle Kit migration location; do not run schema push against deployed databases.

The backend now has independent API, AI-worker, document-worker and dispatcher
roots. After building shared/backend, their commands are respectively
`node backend/dist/entrypoints/api/main.js`,
`node backend/dist/entrypoints/ai-worker/main.js`,
`node backend/dist/entrypoints/document-worker/main.js`, and
`node backend/dist/entrypoints/dispatcher/main.js`. Boot validates only the
selected role's settings. API serves `/api/health`, `/api/health/live`, and the
shared-schema diagnostic POST `/api/diagnostics/validation`. Workers expose
health through the exec checker and a writable health-file path.

All test entrypoints build the package exports they exercise. Integration
global setup also compiles child-process fixtures before starting its single
infrastructure set. `evals` consumes only `@lexon/backend/evaluation`; its F0
context boots actual Nest DI without HTTP, infrastructure or model credentials.
Compose startup and E2E commands are completed in their later plan tasks.
