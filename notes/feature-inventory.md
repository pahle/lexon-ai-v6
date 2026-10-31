# Reference feature inventory → Lexon slices

Reference: open-legal-products/mike @ 1f7ae19 (see `00-research-log.md`).
Paths are where to look in the reference when researching a slice. This is a
map for research only; briefs restate behavior in Lexon terms.

| Lexon slice | Reference backend (`backend/src/…`) | Reference frontend pages (`frontend/src/app/(pages)/…`) | Diagrams (`reference/mike-diagrams/…`) |
|---|---|---|---|
| F1 Identity & Organizations | `modules/auth`, `modules/orgs`, `modules/user`, `lib/authSession.ts`, `lib/authHandoff.ts`, `lib/access.ts` | `/login`, `/signup`, `/verify-mfa`, `/forgot-password`, `/reset-password`, `/onboarding`, `/organizations`, `/organizations/[id]/settings/{members,…}`, `/settings/security` | `20-fitur/12-auth`, `20-fitur/13-organisasi` (A roles/invites, B private content/archive, offboarding), `10-arsitektur-per-layer/09-akses-org-dan-keamanan` |
| F2 App shell | frontend layout/providers | `/settings`, `/settings/appearance`, `/settings/personalisation`, `/settings/features` | `10-arsitektur-per-layer/01-frontend-nextjs`, `00-arsitektur-keseluruhan/peta-halaman-frontend-ke-router-backend` |
| F3 AI Run Engine | `modules/chat/engine/*` (`streaming.ts` `runLLMStream`, `contextBuilders.ts`, `prompts.ts`, `tools/`, `verifyCitations.ts`), `lib/assistantTurnRuns.ts`, `lib/llm*`, `modules/models` | — | `20-fitur/01-chat/02-chat-C-engine-loop-dan-tool`, `02-chat-E-konteks-prompt-keamanan`, `10-arsitektur-per-layer/07-lapisan-LLM-dan-model` |
| F4 Chat | `modules/chat` (routes, crud, messages, titles, sharing, settings), `lib/assistantSse.ts` | `/assistant`, `/assistant/chat/[id]`, `/history`, `/settings/models` | `20-fitur/01-chat/02-chat-A…D` |
| F5 Tools & approvals | `modules/chat/engine/tools/connectorApprovals.ts`, ask_inputs pause/continue | — | `20-fitur/01-chat/03-katalog-tool-dan-konektor` |
| F6 Projects | `modules/projects`, `modules/project-chat` | `/projects`, `/projects/[id]`, `/projects/[id]/assistant…`, `/projects/[id]/folders/[folderId]` | `20-fitur/02-projects` |
| F7 Documents & Library | `modules/documents`, `modules/source-documents`, `modules/uploads`, `modules/library`, `modules/downloads` | `/library`, `/library/files`, `/library/folders/[folderId]`, `/library/templates…` | `20-fitur/04-dokumen`, `20-fitur/03-library` |
| F8 Retrieval & citations | `chat/engine/citations.ts`, `verifyCitations.ts`, document text search | — | `docs/document-text-search.md` (reference docs) |
| F9 Memory | `modules/memory` (user + project memory) | `/settings/memory` | `20-fitur/08-memory` |
| F10 Workflows & Quick Actions | `modules/workflows`, `modules/quick-actions`, workflow add-ons | `/workflows`, `/workflows/addons…`, `/workflows/assistant/[id]`, `/workflows/tabular-review/[id]` | `20-fitur/05-workflows` (A catalog/install, B sharing/open-source submit) |
| F11 Web research | `chat/engine/tools` web search tools | — | `20-fitur/11-riset-web-courtlistener` (CourtListener part is out of scope) |
| F12 Subagents | `chat/engine/tools/delegateTools.ts`, `delegateRuns.ts` | — | `20-fitur/09-subagents` |
| F13 Tabular Review | `modules/tabular` | `/tabular-reviews`, `/tabular-reviews/[id]`, `/projects/[id]/tabular-reviews…` | `20-fitur/07-tabular-review` (A model, B generation, C lease/concurrency, D chat over table) |
| F14 DOCX Editor | documents editing/versions, `chat/engine/wordDocumentEdits.ts` | document viewer/editor components | `20-fitur/04-dokumen/dokumen-viewer-editor-versi-dan-edit-accept-reject` |
| F15 Playbooks | `modules/playbooks` | `/playbooks`, `/playbooks/[playbookId]` | `20-fitur/06-playbooks` (A import/model, B contract review, C rules/access/editor) |
| F16 MCP connectors | connectors code (`lib/connectorOwner.ts`, MCP OAuth) | `/settings/connectors` | `20-fitur/10-konektor-mcp` |
| F17 Usage, quotas & audit | `modules/audit`, `lib/audit.ts`, `lib/auditExport.ts` | `/settings/my-activity`, `/organizations/[id]/settings/audit` | `20-fitur/14-ekspor-audit` |
| F18 Retention & data export | user/org privacy flows, organization offboarding | `/settings/privacy-data`, `/organizations/[id]/settings/privacy-data`, `/organizations/[id]/settings/private-content` | `20-fitur/17-privasi-data-dan-akun`, `13-organisasi/B` |
| F19 Word add-in | `modules/word-chat`, `chat/engine/wordPrompt.ts`, `tools/wordClientTools.ts`, `lib/authHandoff.ts`; `word-addin/` package | Word task pane | `20-fitur/16-word-addin` (A–D), `10-arsitektur-per-layer/05-word-addin` |
| F20 Production ops | `docker/`, `docker-compose.yml`, observability docs | — | `10-arsitektur-per-layer/04-docker-compose-dan-infra`, `08-monorepo-build-test-ci` |

Out of scope (do not brief): BYOK (`/settings/byok`, user API keys), org
provider keys (`/organizations/[id]/settings/providers`), desktop app
(`desktop/`), CourtListener, the `/ide` page.

Known reference quirk: `/support` page posts to an API route the backend does
not mount (from the diagram README).
