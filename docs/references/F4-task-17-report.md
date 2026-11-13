# F4 Task 17 — guarded high/max smoke tooling

**Status:** tooling rules 1–7 passed the scoped controller mock runs. The
formatted source passed the controller's full root regression and fresh tooling spec/quality review. The authorized local real measurement has not run; Task 17 and F4 are
not complete.

This work adds a validated `ai:smoke -- --profile chat --efforts high,max
--samples 2` path, retains the no-argument F3 `READY` path, and adds opt-in
`chat-high`/`chat-max` cases to the existing manual real-evaluation CLI. Library
calls remain F3-only unless `includeChatCases: true` is passed. The manual workflow execution policy is unchanged; its step label now identifies the bounded F3 and chat high/max cases. No paid workflow, account API, admin API or real provider request was used.

## Implemented tooling

- Chat smoke validates its closed argument set before prerequisites or network
  access. It uses the reviewed `azure/us` route, ZDR-only configuration, no
  fallback and data-deny flags, the existing price ceiling, four physical
  requests maximum, and a shared USD 0.10 invocation budget. High/max output
  limits come from `CHAT_PROFILES.chat` (16,384 / 32,768 tokens).
- Budget admission reserves a ceil-rounded estimate and settles reported
  costs. Unknown or unpriced attempts retain reservations and stop further
  requests. The current gateway's SDK and stream retry settings remain zero.
- The provider SSE observer reports only a closed reasoning-kind enum before
  the SDK projection drops typed details. The report exposes fixed case counts,
  safe token/cost/timing measurements, normalized observed provider and
  allowlist-declared region. It does not retain prompt, answer, reasoning
  bodies, arbitrary provider type names, generation IDs, keys or error text.
- The report carries the static chat profile/instruction versions and
  calibration fields. `declaredRegion` is the allowlist's configured `us`
  value; observed provider `azure` is separate. No physical region verification
  is claimed.
- The real-eval chat cases use the actual chat profile and instructions,
  high/max effort and exact profile output caps. They share the existing
  invocation request/cost budget, retain the 16,384 estimated-input cap and
  caller-wide 512-token F3 output ceiling, and remain opt-in for library
  callers.

`InvocationBudget`, `parseUsd`, `formatUsd` and `reservationUsd` moved from
`evals/src/real-evals.ts` to `backend/src/modules/usage/invocation-budget.ts`.
The existing public backend usage and evaluation entries re-export them;
`evals` imports through `@lexon/backend/evaluation`, and backend code does not
import eval internals. The class algorithm and decimal precision were moved
unchanged. No dependency or version pin was added or changed.

## Controller RED → GREEN evidence

The table quotes the commands recorded in the adjacent ignored controller JSON. Output hashes are SHA-256 values for
the controller's raw output; raw logs remain ignored under
`.superpowers/sdd/2026-11-09-f4-chat/recovery/`.

