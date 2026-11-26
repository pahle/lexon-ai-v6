# F6 sidebar delta — pending-view review packet (round 1 of 2)

Review surface for the 190 `pending` view ids in
[`../F4.1-visual/index.json`](../F4.1-visual/index.json). Task 9 added the
**Matters** nav group to the app sidebar, which shifted every sidebar-bearing
view; the index ids were marked `pending` on the first task-9 capture run and
have no golden protection until approved.

Nothing in this directory is approved or written back. The reviewer and
owner approve by eye; only then are the listed ids re-golden'd and cleared
from `pending`.

## Sources

| Item             | Value                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approved goldens | `../F4.1-visual/baseline/<id>.png`                                                                                                                                                                                                 |
| Pending captures | CI run [45807656646](https://github.com/pahle/lexon-ai-v6/actions/runs/45807656646) on `f6-projects` @ `0accec6c`, artifacts `visual-pending-45807656646-shard-{1,2,3}` (Linux/Chromium only — never Mac captures)                 |
| Diff method      | `scripts/visual-compare-sidebar-delta.mjs` — pixelmatch-style YIQ ΔE, threshold 0.1, same as `visual-compare-prototype.mjs`; capture `.masks.json` sidecars (animated regions) are excluded and tinted blue-grey on the diff panel |

## Machine check: sidebar-region containment

The task-9 change is sidebar-scoped, so every legitimate diff must land in the
sidebar region — the 256 px sidebar column on desktop, the 300 px sheet on
mobile (allowing 4 px for border/anti-aliasing). `results.json` records the
changed-pixel bounding box per id.

| Verdict                                    | Count | Ids                                                                                                                                                                                           |
| ------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inside sidebar region                      | 184   | see `results.json`                                                                                                                                                                            |
| Outside sidebar region                     | **0** | —                                                                                                                                                                                             |
| No approved baseline (first-time captures) | 6     | `chat-thinking-desktop-dark`, `chat-thinking-desktop-light`, `indicator-mark-desktop-dark`, `indicator-mark-desktop-light`, `indicator-wander-desktop-dark`, `indicator-wander-desktop-light` |
| Missing capture                            | 0     | —                                                                                                                                                                                             |

Of the 184 inside-region ids, 96 are pixel-identical (0.00%) and 88 differ
only inside the sidebar column/sheet (largest: `mobile-sheet-open-mobile-dark`
at 3.72%, `user-menu-open-mobile-dark` at 3.72% — the Matters row plus the
Recent list shifted down one row).

## How to review

1. `contact/contact-<variant>.png` — one page-set per variant tiling every
   pending capture with its diff bounding box outlined in blue. Red-tinted
   labels would flag out-of-region diffs (there are none).
2. `sheets/<id>.png` — per id: approved golden | pending capture | diff
   overlay with the bounding box outlined.
3. `contact/contact-no-baseline.png` — the 6 first-time captures (no golden to
   diff against; approve or reject on sight).

## After approval

The approval lands as a follow-up commit: `baseline/<id>.png` is replaced with
the capture for the approved ids only, `index.json` removes them from
`pending`, and CI must come back green with zero task-9 pending ids before
task 10 (`f6-t10-sharing`) is rebased and continues.
