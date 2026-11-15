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
