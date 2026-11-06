# Task 13 — Safe AI telemetry and transactional audit

Date: 2026-11-07
Branch: `f3-ai-run-engine`
Base: `6ac69b03a9455149a8da0fb538f74567f4670963`

## Implementation

- Added exact first-install pins: `@ai-sdk/otel@1.0.159`, `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.219.0`, `@opentelemetry/exporter-trace-otlp-http@0.219.0`, and test-only `@opentelemetry/sdk-trace-base@2.8.0`. Verified official npm metadata, peer ranges, READMEs/declarations, and required APIs before install on 2026-11-07. No AI SDK, TypeScript, or Zod upgrade occurred.
- Added no-collector early return before NodeSDK/exporter construction. Configured collection disables resource autodetection, log and metric processors, instrumentations, and propagation. Export filtering allows only safe run/step/model/tool identifiers, configured model/provider, status, and enumerated safe codes; it strips events, links, status messages, unknown span attributes, and resource attributes except `service.name`.
- `registerAiSdkTelemetry` is owned by `infrastructure/ai` and runs in the AI Worker before app context creation. AI model calls disable input/output recording and include only run/step/attempt IDs. No live provider was invoked.
- Added `ai.run`, `ai.step`, `ai.model`, and transactional `ai.tool` spans. Actual StepExecutor tests capture identifiers, status, duration, provider failure, cancellation abort, and SQL tool timeout. Actual AI SDK `streamText` tests emit a model span, execute a tool, and generate a provider error. The sanitizer test confirmed the SDK emits `gen_ai.tool.call.id` even when content recording is disabled; the production exporter strips it and the tool content/error event canaries.
- Added the four strict AI audit event schemas and migration `0021_ai_audit.sql`. Run start, run terminal status, proposal/completion/failure tool phases, approval decision, cancellation, and exhausted delivery append via existing `AuditService.append` in the same guarded tenant transaction as the corresponding state/effect/receipt transition. No table, outbox, grant, auth writer, or AI authority was added. SQL checks mandatory metadata for each event and enforces status/outcome consistency.
- Reused the existing Pino capture and dispatcher queue failure tests for log/queue canaries. Added one test-source boundary exception for AI SDK imports so the real SDK telemetry canary stays in tests; production `ai-owner` restrictions remain enforced. Root lint reports 90 total boundary/presentation/design checks.

## RED / GREEN evidence

- Initial telemetry contract RED: `pnpm exec vitest run --project backend-unit ai-telemetry.spec` failed with `TypeError: createSafeAiTracer is not a function`, the missing exported API. This was an initial contract failure, not proof of privacy behavior.
- Audit schema RED: `pnpm exec vitest run --project backend-unit ai-audit-event.spec` rejected the safe AI event with `Invalid audit event` before the schema extension. GREEN is included in the focused test result below.
- Database audit RED: `pnpm exec vitest run --project backend-integration ai-privacy-audit.spec` reached the database trigger and got `Invalid audit event`; it did not reach the deliberate rollback sentinel. This was the pre-migration validator rejection, not a rollback RED. After migration, the integration test passes safe append/rollback, prompt rejection, required-field SQL rejection, and auth writer denial.
- Post-implementation privacy sensitivity check: raw SDK spans contained `private-tool-call-id` despite `recordInputs:false` / `recordOutputs:false`. Passing those same SDK spans through the production sanitizer removed the tool ID and sensitive events. This was found after initial implementation; it is not claimed as test-first chronology.
- Engine span instrumentation tests and the direct SQL required-metadata regression were added after their respective implementation changes. The assertions are now covering and pass, but their chronology does not establish historical RED. No broader TDD compliance claim is made for those cases.

## Verification

- `pnpm install --frozen-lockfile` — passed; exact lockfile is current, pnpm 10.33.1.
- Focused: `pnpm exec vitest run --project backend-unit --project backend-integration ai-telemetry.spec ai-audit-event.spec ai-privacy-audit.spec ai-run-start.spec ai-execution.spec ai-cancel.spec logging.spec dispatcher.spec` — **86 tests passed / 8 files**, exit 0.
- Full backend from repository root before the post-full public AI barrel/test boundary/reset edits: `pnpm exec vitest run --project backend-unit --project backend-integration` — **580 tests passed / 110 files**, exit 0. Covering post-edit checks included backend telemetry unit tests, workspace typecheck/build, root lint, format, and boundary suite; main session will run its focused review matrix after this commit.
- Package-scoped `pnpm --filter @lexon/backend test` — **577 tests passed / 109 files**, plus the known Task 12 `checkpoint-c-view-filter.spec.ts` cwd-relative failure importing `backend/docs/references/F2.1-visual/index.json`. Root-cwd full run passes all 110 files. No Task 17 UI/golden fixture changes were made.
- `pnpm -r typecheck && pnpm -r build` — passed for shared, frontend, backend, and evals.
- `pnpm lint` — passed, **90 checks** (90/90).
- `pnpm format:check` — passed.
- `git diff --check` — passed.
- Boundary-only `pnpm exec node --test scripts/test/boundaries.spec.mjs` passed **83/83** after adding the SDK test-source exception. The combined root lint count is 90 because it also runs presentation/design policy tests.

## Limits / review notes

- No real providers, accounts, collector, or network telemetry exporter were used. The default-path test sets adversarial OTEL exporter environment defaults and observes zero recording and zero HTTP requests to a local collector canary.
- Configured remote OTLP export is validated through API wiring and the production sanitizer with real SDK-generated spans; no remote collector acceptance was performed.
- Package-scoped backend test cwd failure is pre-existing and remains tracked for Task 17. Do not treat that command as green; the root-cwd full backend command passed.
- Main-session review is pending. No push or main-branch change was made.