| Rule                                              | Qualified RED                                                                                                                                                                                                                                                                                                                                                                       | GREEN                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 — invalid chat arguments refuse before fetch   | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts`; 6/6 expected assertions red. Controller record `task-17-rule-01-controller-red2.json/.log`; output `3a339b0b6da540ae7c079ccbbb3c7d8bbba00f547d0ca8ad399ca11907220025`; frozen test `fa99c289dc82dedb658d42324cbc06386806715a7320776cf414f73f3a0272a0`.                                          | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts backend/test/unit/ai-smoke.spec.ts`; 16/16 passed. Record `task-17-rule-01-controller-green2.json/.log`; output `27a6769446b5a00f39024fec5f8000efb00ce51343bac968142a3766325718f0`; same frozen test hash.                                                                                                                                        |
| 02 — bounded chat budget and settlement           | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts`; 4 expected assertions red, 9 passed. Record `task-17-rule-02-controller-red.json/.log`; output `9e228041ce562ec7740ee4c0f02cc45000181caa761b488333e57f1d1b36a016`; frozen test `9b51f3d1aaacee103c4088e3cc4e253ee8e36ded9abe5955395ce6ffef01ab01`.                                              | `pnpm exec vitest run --project backend-unit --project evals backend/test/unit/chat-smoke.spec.ts backend/test/unit/ai-smoke.spec.ts evals/test/real-eval-budget.spec.ts`; 40/40 passed. Record `task-17-rule-02-controller-clean-green.json/.log`; output `1472078e730d2767f43eae595d9509b6d4cf805e929d4344673f28d485d04088`; same frozen test hash.                                                                               |
| 03 — closed reasoning-kind classification         | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts`; 9 expected assertions red, 13 passed. Record `task-17-rule-03-controller-red.json/.log`; output `a85c7694f73b738c60d277e00097ae345cd7f404c312e73def09e14ab0327237`; frozen test `4582233c0ff3211924bfeefbf93fb41c84556ee20097b2155e8f1b03e8782acc`.                                             | `pnpm exec vitest run --project backend-unit chat-smoke.spec reasoning-filter.spec model-gateway.spec`; 57/57 passed. Record `task-17-rule-03-controller-green.json/.log`; output `898048eddd0b91982f005c9eeebdbd5aebe36451eef66cf54ca016fa85a7004d`; same frozen test hash.                                                                                                                                                        |
| 04 — profile-faithful input and calibration       | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts`; corrected A2 fixture had 3 expected assertions red, 20 passed. Record `task-17-rule-04-controller-red2.json/.log`; output `a5f119938ebd23b17615aa84fb91cd9fc152db9777b8694d02cfdebb3bf4c7ae`; frozen test `1c9c2411fb598c875d6f6f1e1fed6e7d4a69862fcf8572542ef7ed1656b10dad`.                   | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts backend/test/unit/ai-smoke.spec.ts backend/test/unit/provider-sse-observer.spec.ts backend/test/unit/model-gateway.spec.ts`; 33/33 passed. Record `task-17-rule-04-controller-green2.json/.log`; output `6e86e0aff9a172875ee91440698ae5b8fae707c6163ad0ee0e38cfee6494675d`; same frozen test hash.                                                |
| 05 — compiled CLI argument forwarding             | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke-cli.spec.ts`; 3 expected argument-forwarding assertions red and the legacy control passed. Record `task-17-rule-05-controller-red2.json/.log`; output `f5a22cee3849a091f6c895ce05f2634f28b01aeb92daffce98f4080e6b6b684b`; frozen test `844c43ccf1a5e15325669c646e0aee1b9ed2332792e97f11648953c393231387`. | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke-cli.spec.ts backend/test/unit/chat-smoke.spec.ts backend/test/unit/ai-smoke.spec.ts`; 37/37 passed. Record `task-17-rule-05-controller-green.json/.log`; output `e1aa277f878888811f154a3472f6854b3afbf7a0f5c6f1149b489cc92e53497d`; same frozen test hash.                                                                                                |
| 06 — bounded manual chat high/max eval cases      | `pnpm exec vitest run --project evals evals/test/real-eval-budget.spec.ts -t 'opts into bounded chat                                                                                                                                                                                                                                                                                | does not let chat opt-in'`; the case-list assertion red and the global-cap control passed (17 tests not selected). Record `task-17-rule-06-controller-red.json/.log`; output `2861c9cab1a0d25871155dcd1b4512d48bd57093683bb4d7781c597ee5d974ae`; frozen test `0e8a2aab4f904ecfc3ac667d76de6aeb9812bb135e2c6e8bc145f4f61d236e2a`.                                                                                                    | `pnpm exec vitest run --project evals evals/test/real-eval-budget.spec.ts`; 19/19 passed. Record `task-17-rule-06-controller-green3.json/.log`; output `720146a34b10f87619da0d697514ee4611ec5cb27f6de35fb5937d71c91f8932`; same frozen test hash. |
| 07 — declared region and fixed safe report schema | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts`; the missing-region assertion red, 22 passed. Record `task-17-rule-07-controller-red.json/.log`; output `38f4f4886ec4efd4bbe9ffb4de38dd34519f43cdaea4fde8bfdfb27c85561a0b`; frozen test `96af39905580982c4798102523375b4b3f375438c3d0e3b0d05413ef93ee4a69`.                                      | `pnpm exec vitest run --project backend-unit backend/test/unit/chat-smoke.spec.ts backend/test/unit/chat-smoke-cli.spec.ts backend/test/unit/ai-smoke.spec.ts backend/src/infrastructure/ai/model-gateway.spec.ts backend/test/unit/reasoning-filter.spec.ts`; 72/72 passed. Record `task-17-rule-07-controller-green.json/.log`; output `5206ea8a8f7dc2e940a697ef50b7eb74c75fad265a2fc3453e5d8c0274f8add3`; same frozen test hash. |

### Fixture and preflight corrections

Non-qualifying attempts were not relabeled as RED evidence. Rule 01's first
invalid-argument fixtures omitted other required flags; the controller restored
the source and required complete otherwise-valid argument sets before the
qualified six-case RED. Rule 04's first wire fixture assumed a plain-string
system message; that source was rolled back and the test was corrected before
the qualified RED. Rule 05's first synthetic attestation date was future-dated
for the controller's UTC date and failed prerequisites before fetch; the
fixture now uses the current UTC date. Rule 02's type preflights found caller
type mismatches and an existing prerequisite-refusal regression; those were
corrected without changing the budget class algorithm, then the full 40-test
covering run passed. Rule 06's first implementation timed out because the
evaluation registry lacked the actual chat profile's `chat-history` context;
after a read-only trace of `StepExecutor` and profile registrations, the
real-mode evaluation harness gained an empty-history fixture for its
single-turn synthetic case. A type preflight then led to simplifying its
unused callback arguments. Thresholds and frozen tests were not weakened.

The controller's rule RED/GREEN runs used the frozen test hashes in the table.
After those runs, pinned Prettier 3.9.10 formatted only the 15 Task 17 source
and test files. It changed three test hashes by formatting: chat smoke
`96af39905580982c4798102523375b4b3f375438c3d0e3b0d05413ef93ee4a69` →
`8b7086e140ee1f4690095fdf2581d15a0f62b92165805fcb67588c37c826b06f`; CLI
smoke `844c43ccf1a5e15325669c646e0aee1b9ed2332792e97f11648953c393231387` →
`415e7f9c05641a3f62c8e33a9fa81cead170db21dd1667cf509aadd9aff9a82b`; real
eval `0e8a2aab4f904ecfc3ac667d76de6aeb9812bb135e2c6e8bc145f4f61d236e2a` →
`a944322f8f9df1b06f7b62f865b5b8a882ae0d77fd539f089b4d34eede26b899`. These
post-format files have not been rerun by this agent; the controller owns final
root verification and will append its results.

## Research notes — 2026-11-14

| Source                                                                                                                                                                                                       | Version/date checked                                                       | Decision supported                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/package.json`; `@openrouter/ai-sdk-provider/dist/index.js` in the installed `@openrouter/ai-sdk-provider@3.1.0` package, lines 3690–3718                                                            | OpenRouter provider 3.1.0; AI SDK 7.0.159; checked 2026-11-14              | The pinned serializer emits system text as a one-element text-part array. For a single plain-text user message without cache control, it unwraps the content to a string. The corrected test asserts these actual wire shapes; estimator comparison normalizes them back to semantic text messages. |
| [OpenRouter Create a chat completion API reference](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request?explorer=true)                                                            | Reference link only; the valid page was not directly opened during Task 17 | The serializer finding is supported by the inspected pinned provider source above. This link is not presented as a completed documentation read.                                                                                                                                                    |
| First-party implementation move: `evals/src/real-evals.ts` → `backend/src/modules/usage/invocation-budget.ts`; re-exports through `backend/src/modules/usage/index.ts` and `backend/src/evaluation/index.ts` | Workspace source, checked 2026-11-14                                       | Reuse the exact decimal budget implementation through the backend public evaluation entry; no backend-to-evals dependency, algorithm rewrite or new package.                                                                                                                                        |
| `backend/config/model-allowlist.json` and `backend/src/ai/chat-smoke.ts`                                                                                                                                     | Reviewed allowlist entry, checked 2026-11-14                               | Report `declaredRegion: "us"` from route configuration and report observed `provider: "azure"` separately. This is not physical-region verification.                                                                                                                                                |

