# F0 — Foundation

## Goal

Create the empty but production-shaped skeleton that every later slice builds
on. F0 delivers a pnpm monorepo with `backend/`, `frontend/`, `shared/`, and
`evals/`, and four backend runtimes that boot from one codebase. It also
delivers a local stack in Docker Compose, a tenant-safe database layer that
fails closed, and the quality gates (lint boundaries, tests, CI).

F0 has no end-user feature. Its value is that each of these is proven by a
test, so F1 onward never has to revisit them:

- the stack choices in LEX-TS-001 actually work together
- tenant isolation cannot be bypassed by accident
- module boundaries are enforced by tooling, not by convention

F0 is the implementation of spike **S6** (LEX-ARC-001 §10), except S6(b)
(Better Auth), which belongs to F1.

## Users and permissions

- **Developers** run the stack locally and in CI.
- There are no application users yet. There is no authentication in F0. The
  tenant context used by tests is passed explicitly, never derived from a
  request.

## In scope

### Repository and tooling

1. A pnpm workspace at the repository root with exactly these packages:
   `backend/`, `frontend/`, `shared/`, `evals/`. `word-add-in/` is created in
   F18; `infra/` is created in F19. `docs/` already exists. ESM only
   (`"type": "module"` everywhere).
2. One TypeScript 6.x and one Zod 4.x for the whole workspace, enforced with
   `pnpm.overrides`. All dependency versions are pinned exactly, and a
   lockfile is committed. Node 24 LTS is declared (`engines` and
   `.nvmrc` / `.node-version`).
3. Root scripts: `dev` (whole stack), `build`, `lint`, `typecheck`, `test`,
   `test:e2e`, and `format`. Each one also works per package via
   `pnpm --filter`.
4. ESLint (flat config) + Prettier across the workspace. These
   **boundary rules must fail the lint** when violated (LEX-ARC-001 §3.4):
   - `frontend/` and `evals/` must not import `backend/`; `frontend/` must not
     import `pg`, `drizzle-orm`, the AI SDK provider, or any server-only
     module.
   - `shared/` must not import any other workspace package or Node-only APIs.
   - `backend/` must not import `frontend/`.
   - Inside `backend/`, a domain module may import another module only through
     that module's public `index.ts`.
   - Only `backend/src/infrastructure/db` may import `pg` or `drizzle-orm`.
   - Only `backend/src/infrastructure/ai` may import `ai` provider packages.
   - Each rule has a fixture test proving that a violating import is rejected.

### `shared/` (package `@lexon/contracts`)

5. Contains only types, Zod schemas, and interfaces. No business logic and no
   Node-only APIs, so it runs in the browser.
6. Ships one real contract used end to end in F0: the **health/version
   response** schema. It also ships the conventions every later contract
   follows:
   - versioned event envelope type
   - error response shape
   - pagination shape
   - id format (UUID)

### Backend (`backend/`, NestJS 12, ESM project mode, Express adapter, built with `tsc` / `nest build`)

7. Folder layout as in LEX-ARC-001 §3.4. The infrastructure folders are
   `db`, `storage`, `queue`, `ai`, and `telemetry`. `modules/` contains only
   a `platform` module in F0. Other domain modules are created by their
   slices.
8. **Four entrypoints**, each with its own root module, as in LEX-ARC-001
   §3.6:
   - `api`: HTTP, global `/api` prefix
   - `ai-worker`: application context, no HTTP listener
   - `document-worker`: application context; must not load
     `infrastructure/ai`
   - `dispatcher`: application context; holds a Postgres advisory lock so
     only one instance is active, and a second instance waits
9. Configuration via `@nestjs/config`, validated with a Zod schema at boot.
   A missing or invalid variable stops the process with a clear message that
   **does not print secret values**. Each entrypoint validates only the
   variables it needs. The `VALKEY_QUEUE_URL`, `VALKEY_STREAMS_URL`, and
   `VALKEY_LIMITER_URL` connections are configured separately (LEX-ARC-001
   §5.4).
