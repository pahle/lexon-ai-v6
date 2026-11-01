# Lexon

Lexon is an English-language legal AI workspace, built slice by slice from
`docs/`. F0 provides the foundation; F1 adds verified accounts, personal/team
organizations, invitations, authenticator security, and operator-led platform
setup. Chat, document pipelines, and the full application shell remain later slices.

## Start locally

Use Node **24.22.1**, pnpm **10.33.1**, and Docker Engine with Compose. A Docker
Desktop installation or Linux Docker daemon works; allow roughly 4GB of memory
for the development stack plus image builds. Run:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Replace every `REPLACE_ME` in `.env` with independently generated local values.
For each password/access key, `node -e
"console.log(require('node:crypto').randomBytes(24).toString('hex'))"` produces a
suitable value. Keep `.env` private. The launcher derives database/Valkey URLs
from the individual secret fields, overriding the example URLs. It writes the
SeaweedFS credential config only to ignored `.cache/compose-development/` with
restricted permissions. No model key is needed.

```sh
pnpm dev
```

This one command builds the images, starts the data services, bootstraps the
database, runs migrations, creates the S3 bucket, and starts the four backend
roots and frontend. Visit http://localhost:3000 and
http://localhost:3001/api/health. No data service publishes a host port.
Ctrl-C stops the attached services and retains development data volumes.
`pnpm dev -- --detach --wait` starts in the background. Stop the `lexon-dev` project in Docker Desktop to retain its data. No command
prunes Docker resources.

`pnpm --filter @lexon/frontend dev` selects frontend plus its dependencies.
`pnpm --filter @lexon/backend dev` selects the API. Set
`LEXON_RUNTIME=ai-worker`, `document-worker`, or `dispatcher` to select a
standalone backend root. Shared/evals development selects the API proof.
Frontend browser requests use `/api`; Next forwards to `BACKEND_INTERNAL_URL`.
Server rendering uses the internal API URL with a deadline, and builds require
no running backend.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm format:check
```

Each workspace also supports `lint`, `typecheck`, `build`, `test`, `test:e2e`,
and `format` through `pnpm --filter @lexon/<package>`. Build `contracts` before
backend/frontend, and backend before evals. Vitest test commands prepare the
built package exports automatically. Formatting skips vendored skills,
generated outputs, and source specification/brief inputs.

`pnpm test` runs unit/contracts and real integration tests independently of any
running stack. Vitest global setup starts one Postgres, Valkey and SeaweedFS set
per integration run, migrates a template, then isolates each file with a cloned
database, a Valkey prefix and an S3 bucket. Parallel integration files are capped
at two. Teardown removes owned resources only; it never flushes shared keys.
`pnpm test:unit` excludes integration containers. The backend filtered `test`
command includes its unit and integration projects.

Optional local reuse: `LEXON_TEST_REUSE=1 pnpm test` retains reusable containers,
while still creating new templates and file resources. Its ignored local
credential has restricted permissions. Reuse is never the default and is
rejected in CI. Stop retained test containers by their IDs when finished.

`pnpm test:e2e` starts a unique Compose project with random temporary secrets
and host ports, runs Playwright, then removes that project's containers,
networks, volumes and private files, including on startup failure/interruption.
Install the exact runner's browser first: `pnpm exec playwright install chromium`
(on Linux, add `--with-deps`). Project filters are:

| Project            | Proof                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `runtime-health`   | Four runtime/data health checks and host access                                                |
| `backend-api`      | Shared health/validation contracts and built eval export                                       |
| `frontend-browser` | SSR/browser version, same-origin query and validation                                          |
| `topology`         | Network memberships, document-worker no-egress, secret scope, Valkey policy rejection/recovery |
| `evaluation-smoke` | Public evaluation context in the built backend image                                           |

For example, `pnpm test:e2e -- --project runtime-health`. Filtered backend E2E
runs runtime/API/topology; frontend runs browser; contracts runs backend API;
evals runs evaluation smoke. Wrong-Valkey tests use a separate nested project,
never an integration container or developer stack. The direct-IP no-egress
probe has a successful API control and verifies permitted core connectivity.

Run `pnpm --filter @lexon/backend test:mutation` for the Stryker baseline.
It covers authorization-predicate and job-envelope validation only, with normal
Vitest assertions. Reports are regenerated under `backend/reports/mutation/`.
F0 sets no threshold. Transaction/receipt/crash coverage comes from the real
integration tests; the accepted mutation scope does not include that behavior.
See [S6 findings](docs/references/F0-S6-findings.md) for measured counts.

## Database changes

Bootstrap uses an administrator only to create the non-superuser migrator and
database. Versioned SQL runs as `lexon_migrator`, owner of `app`, `auth`, and
`ops`; it creates the application/auth roles and grants. Passwords arrive through
setup-only inputs. Runtime containers receive only the application URL.
No frontend database role exists.

For a new migration, add the Drizzle schema under the db infrastructure folder,
generate/review SQL with `pnpm --filter @lexon/backend exec drizzle-kit generate`,
and commit the SQL plus migration metadata. Test it against a newly migrated
template using `pnpm --filter @lexon/backend test`. Apply it through the same
migration setup job; never schema-push a deployed database. Use a forward
corrective migration for defects. Destructive rollback requires an explicit
backup/restore decision; F0 supplies no automatic down-migration or production
backup system. Updating role secrets on an existing volume requires a deliberate
credential rotation; changing `.env` is not an administrative password reset.

All tenant access uses `withTenant(ctx, fn)` and the central authorization
predicate. Jobs use a processed-job receipt and the handler's database effect
in that same transaction: at-least-once delivery, effectively-once PostgreSQL
effects. Receipt retention metadata defaults to 30 days, but F0 never deletes
receipts. Later cleanup must exceed every redelivery window. External API
effects need their own idempotency design.

## Runtime boundaries

The backend API, AI worker, document worker and dispatcher have independent
entrypoints under `backend/src/entrypoints/`. Workers bind no HTTP port. Health
files live on writable tmpfs and are read by the compiled checker; liveness and
readiness are separate. The document worker loads no AI infrastructure.
Evals imports only `@lexon/backend/evaluation`, which boots an actual standalone
Nest context without F0 infrastructure/model secrets.

Container pins are literal exact tags/digests in
`config/container-images.env`, shared by Compose and Testcontainers. Development
limits are Postgres384MiB/0.75CPU, Valkey128MiB/0.25CPU (96MiB key budget),
SeaweedFS256MiB/0.5CPU, each backend384MiB/0.5CPU and frontend256MiB/0.5CPU.
Backend roots run non-root with read-only filesystems and health/temp tmpfs.
Production sizing is later work.

The frontend is edge-only and receives no infrastructure secrets. **Known F0
gap:** its non-internal development edge permits outbound connectivity to
preserve host access. Frontend no-egress/Caddy/firewall enforcement belongs to
F20. Authentication is F1, workspace design F2, AI execution F3, chat F4,
processing/encryption F7, add-in F19, production operations F20.

Each infrastructure folder has its own rule page:
[db](backend/src/infrastructure/db/README.md),
[queue](backend/src/infrastructure/queue/README.md),
[storage](backend/src/infrastructure/storage/README.md),
[AI](backend/src/infrastructure/ai/README.md), and
[telemetry](backend/src/infrastructure/telemetry/README.md).

## Identity and organizations (F1)

Use `pnpm dev -- --mail` for the optional development Mailpit profile. Its inbox
is at http://127.0.0.1:8025; SMTP stays inside Compose, with ephemeral storage
and no relay/forwarding. Configure `SMTP_URL=smtp://mailpit:1025` and a valid
`SMTP_FROM` in your private `.env`. Without that profile, configure your SMTP
transport. Mailpit is never required for automated tests or production.

