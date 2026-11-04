# Task 9 implementation report

## Scope and status

Task 9 implementation is in progress. The index, explicit pending approval record, capture mode helpers, E2E fixtures, focused tests, Linux artifact upload plumbing, and all 82 indexed review PNG paths are present. Approval remains `{ version: 1, status: "awaiting-owner" }`. No baseline images were added, no approval was inferred, and Task 10 has not started.

## Research checked

- Playwright visual comparison guidance: <https://playwright.dev/docs/test-snapshots>, read 2026-11-04. It says screenshots vary across host OS, browser version, settings, hardware, and headless mode, and recommends generating and comparing them in the same environment. This supports recording the actual browser host and using Ubuntu CI for the review artifact set.
- Playwright `Page` API: <https://playwright.dev/docs/api/class-page>, read 2026-11-04. `page.unrouteAll({ behavior: "wait" })` is supported (added in 1.41) and waits for active route callbacks; this is used to release held GETs before cleanup. `page.screenshot` capture options remain the pinned 1.64.1 API.
- Installed `@playwright/test` and `playwright` are 1.64.1; Chromium reports 156.0.8078.4. No package was changed.
- Task design R8/R11/R12 remain binding: fixed viewports/dSF1 and loaded content, Linux review artifacts, and capture-only display normalization. Root approved exactly two normalized response fields after repeated same-source captures showed date volatility: on `GET /api/identity/sessions`, set each existing row's `createdAt` to `2026-11-04T11:02:00.000Z` and `expiresAt` to `2026-11-11T11:02:00.000Z`; on `GET /api/organizations/:activeTeamId/invitations`, set only each `items[].expiresAt` to `2026-11-18T11:02:00.000Z`. Values are sourced from the canonical index. The GET-only routes preserve all other fields, ordering, IDs, cursors, auth flags, and backend time, and are installed only by Task 9 screenshot captures. Behavior tests do not install them.

## RED/GREEN and affected verification

- Initial visual-index contract test failed as expected: zero review entries (required 82) and no approval record. The original Checkpoint C mapping/prototype test passed.
- With the Task 9 loaded-content guard removed, the held Security GET capture incorrectly resolved and wrote `security-desktop-light.png`; the focused test failed at `expect(incompleteCapture).rejects.toThrow()`. After restoring the guard, a 250ms test-only locator expectation fails before any PNG write while the real sessions response is held; releasing the GET allows the real loaded session table capture to pass. Default readiness timeout is unchanged.
- Local focused Task 9 Compose runs: `LEXON_VISUAL_MODE=capture pnpm test:e2e --project visual-review -g 'Task 7B Checkpoint C captures'` passed 1/1 after the readiness and responsive header fixes.
- Local platform operator Compose run: `LEXON_VISUAL_MODE=capture pnpm test:e2e --project identity-browser -g 'F2 platform page passes both-theme axe checks in the real operator flow'` passed 1/1 in 25.9s. It uses the existing one-shot operator setup, completes full MFA before capture, and creates no screenshot of setup or recovery material.
- The actual capture contexts explicitly set and assert `en-US`, `Asia/Jakarta`, and deviceScaleFactor 1, including the existing `identity-browser` project used for operator views.
- The first operator `provisioning-desktop-light` PNG was a “Checking platform access…” skeleton. Inspection established that the screenshot was taken before the loaded empty-list state. The fixture now waits for the actual `No provisioning organizations` state; the focused operator capture passed with that guard. No synthetic rows or backend changes were added.
- Two same-source macOS image iterations before the approved date normalization differed in six paths: the four security/invitation screenshots, provisioning desktop light, and profile mobile light. The approved fixed timestamps address the four date-driven images. Provisioning was fixed to wait for loaded state. The profile pair was visually inspected by root and implementer: 16 antialias pixels, maximum channel delta 1, bbox `[32,555,357,574]`, confined to rounded input corners; no masking or UI change was made. Ubuntu CI two-run comparison is still the final deliverable stability evidence.
- Route-cleanup CI evidence: run 41851764273 failed in an existing held provisioning GET handler with `route.fulfill: Route is already handled!` at `platform-identity.spec.ts:287`; run 41851773084 on the same pre-Task-9 SHA passed, confirming intermittency. The old test used one finish resolver for all matching requests and could unroute after only the first completion. The scoped fix tracks each handler, forces two overlapping real GETs, releases the gate once, uses `unrouteAll({ behavior: "wait" })`, and asserts started/finished counts match before checking the real empty-list state.
- `pnpm --filter @lexon/backend typecheck` passed after the current changes.
- `node --test scripts/test/visual-index.spec.mjs` passed 3/3; it checks the 82 paths and PNG dimensions, the exact 10 immutable source reference hashes/dimensions, explicit mode behavior including approved-mode missing-baseline failure, immutable review-only output paths, and the unchanged 15-state/18-prototype Checkpoint C map and hashes.

