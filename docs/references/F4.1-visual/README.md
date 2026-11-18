# F4.1 visual set

The screenshot set for slice F4.1 (brand v4.1 and the chat experience). It supersedes the F2.1 set and the unlocked F4 set (product owner decision, 2026-11-15).

| Path                     | What                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `index.json`             | Every view: state, theme, viewport, prototype screen, and the F2.1 or F4 images it replaces |
| `approval.json`          | Owner approval: status, source commit, Linux environment, one hash per image                |
| `review/`                | Linux CI captures the owner reviews (added in Task 35)                                      |
| `review/contact-sheets/` | One sheet per state with its four variants                                                  |
| `baseline/`              | Linux goldens, produced by CI after approval                                                |
| `retirements.json`       | The F2.1 and F4 images this set supersedes                                                  |
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

## Dev loop: one long-lived stack for several workers

A full E2E stack needs about 3 GB, so parallel workers share one. The frontend runs `next dev` (`visual-dev` target, dev overlay off) on the working tree's `frontend/src` and `frontend/public` (bind mounts), so a saved edit hot reloads without a rebuild.

```bash
node scripts/visual-dev-stack.mjs up                 # once; builds and keeps the stack
node scripts/visual-dev-stack.mjs status             # project name and URL
node scripts/visual-dev-stack.mjs run auth           # capture a group, then compare
node scripts/visual-dev-stack.mjs run auth --ids sign-in,sign-up
node scripts/visual-dev-stack.mjs down               # removes this stack only
```

Groups: `auth`, `shell`, `chat`, `chats-settings`, `platform` (spec `backend/test/e2e/brand-visual-<group>.spec.ts`). Captures go to `.cache/f4.1-visual/review/`, sheets to `.cache/f4.1-visual/compare/<group>/` (open `README.md` there). The first request of a route compiles it, so the first run after an edit is slower. The team world (Ayu, Hukum Nusantara) is built once per stack and reused (`brand-visual-world.ts`); the platform group builds its administrator on every run, so it can run once per stack. The stack project is `lexon-e2e-<hex>`; `scripts/e2e.mjs` with `LEXON_E2E_KEEP=1 LEXON_VISUAL_DEV=1` is what `up` runs.