10. Structured logging via `nestjs-pino` in all four entrypoints, with a
    redaction list that covers at least: authorization and cookie headers,
    passwords, tokens, secrets, API keys, and any field named for content
    (prompt, message body, document text). Request ids are propagated.
11. Health:
    - `@nestjs/terminus` liveness and readiness for each runtime.
    - `api` exposes `GET /api/health`, validated against the `shared/` schema.
    - Workers expose health through a mechanism usable by Docker health
      checks.
    - Readiness checks the dependencies each runtime actually uses: Postgres
      and Valkey for all four, and object storage for `api` and
      `document-worker`.
12. **Request validation proof:** the `api` validates request input with a Zod
    schema from `shared/`, applied on the route decorator via Standard
    Schema support (LEX-TS-001 §2). An invalid body returns the shared error
    shape with HTTP 400. Use a minimal diagnostic endpoint that exists only
    for this purpose, or the health endpoint's query parameters. The same
    schema is imported by the frontend (item 24).
13. **AI SDK smoke proof:**
    - `infrastructure/ai` builds and runs AI SDK 7 with
      `@openrouter/ai-sdk-provider` in the ESM project, with no CommonJS shim.
    - A test streams from a **mock model**; no network call is made in CI.
    - The model allowlist is a reviewed configuration file. F0 only defines
      its shape; it is populated in F3.
14. **MCP client smoke proof:** `@modelcontextprotocol/client` v2 imports and
    constructs in the same project. A test talks to an in-process test server
    if the SDK provides one; otherwise this is a compile-and-construct check.
    Real connectors are F15.

### Database (`backend/src/infrastructure/db`, `backend/drizzle/`)

15. PostgreSQL 17 with the `pg_trgm` extension. Schemas `app`, `auth`, and
    `ops`. Roles exactly as in LEX-ARC-001 §3.2:
    - `lexon_migrator`: owner of the schemas; used only by migrations
    - `lexon_app`: no `BYPASSRLS`, not a table owner; DML on `app` and `ops`
    - `lexon_auth`: DML on `auth` only; used by F1

    Role creation and grants are part of the versioned SQL migrations, and
    migrations run as `lexon_migrator`.
16. Drizzle ORM + node-postgres. Connection pools are separate per role.
    Pool size and `statement_timeout` are configurable per runtime.
17. `withTenant(ctx, fn)`:
    - Opens a transaction and sets `app.org_id` and `app.user_id` with
      `set_config(..., true)` (transaction-local).
    - Runs `fn` with a transaction-bound client.
    - `ctx` is always explicit; there is no global or implicit context.
    - Rejects a context that has no org id.
    - The raw client and pool are **not exported** from the db module.
18. A documented RLS policy pattern for tenanted tables:
    - `org_id = NULLIF(current_setting('app.org_id', true), '')::uuid`
    - applies to both `USING` and `WITH CHECK`
    - `FORCE ROW LEVEL SECURITY` is on

    Later slices copy this pattern exactly.
19. A central **authorization predicate builder**: an interface and its first
    implementation. Every later read path must go through it. In F0 it only
    adds the org filter, and project and ethical-wall filters are added in F5.
    It is tested on its own.
20. **Fail-closed proof (mandatory tests):** with a tenanted test table under
    the policy pattern:
    - A query without context returns zero rows, without error, on a **fresh**
      connection.
    - The same holds on a **reused pooled** connection after a `withTenant`
      transaction has ended.
    - Tenant A cannot read, update, delete, or insert rows of tenant B.
    - `lexon_app` cannot disable RLS or read `auth` secrets.
21. An `ops.outbox` table and the dispatcher's lock-and-poll skeleton:
    - The dispatcher wakes on `LISTEN/NOTIFY`, with a polling fallback.
    - It claims rows with `FOR UPDATE SKIP LOCKED`.
    - It enqueues to BullMQ with **job id = outbox id**.
    - It retries with backoff when Valkey is unavailable. The row stays in
      the outbox, so nothing is lost.
    - F0 proves this with a no-op job type. The domain job types come with
      their slices.