## Captures and environment

The local review directory currently contains 82 PNGs, with the indexed dimensions, dSF1=1, viewport-only screenshots, hidden caret, disabled screenshot animations, Chromium, `en-US`, and `Asia/Jakarta`.

Actual local browser environment: macOS 27.0.1 (host runner), Chromium 156.0.8078.4, Playwright 1.64.1, Node 24.22.1. Compose services ran in Linux containers, but the Playwright browser ran on the macOS host. These images must not be described as Linux captures. The existing Ubuntu 24.04 Compose CI job now writes a hash manifest and uploads only `review/*.png`, `index.json`, `approval.json`, and `capture-manifest.json` on a feature-branch run. Linux capture and same-environment two-iteration pixel/hash stability remain pending that CI artifact path.

The fixed team slug is `harbor-legal-review`; the existing synthetic actors are reused across capture iterations. The sign-in shown-password value is synthetic and invalid. User-menu and provisioning captures use the normal operator setup plus full MFA. Two-factor screenshots show the challenge UI only.

## Handoff status and remaining owner evidence

1. Final plumbing/index/fixture checks and exact command outputs are recorded below before commit.
2. The CI Compose job captures once during the full E2E run, writes an intermediate hash manifest, reruns only the two existing capture-producing test selections, compares all 82 hashes in the same Ubuntu job, writes the standard manifest for the second set, and uploads only the review PNGs plus index, approval, and manifest. This same-job Ubuntu evidence remains pending.
3. Main owns prototype/source side-by-side image review, deviation table, fresh whole-branch review, push/PR, and the final formal owner stop. No Task 10 or visual approval is implied.

## Final local commands

After the final fixture/index changes, these checks passed:

- `git diff --check`
- `node --test scripts/test/visual-index.spec.mjs` — 3/3 passed, including 82 indexed review paths and PNG dimensions, exact SHA and dimensions for the 10 immutable references, approval/mode failures, review-only path protection, and preserved Checkpoint C mapping/hashes.
- `pnpm --filter @lexon/backend typecheck`
- `pnpm exec eslint scripts/visual-mode.mjs scripts/visual-mode.d.mts scripts/test/visual-index.spec.mjs scripts/test/visual-capture-manifest.mjs backend/test/e2e/visual-rework.spec.ts backend/test/e2e/visual-support.ts backend/test/e2e/platform-identity.spec.ts`
- `pnpm exec prettier --check scripts/visual-mode.mjs scripts/visual-mode.d.mts scripts/test/visual-index.spec.mjs scripts/test/visual-capture-manifest.mjs backend/test/e2e/visual-rework.spec.ts backend/test/e2e/visual-support.ts backend/test/e2e/platform-identity.spec.ts docs/references/F2.1-visual/README.md docs/references/F2.1-visual/index.json .superpowers/sdd/2026-11-03-f2.1-visual-rework/task-9-report.md`
- Focused Compose E2E: `LEXON_VISUAL_MODE=capture pnpm test:e2e --project visual-review -g 'Task 7B Checkpoint C captures'` — 1/1 passed.
- Focused operator Compose E2E: `LEXON_VISUAL_MODE=capture pnpm test:e2e --project identity-browser -g 'F2 platform page passes both-theme axe checks in the real operator flow'` — 1/1 passed after the loaded-empty-state guard and locale pin.

The worktree had exactly 82 files under `docs/references/F2.1-visual/review/` before the final full local capture pass. Local macOS PNGs are bootstrap review artifacts, not a claim of Linux capture or final same-environment stability. The final implementation source commit and local capture manifest/hash counts will be recorded after the capture pass; Ubuntu CI evidence remains pending.
