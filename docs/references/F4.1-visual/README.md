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