### Queue and Valkey (`backend/src/infrastructure/queue`)

22. BullMQ 6 through `@nestjs/bullmq`. If S6 shows the two are incompatible,
    the fallback is the thin provider wrapper named in LEX-TS-001 §5; record
    the decision.
    - Queue names follow LEX-ARC-001 §5.3. F0 creates them only if they are
      needed by tests.
    - Producers are in `api` and `dispatcher`; processors are in workers only.
    - Tests: a job is processed; a failure is retried with backoff; enqueuing
      the same job id twice processes it once; `removeOnComplete` and
      `removeOnFail` are set.
23. Valkey 9.0.x (≥ 9.0.6) in Compose with `maxmemory-policy noeviction`,
    AOF `everysec`, a password, and internal networking. A test asserts the
    eviction policy at startup, and the `api` refuses to become ready if the
    policy is wrong.

### Frontend (`frontend/`, Next.js 16, React 19)

24. Scaffolded from the assistant-ui `default` template, then aligned to
    LEX-TS-001:
    - TypeScript 6.x; ESLint + Prettier instead of oxlint/oxfmt
    - `@assistant-ui/ai-sdk`
    - shadcn/ui style `base-nova` (Base UI)
    - Tailwind 4, Lucide
    - TanStack Query; React Hook Form with the Zod resolver
25. **The template's `app/api/chat` Route Handler and any direct model call
    are removed.** The frontend holds no server secrets and calls no model.
    Chat is wired to the backend in F3. The template's thread UI may remain
    as a static, disconnected shell, or be removed; F2 decides the layout.
26. In development, `rewrites` forward `/api/*` to the backend (LEX-ARC-001
    §3.5), so the browser talks to one origin.
    - A page shows the backend health/version, fetched through TanStack Query
      and the typed client from `shared/`.
    - A form validates with the same `shared/` schema used in item 12.
    - Server Components call the backend through `BACKEND_INTERNAL_URL`.
27. Route groups `(auth)` and `(workspace)` exist (empty). `proxy.ts` exists
    as a no-op placeholder; its redirect logic comes in F1.

### Local stack (Docker Compose)

28. `docker-compose.yml` at the root for development:
    - postgres 17
    - valkey 9.0.x
    - seaweedfs 4.x with the S3 gateway
    - the four backend runtimes from **one `backend/Dockerfile` with targets
      `api`, `ai-worker`, `dispatcher`, `document-worker`**
    - frontend

    Every image is pinned by exact tag. Every service has memory and CPU
    limits; development values are allowed.
29. Networks as in LEX-ARC-001 §2.2 (`edge`, `egress`, `core` internal,
    `sandbox` internal). `document-worker` is on `core` and `sandbox` only.
    **A test proves that `document-worker` cannot reach the internet.** ClamAV
    and the LibreOffice sandbox are added in F6, but their network slot
    already exists.
30. The S3 port interface exists in `infrastructure/storage` with an initial
    contract test (put, get, range get, delete, presigned PUT) that runs
    against SeaweedFS. Encryption is F6.

### Quality gates

31. Tests:
    - **Unit and integration:** Vitest with `@nestjs/testing`. HTTP tests
      start the app on an ephemeral port and use `fetch`; Supertest is not
      used. Decorator metadata works under Vitest.
    - **Database tests** run against a real Postgres (Compose or
      Testcontainers; record the decision), not mocks.
    - **E2E:** Playwright, with at least one browser test (the health page)
      and one `APIRequestContext` test.
    - **Mutation:** Stryker configured and running on at least the `db` and
      `platform` modules. A baseline score is recorded; F0 sets no threshold.
    - **`evals/`:** the package exists with a Vitest runner that boots a
      standalone NestJS application context, plus one trivial passing case.
      Real evals start in F3.
