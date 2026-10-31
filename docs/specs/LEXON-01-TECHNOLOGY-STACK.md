# LEXON
## Technology Stack Specification

| Field | Detail |
|---|---|
| **Document** | LEX-TS-001 |
| **Version** | 1.7 |
| **Status** | **LOCKED** — subject to validation prerequisites (§9) |
| **Date** | 31 October 2026 |
| **Supersedes** | v1.6 (31 October 2026) |
| **Product** | Lexon — Indonesian Legal AI Workspace |
| **Classification** | Internal · Product & Engineering |

## 1. Summary

Lexon is an AI-assisted work platform for Indonesian legal practice. It supports legal conversation and analysis, structured document review, and document drafting and editing in one workspace.

This specification defines the base technology used to build and operate Lexon. All components listed here form the **v1.7 technology baseline** for application development, system integration, testing, and deployment.

**System pattern:** separate frontend and backend in one pnpm workspace, with a root folder structure that follows Mike OSS: `backend/` (NestJS), `frontend/` (Next.js), and `word-add-in/`. The backend is one modular codebase; AI and document processing run as separate entrypoints of the same backend codebase. Initial deployment uses a Linux VPS and Docker Compose.

**Language scope (MVP):** everything is in **English**: the application UI, error messages, transactional email, document content and OCR, the reference documents in `docs/specs/`, and the derived engineering documents (briefs, superpowers specs and plans). Indonesian support is prepared through configuration (see §4 and §6), so adding it does not change the data schema. UI internationalization is not built in the MVP, but UI strings are not hard-coded in scattered places so they can be extracted later.

**Changes in v1.7 versus v1.6:**
1. The assistant-ui adapter is `@assistant-ui/ai-sdk`; `@assistant-ui/react-ai-sdk` is now only a re-export.
2. shadcn/ui uses **Base UI** primitives (`@base-ui/react`, style `base-nova`) instead of Radix UI.
3. The scaffold starting points are set (§2).
4. The MVP language is English, including this document.
5. The design system refers to the [Design System](./LEXON-03-DESIGN-SYSTEM.md).

**Changes in v1.6 versus v1.5:** vector-based semantic search (`pgvector`, `halfvec` columns, HNSW index, and the OpenRouter embedding path) is removed from the MVP baseline because MVP document scale does not need it. Retrieval uses PostgreSQL FTS + `pg_trgm` and a full-context path (Architecture §4.3). Adding it back requires an explicit stack decision.

**Main changes in v1.5 versus v1.4:**
1. Items previously "to be decided" were set: the Better Auth adapter, TypeScript 6.x, Zod 4.x, PostgreSQL 17.x, logging/configuration/health, the frontend data layer, load-testing and supply-chain tools, image pinning, the browser error path, and the evaluation runner.
2. Corrections: the backend toolchain uses `tsc` (not Webpack), Valkey 9.0.x, MCP client v2, `proxy.ts` in Next.js 16, and RLS policies with `NULLIF`.
3. New license and risk notes (Mike OSS AGPL-3.0, ExcelJS, EigenPal Pro).
4. A version baseline table (§7).

The full list is in §11. Business and legal decisions remain open and are recorded in Architecture §9: infrastructure provider and region, chat model, and the retention and RPO/RTO figures.

## 2. Application Platform

