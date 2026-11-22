# F4.1 visual set

The screenshot set for slice F4.1 (brand v4.1 and the chat experience). It supersedes the F2.1 set and the unlocked F4 set (product owner decision, 2026-11-15).

| Path                     | What                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `index.json`             | Every view: state, theme, viewport, prototype screen, and the F2.1 or F4 images it replaces |
| `approval.json`          | Owner approval: status, source commit, Linux environment, one hash per image                |
| `review/`                | Linux CI captures the owner reviews (added in Task 35)                                      |
| `review/contact-sheets/` | One sheet per state with its four variants                                                  |
| `baseline/`              | Linux goldens, produced by CI after approval                                                |
| `deviations.md`          | Differences from the prototype, then the F4 carry-over table                                |

## Modes

`approval.json` decides the mode unless `LEXON_VISUAL_MODE` is set: `awaiting-owner` captures, `approved` compares. Baselines are updated only on a Linux CI runner (`visual_mode: update`).

Run locally: `pnpm test:e2e --project brand-visual`. Local captures go to `.cache/f4.1-visual/review/` and are never committed; only Linux CI captures enter `review/`.

Recapturing an approved image with different bytes returns it and the set to `awaiting-owner` (`scripts/test/visual-capture-manifest.mjs --set F4.1-visual`).

## Contact sheets

`node scripts/visual-contact-sheets.mjs` reads `index.json` and the images in `review/`, renders one page per state with the pinned Playwright Chromium, and writes `review/contact-sheets/<state-id>.png`: desktop light, desktop dark, mobile light, and mobile dark side by side, each labelled with state, theme, and viewport. State ids are view ids without the `-<viewport>-<theme>` suffix. Sheets are derived from the review images, are not goldens, and are regenerated whenever a review image changes; stale sheets for states no longer in the index are removed.

Options: `--set <name>` (default `F4.1-visual`, or `LEXON_VISUAL_SET`), `--review-dir <dir>` (default `<set>/review`), `--out-dir <dir>` (default `<set>/review/contact-sheets`). The command fails and names any missing review image. Its spec is `scripts/test/visual-contact-sheets.spec.mjs` (synthetic fixture images in a temp directory).

## Prototype comparison (round 4)

`node scripts/visual-compare-prototype.mjs` renders every capture id in the prototype (`docs/design/f4.1-prototype/source/prototype.html`, `?shot=1[&m=1][&theme=dark]#<id>`, pinned Chromium, fonts ready, animations disabled) and diffs it with the capture (YIQ threshold 0.1, computed in the same Chromium). Output per variant: `<id>-<d|m>[-dark].png` (prototype | capture | diff in red), plus `results.json` and `README.md` (worst first, gate 1.5%). Options: `--capture-dir` (default `review/`), `--out-dir` (default `compare/`), `--ids a,b`, `--prototype`, `--gate` (exit 1 for a sheet over 1.5% that is not listed under "Comparison deviations (round 4)" in `deviations.md`). A missing capture is reported as MISSING. `indicator-wander`, `indicator-mark` and `indicator-finished` are compared with the prototype state `indicator` for layout only. Only animated parts are masked: the prototype's indicator, spinner and caret boxes, and the rectangles the capture helper writes to `<image>.masks.json` (indicator svg, spinners, the focused text field). CI runs it after a `capture` run and uploads `compare/`.

Fixtures are the prototype's content (`backend/test/e2e/prototype-fixtures.ts`), on one frozen instant: 14 Nov 2026 11:00 in Asia/Jakarta (`2026-11-14T04:00:00.000Z`).

## Capture loop: one long-lived stack serving a production build

A full E2E stack needs about 3 GB, so parallel workers share one. The frontend is the production build (`e2e-test-runtime` target: `next build` + `next start`), never the dev server, so edits and hot reloads by workers cannot change a screen mid-capture. Workers keep editing in parallel; only capture runs are serialized, because each one rebuilds the frontend image from the current working tree.

```bash
node scripts/visual-capture-stack.mjs up                 # once; builds and keeps the stack
node scripts/visual-capture-stack.mjs status             # project name and URL
node scripts/visual-capture-stack.mjs run auth           # capture a group, then compare
node scripts/visual-capture-stack.mjs run auth --ids sign-in,sign-up
node scripts/visual-capture-stack.mjs run auth --ids sign-in --linux   # CI-equal numbers
node scripts/visual-capture-stack.mjs down               # removes this stack only
```

`run` takes an exclusive lock (`.cache/visual-capture-stack/capture.lock`, holding the owner pid; a lock of a dead pid is reclaimed; a second run waits quietly), prints the commit and the number of changed files in `frontend/src` (what was built), rebuilds the frontend image, recreates only the frontend container, waits until it is healthy, captures the group, runs `visual-compare-prototype.mjs`, checks the stack guard, and releases the lock.

`--linux` makes the numbers match Linux CI (Mac font rendering is up to 2 points off). It starts `mcr.microsoft.com/playwright:v1.64.1-noble` (the `@playwright/test` version in `package.json`; `--rm`, 2 GB memory limit, host uid, repo mounted read-only with only `.cache/f4.1-visual/` writable) as a Playwright browser server and the test runner on the host connects to it (`PW_TEST_CONNECT_WS_ENDPOINT`, with `PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>`, so the Linux browser reaches the stack's `127.0.0.1` ports and the specs keep using the docker CLI). The browser, and so the font rendering, is Linux. `visual-compare-prototype.mjs` runs in a second container of the same image. The browser container is named `lexon-e2e-visual-linux-<pid>` and is stopped when the run ends. Lock, rebuild and guard are unchanged. Check: `run auth --ids sign-in --linux` gave 0.82 / 0.66 / 0.41 / 0.36 for m-dark / m / d-dark / d, identical to CI.

Groups: `auth`, `shell`, `chat`, `chats-settings`, `platform`, `platform-accounts`, `platform-organizations` (spec `backend/test/e2e/brand-visual-<group>.spec.ts`). Captures go to `.cache/f4.1-visual/review/`, sheets to `.cache/f4.1-visual/compare/<group>/` (open `README.md` there). The team world (Ayu, Hukum Nusantara) is built once per stack and reused (`brand-visual-world.ts`); the platform group builds its administrator on every run, so it can run once per stack. The stack project is `lexon-e2e-<hex>`; `scripts/e2e.mjs` with `LEXON_E2E_KEEP=1` is what `up` runs, with the same compose files as the brand-visual project (including `compose.chat-runtime-proof.yml`) and `AUTH_OPEN_SIGNUP=true`.

Stack guard: `scripts/e2e.mjs` and `run` inspect the containers after a run and fail loudly if the api has `AUTH_OPEN_SIGNUP` other than `true`, or if the identity / chat-runtime-proof overlays are missing. The stack descriptor carries `composeFiles`, so test helpers (`setup-support.ts`) recreate services with the stack's own file list.