32. GitHub Actions CI on every PR:
    - install with frozen lockfile
    - lint (including boundary fixtures), typecheck, and build per package
    - unit/integration tests with service containers (Postgres, Valkey,
      SeaweedFS)
    - E2E smoke

    Jobs use `pnpm --filter` per folder. Supply-chain scanning (Syft, Trivy,
    OSV) and Renovate are added in F19; F0 only leaves room for them.
33. Developer docs: a root `README` section with prerequisites, one-command
    start, how to run each test layer, and how to add a migration. One page
    per `backend/` infrastructure folder explains its rule (for example, why
    `withTenant` is mandatory).

## Out of scope

- Authentication, sessions, organizations, users, `proxy.ts` logic → **F1**
- Design tokens, app shell, navigation → **F2**
- Real chat, runs, SSE stream hub, the populated model allowlist, usage → **F3**
- Domain tables and modules other than `platform` → their slices
- ClamAV, LibreOffice sandbox, OCR toolchain in the `document-worker` image,
  object encryption → **F6**
- Caddy, production Compose, backups, OTel Collector, Sentry, supply-chain
  scanning, Renovate → **F19**
- `word-add-in/` → **F18**

## Developer flows

1. **Fresh clone:** install pnpm deps, copy `.env.example`, and run one
   command to start the stack. All health checks turn green and the frontend
   shows the backend version.
2. **Breaking a rule:** importing `drizzle-orm` from a domain module, or
   `backend/` from `frontend/`, fails `pnpm lint` with a message naming the
   rule.
3. **Missing config:** removing a required variable makes the runtime exit at
   boot and name the variable, without printing values.
4. **Valkey down:** the dispatcher keeps outbox rows and retries. When Valkey
   returns, the queued no-op jobs are processed exactly once.
5. **Two dispatchers:** only one claims work; the other waits on the lock.

## Data and contracts

- `shared/`:
  - health/version schema
  - error shape
  - pagination shape
  - event envelope (with a version field)
  - diagnostic validation schema (item 12)
- Database: schemas `app` / `auth` / `ops`, roles, `pg_trgm`, `ops.outbox`
  (id, type, payload validated by the job type's schema, created/claimed/sent
  timestamps, attempt count), and the RLS policy pattern. The tenanted test
  table lives in test fixtures, not in product migrations.

## Non-functional requirements

- **Security:**
  - No secrets in the repo, logs, or test output; `.env.example` holds
    placeholders only.
  - The frontend container receives no database, Valkey, storage, or model
    credentials.
- **Tenancy:** fail-closed is proven by tests (item 20). A tenant-scoped query
  has no code path that skips `withTenant`.
- **Privacy:** log redaction is tested by asserting that a redacted field
  never appears in the log output.
- **Reproducibility:** exact pins, a committed lockfile, and pinned images.
- **Speed:** the unit test suite runs in under a minute locally (a target,
  not a gate).

## Research first

Read the current official docs at the pinned versions before brainstorming and
before writing each plan task (see `AGENTS.md`):

- pnpm workspaces and overrides — https://pnpm.io/workspaces, https://pnpm.io/package_json#pnpmoverrides
- NestJS 12 (ESM project mode, standalone applications, testing, configuration,
  queues, Terminus, migration guide) — https://docs.nestjs.com
- `nestjs-pino` — https://github.com/iamolegga/nestjs-pino
- AI SDK 7 and the Nest.js cookbook — https://ai-sdk.dev/docs, https://ai-sdk.dev/cookbook/api-servers/nest
- OpenRouter AI SDK provider — https://github.com/OpenRouterTeam/ai-sdk-provider
- MCP TypeScript client v2 — https://modelcontextprotocol.io
- Next.js 16 (rewrites, `proxy.ts`, route groups) — https://nextjs.org/docs
- assistant-ui (installation, `create` CLI, AI SDK integration) — https://www.assistant-ui.com/docs
- shadcn/ui with Base UI (`base-nova`) — https://ui.shadcn.com/docs, https://base-ui.com
- TanStack Query — https://tanstack.com/query/latest; React Hook Form — https://react-hook-form.com
- Zod 4 and Standard Schema — https://zod.dev, https://standardschema.dev
- Drizzle ORM (node-postgres, migrations, RLS) — https://orm.drizzle.team/docs
- PostgreSQL 17: row security, `set_config`, advisory locks, LISTEN/NOTIFY,
  `SKIP LOCKED` — https://www.postgresql.org/docs/17/