| Area | Technology | Role |
|---|---|---|
| Architecture | Modular Backend (NestJS) + separate Frontend + Dedicated Workers | Frontend and backend are separated at the deploy and trust boundary; business modules live in the backend; workers are entrypoints of the backend codebase |
| Source repository | Monorepo · pnpm Workspaces (`backend/`, `frontend/`, `word-add-in/`, `shared/`, `evals/`) | Root structure follows Mike OSS; `shared/` is the only shared package (contracts) |
| Implementation languages | TypeScript 6.x (strict; pinned; one version for the whole workspace), JavaScript, SQL | Application, integration, and data query languages. The assistant-ui template ships TypeScript 7 and is downgraded to 6.x at scaffold time. Reason: NestJS 12 (its CLI uses `~6.0`), decorator metadata, Vitest, and Stryker are not yet verified on TS 7 |
| Module format | ESM-only (`"type": "module"` in every package) | Required by AI SDK 7; Better Auth on a Node server also supports ESM only. The backend uses the NestJS 12 ESM project mode and is compiled with `tsc` (`nest build`); TypeScript and Vitest configuration are adjusted accordingly. Webpack is used only in `word-add-in/` |
| Frontend framework | Next.js 16 | App Router and Server Components for UI and SSR. Rules: no database access and no business logic; Route Handlers and Server Actions are not used for business logic. `proxy.ts` (the Next.js 16 replacement for `middleware.ts`, Node.js runtime) is used only for fast redirects based on the presence of a session cookie (Architecture §3.5) |
| Backend framework | NestJS 12 (Express adapter; ESM project) | HTTP API, SSE, domain modules, authentication and authorization guards, and worker entrypoints |
| Initial scaffold | Frontend: the assistant-ui `default` template (`npx assistant-ui@latest create`), then aligned to this baseline (TypeScript 6.x, ESLint + Prettier, `@assistant-ui/ai-sdk`). Backend: `nest new` (NestJS 12, ESM project mode) with the streaming pattern from the AI SDK Nest.js cookbook (`pipeUIMessageStreamToResponse`) | The templates are only a starting point. In Lexon, generation runs in the AI Worker and is delivered through Valkey Streams → SSE (Architecture §4.1, §4.7), not directly from a controller |
| UI runtime | React 19 | Interface composition and client interaction |
| Server runtime | Node.js 24 LTS | Execution of the backend, workers, and the Next.js server |
| Package management | pnpm (dependency versions pinned exactly; `overrides` in `pnpm-workspace.yaml` for packages that must be single). pnpm no longer reads settings from the `pnpm` field of `package.json`; all pnpm settings live in `pnpm-workspace.yaml` | Dependency installation and resolution |
| Input validation | Zod 4.x (one version for the whole workspace via `overrides` in `pnpm-workspace.yaml`; schemas in `shared/`; used directly on NestJS route decorators through Standard Schema support) | Validation at system boundaries; the same contracts are used by the frontend, backend, and add-in (verified in S6) |

## 3. User Interface & Document Experience

| Area | Technology | Role |
|---|---|---|
| Styling | Tailwind CSS 4 | Utility styles, responsiveness, and design tokens |
| UI foundation | shadcn/ui (style `base-nova`) + Base UI (`@base-ui/react`) | Interface components and primitives. Base UI was chosen for three reasons: it is the default of the assistant-ui template and component registry (chat components need no rewrite), it is actively maintained, and shadcn/ui fully supports it. Radix UI is not used; one primitives library for the whole `frontend/` |
| Iconography | Lucide | Application icon system |
| AI chat interface | assistant-ui (`@assistant-ui/react` + `@assistant-ui/ai-sdk`, on the `ai@^7` + `@ai-sdk/react@^4` line; components from the `@assistant-ui` registry, style `base-nova`) | Conversation primitives, streaming, reasoning, and rendering (in `frontend/`). `@assistant-ui/react-ai-sdk` is only a re-export of `@assistant-ui/ai-sdk` and is not used |
| Rich-text editing (non-DOCX) | Tiptap 3 + ProseMirror | **Restricted** to non-DOCX content: project instructions, the composer with mentions, notes, and AI draft previews. Legal documents are not edited in Tiptap |
| DOCX editing — Core | EigenPal DOCX Editor: `@docx-editor.dev/core` + `@docx-editor.dev/react` (Apache-2.0) | Opening, editing, and saving DOCX with canonical OOXML, in the browser (`frontend/`) |
| DOCX editing — Review | `@docx-editor.dev/pro` (EigenPal Pro commercial license) | Tracked changes and comments. **Must be licensed before production use** (§9, §10) |
| DOCX automation (optional) | `@docx-editor.dev/editor-api` (EigenPal Pro) | Document automation in the browser/server; used in the backend to create attributed OOXML for the Word add-in, and if the S1 spike requires it |
| Editor abstraction | `EditorPort` (interface in `shared/`; adapters in `frontend/` and `backend/`) | Internal interface (open, save, applySuggestions, listChanges, export) so EigenPal can be replaced without changing the domain |
| PDF experience | PDF.js | Rendering, navigation, text selection, and highlighting of citation sources |
| Tabular review interface | TanStack Table + TanStack Virtual (shadcn/ui data table pattern) | Document × column grid with virtualization, cell states, and per-cell citations |
| Data fetching (frontend) | TanStack Query (pinned) | Caching, retries, and synchronization of the typed API client (`shared/`) in `frontend/` |
| Forms (frontend) | React Hook Form + Zod resolver | Forms using the same Zod schemas from `shared/` as backend validation |
| Spreadsheet processing | ExcelJS 4.4.0 (pinned; the only XLSX library) | Importing workbooks as input and exporting review results; runs only in the Document Worker (no internet) because the library is not actively maintained (§10) |
| Microsoft Word add-in | Office.js + React + Webpack (folder `word-add-in/`, static bundle) | Lexon experience inside Microsoft Word; token-based authentication (§4) |