## Remaining gates

Only tooling plan Steps 1–3 are checked complete. Step 4's single owner-authorized
local high/max measurement is now authorized to proceed after the tooling commit. If permitted then, it must use
Node `--env-file=.env` without opening, printing or copying that file; at most
four requests and USD 0.10 total; no retry for better results; no account/admin
calls. No measurements or statistical conclusions are recorded here. Step 5,
the tooling commit, also remains pending. No final F4, final-head CI, load,
visual, search-gate or branch-review completion is claimed.

## Main-controller full verification

On the formatted test files, `pnpm test` passed **1,365/1,365 tests across 198 files** in 195.566 seconds (output SHA-256 `1a6765815ea6547db94f5d5ad8c6a7d93c3e242a166cf6d1843e2e30b7ffe41b`). Root lint and its 99 boundary checks passed, workspace typecheck passed, and the full workspace build passed. Immutable command records are `task-17-controller-{root-tests,lint,types,build}.json/.log` in ignored recovery records. The run retained three existing JSDOM navigation notices and one existing pg concurrent-query deprecation warning; the same pg warning is present in Task 16A's preceding root regression. These are disclosed existing noise, not a pristine-output claim. No assertion, timeout or threshold changed.

The formatter initially omitted `chat-smoke.ts`. The controller subsequently formatted that file and verified that its TypeScript printer output with comments removed was identical before and after; no behavior changed. The full regression above precedes this final whitespace-only change. The three formatted test hashes above were unchanged during that regression. The extracted `InvocationBudget` class remains byte-identical to the previous eval-owned class, SHA-256 `ec90641c75392b588d205188403a43253bd6a98471bde4bc821ae4f143b444c3`.

