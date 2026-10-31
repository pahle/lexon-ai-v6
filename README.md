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

For the development Compose stack, copy `.env.example` to `.env` and replace
all `REPLACE_ME` values with independently generated local secrets. The launcher
derives database/Valkey URLs from those secrets and writes SeaweedFS credentials
to ignored `.cache/compose-development/s3.json` with restricted permissions.
Run `pnpm dev`; it supplies the shared pinned-image manifest explicitly, builds
images, bootstraps the database, runs migrations and creates the S3 bucket before
starting dependent runtimes. Visit http://localhost:3000 and
http://localhost:3001/api/health. No data service publishes a host port.

`pnpm --filter @lexon/frontend dev` selects the frontend and its dependencies;
`pnpm --filter @lexon/backend dev` selects the API by default. Set
`LEXON_RUNTIME=ai-worker`, `document-worker` or `dispatcher` to select that root.
Ctrl-C stops attached development containers; persistent volumes are retained.
No command prunes unrelated Docker resources. `pnpm test:e2e -- --project
runtime-health` creates a uniquely named stack with temporary random secrets and
host ports, then removes only its own containers/networks/volumes on completion.
Integration tests continue to run independently through `pnpm test`.

Development resource limits: Postgres 384MiB/0.75 CPU, Valkey128MiB/0.25CPU
(with a 96MiB key budget), SeaweedFS256MiB/0.5CPU, each backend384MiB/0.5CPU,
frontend256MiB/0.5CPU. Setup jobs have the same bounded backend limits and exit.
These are development budgets; production calibration belongs to later slices.
Backend roots run as non-root with read-only filesystems and writable tmpfs for
health and temporary files. Frontend remains off core and secret-free; outbound
connectivity on the non-internal development edge is the recorded F0 gap, with
frontend no-egress enforcement deferred to F20.

E2E project filters are `runtime-health`, `backend-api`, `frontend-browser`,
`topology`, and `evaluation-smoke`. `pnpm --filter @lexon/backend test:e2e`
runs runtime/API/topology checks; frontend runs the browser project; contracts
runs the shared API contract project; evals runs the image's public evaluation
context proof. All launch their own real stack, including when filtered.

The topology test uses a fixed-response endpoint on egress and a direct-IP
TCP attempt. API reachability is the positive control before document-worker
failure is accepted; core services must remain reachable from that worker.
Wrong Valkey policy/AOF/fsync cases run serially in a separate nested project,
then correct settings recover. These tests never reconfigure the integration
bed or an existing development project. Startup interruption and failure both
tear down the owned E2E project and remove its private credential directory.