*Note on EigenPal packages:* the old `@eigenpal/*` packages (1.x series) are not used. The baseline uses `@docx-editor.dev/*` (2.x series).

## 4. Identity, Authorization & Data

| Area | Technology | Role |
|---|---|---|
| Authentication | Better Auth (plugins: Organization, Admin, Two-Factor, Bearer), mounted in the NestJS backend at `/api/auth/*` through a NestJS adapter. Adapter: the community library `@thallesp/nestjs-better-auth`; a thin internal adapter over `toNodeHandler` is built only if S6 shows an incompatibility with NestJS 12 or ESM | Identity, sessions, organizations, 2FA, and tokens for non-cookie clients (Word add-in). The frontend uses the `better-auth/react` client on the same origin; Better Auth tables live in the `auth` schema with their own database role (Architecture §3.2) |
| Transactional email | SMTP via Nodemailer (provider chosen at deployment) | Account verification, organization invitations, security notifications |
| Authorization | Lexon RBAC + resource-level policies (NestJS guards and policy services) | Access control for organizations, workspaces, projects, and content |
| Tenant isolation | PostgreSQL Row-Level Security (RLS) | Second line of defense for cross-organization isolation, under the application policies. Context is set through the `withTenant` wrapper (transaction-local `set_config`) and is fail-closed. Policies use `NULLIF(current_setting('app.org_id', true), '')::uuid` so reused pool connections do not throw a cast error |
| Primary database | PostgreSQL 17.x (minor pinned) | Transactional storage and the main source of business data |
| Database extensions | `pg_trgm` | Trigram search for article numbers, citation patterns, and inexact text matching |
| ORM | Drizzle ORM (only in `backend/`) | Relational model and typed database access |
| Database connection | node-postgres (`pg`) (only in `backend/`) | PostgreSQL driver and connection pooling |
| Schema management | Drizzle Kit + versioned SQL migrations in `backend/drizzle/` (including RLS and role definitions) | Controlled schema evolution |
| Data access | Drizzle + parameterized SQL + PostgreSQL functions | Application queries and structured database operations |
| Keyword search | PostgreSQL Full-Text Search (language configuration per chunk) + `pg_trgm` | Search over text, conversations, metadata, and citation patterns |
| Retrieval (RRF fusion) | Rank fusion (Reciprocal Rank Fusion) in SQL, built in the Knowledge & Retrieval domain | Combines FTS and trigram results with centralized authorization filters; full context for single documents |
| FTS language configuration | v1: `english`. Next: `indonesian` (PostgreSQL's built-in Snowball stemmer) + a synonym dictionary for legal abbreviations | Adding Indonesian is a configuration change and re-index, not a schema change |

## 5. AI & Asynchronous Processing

| Area | Technology | Role |
|---|---|---|
| AI SDK | Vercel AI SDK 7 (ESM-only) | Model streaming, structured output, and tool execution |
| AI provider integration | `@openrouter/ai-sdk-provider` (3.x series, targeting `ai@^7`) | Model integration through the AI SDK |
| AI inference gateway | OpenRouter (provider preferences sent explicitly per request) | Access to AI models with a zero-retention routing policy and a verified model/provider allowlist (Architecture §6.2) |
| Model Context Protocol | MCP · `@modelcontextprotocol/client` v2 (spec 2026-07-28; Zod 4 peer dependency) | Protocol and client SDK for integrating AI with tools from external services; tested against older-spec servers |
| MCP transport | Streamable HTTP | Connections to remote MCP servers |
| MCP connector authentication | OAuth 2.0 (strict issuer metadata validation, RFC 8414), bearer tokens, and custom headers | Authorization of user-managed external connections |
| MCP tool integration | Connector management, tool discovery, and tool policies | Selecting and controlling which tools the AI can use |
| AI execution | Dedicated Node.js AI Worker — a separate entrypoint of the `backend/` codebase, run as a separate container; hosts the AI Run Engine (Architecture §4.7) | Generation and AI work |
| Background jobs | BullMQ 6 (NestJS integration via `@nestjs/bullmq`). Compatibility with BullMQ 6 and NestJS 12 is verified in S6; the fallback is a thin NestJS provider wrapper over BullMQ `Queue`/`Worker` | Queues, scheduling, concurrency, and retries |
| Queue infrastructure | Valkey 9.0.x, patch ≥ 9.0.6 and pinned. Configuration: `maxmemory-policy noeviction`, AOF `everysec`, authentication, internal network only, memory budget per use | Operational storage for queues, events, and rate limiting. Connections are configured separately per use so they can be split onto another instance later (Architecture §5.4) |
| Durable work coordination | PostgreSQL + Transactional Outbox + Outbox Dispatcher (a separate `backend/` entrypoint; one active instance via an advisory lock) | Work recording, consistency, and delivery recovery |
| Streaming delivery | Server-Sent Events (SSE) + Valkey Streams (with `MAXLEN` and a TTL per run) + a stream hub per Backend API process | Real-time event delivery to clients with resume support. The number of Valkey connections per process is fixed and does not grow per client (Architecture §4.1) |
| Rate limiting & quota | Valkey-based limiter (`rate-limiter-flexible`) + `usage_events` recorded in PostgreSQL | Rate limiting, per-organization quotas, and cost metering |
| AI telemetry | `@ai-sdk/otel` → OpenTelemetry | Tracing of generation and tools; prompt content is not recorded by default |
| Evaluation | Vitest-based evaluation harness (`evals/`) running on a standalone NestJS application context (no HTTP), plus a small number of end-to-end scenarios through the public API | Testing answer quality, citation accuracy, and resistance to prompt injection |

## 6. Document Processing & Storage

| Area | Technology | Role |
|---|---|---|
| Document execution | Dedicated Node.js Document Worker — an entrypoint of the `backend/` codebase, in a container without internet access | Pipeline for scanning, extraction, OCR, chunking, and conversion |
| Object storage | **SeaweedFS** 4.x series (exact tag pinned when S5 starts; S3 gateway; Apache-2.0) | Object storage through an S3-compatible API; replaces RustFS |
| Storage contract | S3 interface + contract tests in CI | A swappable boundary (SeaweedFS, Garage, RustFS, or managed S3) without application changes |
| Storage client | AWS SDK for JavaScript v3 | Storage access, presigned uploads, and object lifecycle |
| Object encryption | Node.js `crypto`: segmented AES-256-GCM with a per-organization DEK (envelope encryption) | Application-level encryption of client content in object storage; supports `Range` reads and crypto-shredding (Architecture §5.6) |
| Upload scanning | ClamAV (`clamd`, separate service) | Malware scanning before documents are processed |
| OCR | OCRmyPDF + Tesseract (v1: language `eng`; next `eng+ind`) | Turns scanned PDFs/images into PDFs with a text layer |
| Office conversion | LibreOffice Headless in a separate sandbox container | Isolated conversion of Office document formats |
| Document text extraction | Mammoth + PDF.js (legacy build for Node) | Extracting DOCX and PDF content (including text positions for citations) |
| DOCX generation | `docx` | Programmatic creation of Word documents |

## 7. Operations, Quality & Delivery

| Area | Technology | Role |
|---|---|---|
| Reverse proxy & HTTPS | Caddy (SSE response buffering disabled) | TLS termination and routing: `/api/*` to the backend, everything else to the frontend; serves the add-in static bundle on its own domain |
| Containerization | Docker + Docker Compose (memory/CPU limits per service; every image pinned by exact tag and digest, never `latest`) | Packaging, isolation, and initial service orchestration. Images: `frontend`, `backend` (targets `api`, `ai-worker`, `dispatcher`), and `document-worker` (a backend target with the OCR toolchain) |
| Hosting | Linux VPS (LUKS-encrypted disk; minimum initial production profile 8 vCPU, 32 GB RAM, NVMe) | Application and data infrastructure; the profile is calibrated through load testing (Architecture §5.3) |
| Secrets | Docker secrets / tightly permissioned secret files | Storage of credentials and the key-encryption-key outside the repository and database |
| Backup | pgBackRest (full + WAL archiving, encrypted) + scheduled object replication to off-site storage (`rclone sync`, encrypted, propagating deletions), with a retention window W | Point-in-time recovery and object recovery; the deletion ledger is replayed after a restore (Architecture §6.3) |
| Error monitoring | Sentry (scrubbing before send) + internal Sentry Relay | Application error tracking without document content. Runtimes without egress (Document Worker) send through Relay; browser errors are sent through the Sentry `tunnel` on a Backend API endpoint (Architecture §2.2) |
| Observability | OpenTelemetry + OpenTelemetry Collector (internal service) | Tracing and metrics across runtimes; the Collector is the only telemetry export path and a second layer of sensitive-attribute removal |
| Logging | pino (`nestjs-pino`) with a built-in redaction list | Structured logs without document content or prompts (Architecture §6.2) |
| Configuration & health | `@nestjs/config` with a Zod schema (Standard Schema); `@nestjs/terminus` | Environment variable validation at boot and health checks for each backend runtime |
| Unit & integration tests | Vitest + `@nestjs/testing`; backend endpoints are tested over HTTP on an ephemeral port using `fetch` (Supertest is still not used) | Verification of modules and HTTP interfaces. The decorator transformer follows the official NestJS 12 template and is verified together with Stryker in S6 |
| End-to-end & API tests | Playwright (including `APIRequestContext`) | Verification of workflows through the browser and HTTP |
| Mutation tests | Stryker | Assessing the strength of the test suite's assertions |
| Load testing | k6 | SSE load testing (S2: ≥ 500 connections), Tabular Review (S4), and resource profile calibration (Architecture §5.3) |
| Code quality | ESLint + Prettier + TypeScript strict; module boundary rules (cross-module imports, database driver, model gateway) | Code quality and consistency checks. The `nest new` and assistant-ui templates use oxlint/oxfmt; Lexon keeps ESLint + Prettier because the module and folder boundary rules (Architecture §3.4) need the ESLint plugin ecosystem (`no-restricted-imports`, boundaries rules) |
| CI/CD | GitHub Actions (jobs per workspace folder using `pnpm --filter`) | Automated verification, build, and delivery |
| Software supply chain | Syft (CycloneDX SBOM) + Trivy (images, dependencies, licenses) + OSV-Scanner (lockfile) + Renovate | Inventory, monitoring, and managed dependency updates. License policy is an allowlist (MIT, Apache-2.0, BSD, ISC); AGPL/GPL only as separate services |

*Version policy:* dependencies are pinned exactly with a lockfile. Updates are scheduled through Renovate; updates to the AI SDK, provider, and models must pass the evaluation subset (`evals/`) before merging.

**Version baseline (v1.7).** Exact patches are pinned at scaffold time and raised by Renovate.

| Component | Baseline | Notes |
|---|---|---|
| Node.js | 24 LTS | AI SDK 7 is tested on Node 24; NestJS 12 requires Node 20.19+ or 22.12+ |
| TypeScript | 6.x | TS 7 (native) is only evaluated for CI typechecking |
| NestJS | 12.x (Express adapter, ESM project) | Integration library compatibility verified in S6 |
| Next.js and React | Next.js 16.x, React 19 | `proxy.ts` replaces `middleware.ts` |
| assistant-ui | `@assistant-ui/react` 0.15.x, `@assistant-ui/ai-sdk` | Components from the `base-nova` registry style |
| UI primitives | `@base-ui/react` 1.x, shadcn/ui CLI | No Radix UI |
| AI SDK | `ai@^7`, `@ai-sdk/react@^4`, `@ai-sdk/otel` | Node ≥ 22, ESM-only |
| OpenRouter provider | `@openrouter/ai-sdk-provider` 3.x | Used by the AI Worker for generation |
| Queue | BullMQ 6.x with `@nestjs/bullmq` | Verified in S6 |
| Valkey | 9.0.x (≥ 9.0.6) | `noeviction` and AOF configuration unchanged |
| PostgreSQL | PostgreSQL 17.x (extension: `pg_trgm`) | Major version moves are scheduled separately |
| Zod | 4.x | Required by MCP SDK v2 and Standard Schema |
| MCP | `@modelcontextprotocol/client` v2 | Spec 2026-07-28; tested against older-spec servers |
| Better Auth | 1.x with `@thallesp/nestjs-better-auth` | Verified in S6 |
| Logging and health | `nestjs-pino`, `@nestjs/terminus` | Verified in S6 |
| Spreadsheet | ExcelJS 4.4.0 | Maintenance risk, see §10 |
| Object storage | SeaweedFS 4.x | Exact tag set at S5 |

## 8. Integration Principles

1. **One source of contracts:** the frontend, backend, workers, and add-in use the same Zod schemas and event contracts from `shared/`; domain logic lives only in the backend.
2. **Separated responsibilities:** each runtime has one job:
   - the frontend serves UI and SSR;
   - the Backend API serves user interaction and all data access;
   - the AI Worker executes AI tasks;
   - the Document Worker handles document processing.

   Workers and the dispatcher are entrypoints of the backend codebase, each with a root module that loads only the modules it needs.
3. **Centralized business data:** PostgreSQL stores resource identity, metadata, access, chunks, and process status; S3 object storage stores files.
4. **The S3 boundary is a contract:** the application depends only on the S3 API and is tested with contract tests, so the storage implementation can be replaced.
5. **DOCX is the canonical format for legal documents:** tracked changes and comments live inside the OOXML, so documents stay valid in Microsoft Word without depending on a particular editor.
6. **Managed asynchronous operations:** BullMQ, Valkey, and PostgreSQL are used according to their roles in queuing, event delivery, and work durability.
7. **Controlled tool integration:** MCP connects to external services through connectors. Each connector has authentication, access limits, tool policies, and approval for operations that modify data.
8. **Untrusted content is isolated:** uploaded files are processed inside controlled boundaries (scanning, sandboxing, resource limits); document content and tool results are treated as data, not instructions.
9. **Confidentiality as a design constraint:** sending data to models, logging, retention, and deletion follow the controls in Architecture §6.
10. **Consistent UI components:** the user experience is built on the established interface and editor foundations.
11. **Measured integration:** cross-runtime contracts, access control, tenant isolation, answer quality, and data changes are tested according to the needs of each workflow.
12. **Frontend without data access:** the frontend has no connection to PostgreSQL, Valkey, or object storage and holds no server secrets; all data access goes through the backend API on the same origin.

## 9. Validation Prerequisites Before Production Use

This baseline is LOCKED for development. The items below must be completed before the related features are considered production-ready. Spike criteria are detailed in [System Architecture §10](./LEXON-02-SYSTEM-ARCHITECTURE.md).

| # | Prerequisite | Reason |
|---|---|---|
| P1 | **An active EigenPal Pro license**, required before production use, customer pilots, or paid POCs. Also: (1) confirm with `licensing@eigenpal.com` that one subscription covers using the `@docx-editor.dev/*` packages in `frontend/`, `backend/` (`editor-api`), and `word-add-in/` as one product; (2) verify that the Pro packages (including `telemetry` if used) do not send document content out of runtimes that have egress; (3) request a continuity clause (source access if the vendor stops) | The evaluation license in the repository only allows non-production use (§10) |
| P2 | Spike S1 — DOCX fidelity and tracked changes across Microsoft Word, including generating attributed OOXML in the backend and inserting it from the Word add-in | Core of the drafting and redlining experience |
| P3 | Spike S2 — the worker → Valkey → SSE → assistant-ui streaming contract, including resume, cancel, graceful close during deploys, and load testing of the stream hub on the Backend API | Determines the message persistence model and connection capacity |
| P4 | Spike S3 — OCR pipeline + keyword retrieval (FTS + trigram) with verified citations, including retrieval quality (Recall@K, MRR) and query plans with RLS active | Foundation of grounding |
| P5 | Spike S4 — Tabular Review at 50 documents × 20 columns | Validates the grid, job scheduling, and cost estimate accuracy |
| P6 | Spike S5 — S3 contract tests on SeaweedFS, including presigned upload, multipart, lifecycle, and a restore drill | The storage choice is valid only after it is tested |
| P7 | Legal consultation on confidentiality and compliance (Architecture §6.4) | The product processes client documents and personal data |
| P8 | Verification that every model in the allowlist has an endpoint that meets the zero-retention policy, together with its provider's processing region | Prerequisite for sending client content to models (Architecture §6.2, §6.4) |
| P9 | Spike S6 — the NestJS 12 backend foundation. It covers:<br>• an ESM project with AI SDK 7<br>• verification of the Better Auth adapter (`@thallesp/nestjs-better-auth`)<br>• Zod 4 validation through Standard Schema<br>• `withTenant` and RLS from controllers and processors<br>• worker entrypoints<br>• `@nestjs/bullmq` with BullMQ 6 on Valkey 9.0.x<br>• `nestjs-pino` and `@nestjs/terminus`<br>• MCP client v2<br>• Vitest and Stryker | NestJS 12 and its integration components are new; their compatibility with the other baseline components is not yet tested in this project |

## 10. License Notes for Key Components

Read from official sources on 21 October 2026; re-verify at procurement time. Some rows were added later and also need re-verification at procurement:
- The NestJS row was added on 28 October 2026, based on NestJS 12 release coverage.
- The Mike OSS row and the ExcelJS note were added on 29 October 2026, based on review findings.

This section is not legal advice.

| Component | License | Notes for Lexon |
|---|---|---|
| EigenPal Core + React | Apache-2.0 | Free, including for commercial products |
| EigenPal Pro (`pro`, `editor-api`, `docx-to-pdf`, `telemetry`) | Commercial; **the repository contains an "Evaluation License"** | Free **non-production** evaluation. "Production Use" covers live environments, processing of customer or operational data, customer pilots, paid POCs, and routine internal business operations, and requires a commercial agreement. The packages may be installed in three folders (`frontend/`, `backend/`, `word-add-in/`); "one product" coverage is confirmed under P1 |
| EigenPal Pro pricing | US$500 per month **per product**; Enterprise is the same software plus direct support | Monthly auto-renewal; renewal pricing can change with 30 days' notice; EigenPal can change terms with 30 days' notice; no support on the Pro tier; if the subscription stops, the Pro packages must be removed from the product |
| Modifications to Pro packages | Modifications disclosed to EigenPal or third parties (including when requesting support) are automatically licensed under Apache-2.0 | Do not attach internal code to support tickets without review |
| NestJS | MIT | Used as the backend framework |
| Mike OSS (structure reference) | AGPL-3.0 | Only the folder structure is referenced; no Mike OSS code (including `word-addin/` and its workflows) is copied into Lexon. Copying code would require Lexon to comply with AGPL-3.0 |
| ExcelJS | MIT | Version 4.4.0 has not been re-released in over a year and is considered unmaintained. Mitigations:<br>• runs only in the Document Worker without internet<br>• compression-ratio and uncompressed-size limits<br>• pinned version<br>Third-party forks are only evaluated, not the default |
| SeaweedFS | Apache-2.0 | Runs as a separate service |
| Garage | AGPL-3.0 | Not the default; remains a replacement candidate if it passes the S3 contract tests |
| ClamAV | GPL-2.0 | Runs as a separate service, not linked into application code |
| OCRmyPDF / Tesseract / LibreOffice | MPL-2.0 / Apache-2.0 / MPL-2.0 | Run as separate processes or services |

**Mitigating EigenPal dependency:**
1. `EditorPort` isolates the editor from the domain.
2. Tracked changes are stored in OOXML, so documents stay readable in Word if the editor is replaced.
3. The subscription cost is recorded as a fixed operating cost.
4. Changes to terms are monitored through the licensing contact.
5. A continuity clause (source access if the vendor stops) is requested. According to an unverified third-party archive, the vendor's repository and site were briefly unreachable in June 2026.

## 11. Document Control and Change History

This document is the **approved technology reference**. Module structure, APIs, data flows, and deployment are described in the companion [System Architecture](./LEXON-02-SYSTEM-ARCHITECTURE.md); the visual language and design tokens are in the [Design System](./LEXON-03-DESIGN-SYSTEM.md).

Changing a technology choice in this version requires an explicit product and engineering decision. Compatibility, security, and dependency updates are evaluated against this baseline.

| Version | Changes |
|---|---|
| 1.1 | Initial baseline |
| 1.2 | **Replaced:**<br>• FortuneSheet + LuckyExcel → TanStack Table + TanStack Virtual<br>• RustFS → SeaweedFS behind an S3 contract<br>• SheetJS removed; ExcelJS becomes the only XLSX library<br>• Supertest removed; Route Handlers tested directly<br>**Added:**<br>• `pgvector` and hybrid retrieval<br>• OCRmyPDF + Tesseract, ClamAV, LibreOffice sandbox<br>• PostgreSQL RLS<br>• Better Auth Two-Factor and Bearer plugins<br>• Nodemailer<br>• rate limiting and metering<br>• evaluation harness; `@ai-sdk/otel`<br>• pgBackRest and off-site replication<br>• Docker secrets<br>• Renovate and a version pinning policy<br>**Clarified:**<br>• EigenPal licensing (Core vs Pro) and the `@docx-editor.dev/*` package names<br>• Tiptap's role limited to non-DOCX content<br>• ESM-only format<br>• Valkey configuration (`noeviction`, AOF, MAXLEN/TTL)<br>• `EditorPort`<br>• FTS language configuration (English first, Indonesian prepared) |
| 1.3 | **Added:**<br>• a two-path vector search strategy and `pgvector` ≥ 0.8<br>• the SSE stream hub<br>• the Outbox Dispatcher as its own process<br>• per-organization object encryption (`crypto`, segmented AES-256-GCM)<br>• the OpenTelemetry Collector and Sentry Relay<br>• the initial VPS resource profile<br>• prerequisite P8 (verifying models against the retention policy)<br>**Clarified:**<br>• the `auth` schema and database role for Better Auth<br>• the fail-closed `withTenant` wrapper<br>• Valkey memory budgets and connections per use<br>• object replication with deletion propagation, retention window W, and the deletion ledger<br>• criteria P2–P5 |
| 1.4 | **Replaced:**<br>• Next.js "Web & API" → Next.js 16 as frontend only + **NestJS 12** as backend (Express adapter, ESM project)<br>• the `apps/*` and `packages/*` structure → a root structure of `backend/`, `frontend/`, `word-add-in/`, `shared/`, `evals/`, `infra/`, `docs/` following Mike OSS<br>• direct Route Handler testing → `@nestjs/testing` and HTTP on an ephemeral port (Supertest still not used)<br>**Added:**<br>• `shared/` as the only shared package<br>• a Better Auth adapter for NestJS<br>• `@nestjs/bullmq` (with a thin wrapper fallback)<br>• module boundary rules in ESLint<br>• the NestJS license row<br>• prerequisite P9 (spike S6)<br>**Changed:**<br>• Better Auth is mounted in the backend and reached by the frontend on the same origin<br>• the AI Worker, Document Worker, and Outbox Dispatcher become backend codebase entrypoints<br>• the stream hub lives in the Backend API<br>• Caddy routes `/api/*` to the backend<br>• `EditorPort` is defined in `shared/` with adapters in the frontend and backend<br>**Clarified:**<br>• EigenPal Pro license coverage in P1 (three folders)<br>• integration principles 1, 2, and 12<br>• P2 and P3 |
| 1.5 | **Replaced:**<br>• Webpack removed from the backend toolchain (the backend uses `tsc`; Webpack stays for `word-add-in/`)<br>• Valkey 8.1 → 9.0.x<br>• `@modelcontextprotocol/sdk` (v1) → `@modelcontextprotocol/client` v2<br>• Next.js "middleware" → `proxy.ts`<br>**Set (previously open):**<br>• Better Auth adapter `@thallesp/nestjs-better-auth`<br>• TypeScript 6.x, Zod 4.x<br>• PostgreSQL 17.x with pgvector 0.8.3; vector dimension `halfvec(1024)`<br>• embedding path through the OpenRouter embeddings endpoint with a zero-retention flag<br>• pino logging, `@nestjs/config`, `@nestjs/terminus`<br>• TanStack Query and React Hook Form<br>• k6, Syft, Trivy, OSV-Scanner<br>• image pinning by exact tag and digest<br>• Sentry `tunnel`<br>• standalone evals runner<br>**Fixed:** RLS policies use `NULLIF` (Architecture §3.2)<br>**Added:**<br>• the version baseline table (§7)<br>• the Mike OSS (AGPL-3.0) license row and the ExcelJS note (§10)<br>• EigenPal telemetry and continuity checks in P1<br>• expanded P9 scope |
| 1.6 | **Removed from the MVP:**<br>• `pgvector` 0.8.3, `halfvec(1024)` columns, the HNSW index, and semantic search<br>• the OpenRouter embedding path, with its `@ai-sdk/openai-compatible` fallback<br>**Changed:**<br>• "Hybrid retrieval" becomes keyword retrieval (FTS + `pg_trgm`) with full context for single documents<br>• the AI SDK is no longer used for embeddings<br>• the Document Worker ends its pipeline at chunking<br>• P4 and P9 adjusted; the version baseline table updated<br>Re-adding vector search requires an explicit stack decision (Architecture §4.3) |
| 1.7 | **Replaced:**<br>• `@assistant-ui/react-ai-sdk` → `@assistant-ui/ai-sdk`<br>• Radix UI → Base UI (`@base-ui/react`, shadcn style `base-nova`)<br>**Set:**<br>• the initial scaffold (assistant-ui `default` template; `nest new` + the AI SDK Nest.js cookbook)<br>• English as the MVP language for the UI, content, reference documents, and engineering documents<br>• TypeScript stays 6.x and ESLint + Prettier stay (reasons recorded)<br>**Added:**<br>• a reference to the Design System (LEX-DS-001)<br>• the AI Worker hosts the AI Run Engine<br>**Translated:** the document into English<br>**Corrected (F0 research):** workspace overrides live in `pnpm-workspace.yaml`, not the `pnpm.overrides` field of `package.json`, which current pnpm no longer reads |