Normal Linux CI on the separate preceding source head `17b3300` passed both layers in [run 43496842972](https://github.com/pahle/lexon-ai-v6/actions/runs/43496842972). That is not CI evidence for the uncommitted Task 17 tooling. No real measurement, paid workflow dispatch or environment-file read has occurred.

## Tooling review follow-up

The fresh review approved code quality but identified the plan-required workflow hunk as missing. Its execution step now explicitly names the bounded score-only F3 and chat high/max evaluations. The controller verified the workflow is byte-identical after removing that display label, and the two existing manual-workflow guard tests passed (output SHA-256 `9a32c8513b2d031f08f1b4fb81d3bbe418cca6452e8f2de5464e55298fa80377`). This metadata-only change adds no trigger, permissions, environment setting or paid dispatch. Scoped re-review passed: the single Important deliverable finding is addressed and no new breakage was found.

Full workspace formatting passed in 5.582 seconds, output SHA-256 `bcbbedc28a1be9a32136a7398668c0d79161a6706dfa2fe78d78ae115050b006`. The moved `parseUsd`, `formatUsd` and `reservationUsd` functions were also compared against the original and are unchanged apart from their export declarations.

The main session accepts the tooling stage after fresh spec and quality approval, including scoped fix-round review. Task 17 overall remains pending the authorized local measurement and safe evidence commit.