- BullMQ 6 — https://docs.bullmq.io
- Valkey 9.0 configuration and persistence — https://valkey.io/topics/
- SeaweedFS S3 gateway — https://github.com/seaweedfs/seaweedfs/wiki
- AWS SDK for JavaScript v3 (S3 client, presigner) — https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/
- Docker Compose (networks, `internal`, resource limits, multi-target builds) — https://docs.docker.com/compose/
- Vitest — https://vitest.dev; Playwright — https://playwright.dev; StrykerJS
  (Vitest runner) — https://stryker-mutator.io/docs/stryker-js/
- ESLint flat config and `no-restricted-imports` — https://eslint.org/docs/latest/
- GitHub Actions service containers — https://docs.github.com/actions

## Acceptance criteria

- [ ] One command starts the full local stack; all runtimes report healthy;
      the frontend page shows the backend version via `/api`.
- [ ] `pnpm lint`, `typecheck`, `build`, and `test` pass at the root and per
      package; CI runs all of them on PRs and is green.
- [ ] Every boundary rule in item 4 has a fixture that the lint rejects.
- [ ] One `shared/` Zod schema validates on a NestJS route (Standard Schema)
      and in a React Hook Form form.
- [ ] The four entrypoints build from one Dockerfile with four targets;
      `document-worker` does not load `infrastructure/ai`, and a test shows it
      has no internet access.
- [ ] RLS fail-closed tests (item 20) pass on fresh and reused connections;
      the cross-tenant read, write, and delete tests pass.
- [ ] `lexon_app` has no `BYPASSRLS`, owns no table, and cannot read `auth`
      secret columns (tested).
- [ ] Outbox → BullMQ: idempotent job id, retry with backoff, no loss while
      Valkey is down, single active dispatcher (tested).
- [ ] Valkey `noeviction` and AOF are verified at startup.
- [ ] Config validation fails fast without leaking values; log redaction is
      tested.
- [ ] AI SDK 7 + OpenRouter provider run in ESM with a mock model; the MCP v2
      client constructs.
- [ ] The S3 contract test passes against SeaweedFS.
- [ ] Vitest (with decorator metadata), Playwright (browser + API), Stryker,
      and the `evals/` runner all execute.
- [ ] S6 findings (versions confirmed, fallbacks taken, incompatibilities)
      are recorded, and LEX-TS-001 / LEX-ARC-001 revision notes are proposed
      if anything differs.

## References

- LEX-TS-001: §2, §4 (database rows), §5 (BullMQ, Valkey), §6 (storage
  contract), §7, §8, §9 (P9)
- LEX-ARC-001: §2.1, §2.2, §3.2 (roles, `withTenant`, fail-closed), §3.4,
  §3.5, §3.6, §4 (data rules), §4.1 step 2 (outbox), §5.3 (queues, limits),
  §5.4, §10 (S6)
- LEX-DS-001: not applicable yet (F2)

## Open questions

1. Database tests: Testcontainers or the Compose services? Record the choice.
2. Worker health: a tiny HTTP port per worker, or a file/exec health check?
   Pick the one Docker and CI handle most simply.
3. If `@nestjs/bullmq` or the Better Auth adapter turns out to be
   incompatible with NestJS 12 ESM, the fallbacks are pre-approved in
   LEX-TS-001. Any other incompatibility goes back to the product owner.
4. Should the template's disconnected thread UI stay in F0 as a visual
   placeholder, or be removed until F3?