Register, verify the emailed link, then sign in and complete onboarding. Every
account receives an atomic Personal organization. Team membership and selection
are verified by the server on every request. Owners promote owners; invitations
only grant member/admin roles. A consumed invitation can be retried only by its
original recipient while their membership still exists. Departures produce an
ID-only audit event; F18 will design handover.

Bootstrap platform administrators from an operator terminal:

```sh
pnpm identity:setup-admin -- --email operator@example.com
# Additional administrators require an explicit flag:
pnpm identity:setup-admin -- --email second@example.com --additional
```

This wrapper runs the backend setup command with `docker compose run` under the
operator profile. Configure an independent `DATABASE_SETUP_PASSWORD`; the wrapper
derives the narrow `lexon_setup` credential, which is never supplied to the API,
frontend or workers. Pending retries send a replacement setup link. The recipient
sets a password, verifies email and enrolls TOTP before explicit activation.
There is no setup-start web endpoint, env allowlist, impersonation, or automatic
staff membership in customer teams. Platform pages are `/platform/provisioning`
and `/platform/accounts`; account status operations take a user UUID.

Defaults remain validated configuration: cookie lifetime 7 days with refresh at
most daily; reauthentication 5 minutes; setup link 24 hours; Bearer session 15 minutes
with a hard cap and no extension. Bearer issuance requires a fully authenticated
cookie session at `POST /api/identity/bearer-sessions`. The web client never
requests or stores Bearer tokens. Both channels use the same membership/MFA guard,
have independent active organizations, appear in the safe session list and can
be revoked immediately. Renewal UX belongs to F19.

`pnpm --filter @lexon/backend test:mutation:identity` checks the three pure identity
policies with an 80% gate. It does not replace transaction/concurrency, HTTP or
browser tests. Filtered frontend E2E includes `identity-browser`; backend E2E
includes `identity-api`. Both layers start and remove their own infrastructure.
No pre-started stack, Mailpit or persisted container reuse is needed. Optional
local reuse is never the CI default.

Credential browser projects disable trace/video/screenshots, storage-state dumps
and automatic page snapshots. Test mail is held in memory behind a private Unix
socket; operator setup uses a separate bind-mounted test composition and a private
mode0600 temporary environment file. These controls are absent from production
images. Debug with fixed error codes, request IDs and sanitized test metadata;
never retain passwords, cookies, tokens, TOTP seeds/codes, recovery codes or links.

See [F1 acceptance evidence](docs/references/F1-acceptance.md) and
[adapter findings](docs/references/F1-S6b-findings.md). F17 audit reads must use the
authorization predicate builder; `ops` has no tenant RLS. F20 owns frontend
no-egress enforcement: development `edge` remains host-accessible, with the
frontend off `core` and free of backend secrets. F2 owns shell/navigation.
