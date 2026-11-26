# F6 sidebar delta — pending-view review packet (round 1 of 2, rebuilt)

Review surface for the 190 `pending` view ids in
[`../F4.1-visual/index.json`](../F4.1-visual/index.json). Task 9 added the
**Matters** nav group to the app sidebar, which shifted every sidebar-bearing
view; the index ids were marked `pending` on the first task-9 capture run and
have no golden protection until approved.

Nothing in this directory is approved or written back. The reviewer and
owner approve by eye; only then are the listed ids re-golden'd and cleared
from `pending`.

## Sources

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approved goldens  | `../F4.1-visual/baseline/<id>.png`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pending captures  | CI run [45807656646](https://github.com/pahle/lexon-ai-v6/actions/runs/45807656646) on `f6-projects` @ `0accec6c`, artifacts `visual-pending-45807656646-shard-{1,2,3}` (Linux/Chromium only — never Mac captures)                                                                                                                                                                                                                                                                                                                                                                                                              |
| Diff method       | `scripts/visual-compare-sidebar-delta.mjs` — pixelmatch-style YIQ ΔE, threshold 0.1, same as `visual-compare-prototype.mjs`; capture `.masks.json` sidecars (animated regions) are excluded and tinted blue-grey on the diff panel                                                                                                                                                                                                                                                                                                                                                                                              |
| Capture selection | `scripts/visual-pending-selection.mjs` — each shard's artifact ships `review/*.png` wholesale, so ids it did not capture arrive as copies of the checked-in bytes. The shard's `pending.txt` (written by the capture helper at capture time) is the authoritative assignment. Selection throws when no shard claims an id, the claimed file is missing, non-claiming shards disagree, or the claimed file equals the approved baseline while another shard differs. `identicalToCheckedIn`/`staleReviewDrift` flags mark ambiguous picks for eye review. Covered by `scripts/test/visual-pending-selection.spec.mjs` (9 cases). |

## Machine check: sidebar-region containment

The task-9 change is sidebar-scoped, so every legitimate diff must land in the
sidebar region — the 256 px sidebar column on desktop, the 300 px sheet on
mobile (allowing 4 px for border/anti-aliasing). `results.json` records the
changed-pixel bounding box, the capturing shard, and the selection flags per
id.

| Verdict                     | Count | Ids                                                                                                                                                                                                                                                                            |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar-region delta        | 176   | see `results.json` (`differing > 0`, all `insideSidebarRegion`)                                                                                                                                                                                                                |
| Outside sidebar region      | **0** | —                                                                                                                                                                                                                                                                              |
| Pixel-identical to baseline | 8     | `not-found-desktop-{dark,light}`, `onboarding{,-invitations,-team}-desktop-{dark,light}` — non-app-shell pages (no sidebar), so no Matters row to show; expected to be unchanged                                                                                               |
| No approved baseline        | 6     | `chat-thinking-desktop-{dark,light}`, `indicator-mark-desktop-{dark,light}`, `indicator-wander-desktop-{dark,light}` — `lock: "svg-snapshot"`/`"engine-tests"` views with no pixel golden by design; all captured by shard-1; eye-review via `contact/contact-no-baseline.png` |
| Missing capture             | 0     | —                                                                                                                                                                                                                                                                              |

14 ids carry `staleReviewDrift: true` — their checked-in `review/` file had
already drifted from `baseline/` before this run (pre-existing #33 drift);
the delta shown is against the approved golden, which is what matters.

Expected per the change: every app-shell state shows the Matters row, and
nothing outside the sidebar moved. Both hold: all 176 deltas sit inside the
sidebar column/sheet, and the only pixel-identical ids are pages without an
app shell.

## merge-e2e gate hardening (this PR)

`merge-e2e`'s "Every pending view was captured by some shard" check now runs
`scripts/test/verify-pending-captures.mjs`: union of shard `pending.txt`
claims **plus** the claimed `review/<id>.png` must exist in the claiming
shard's artifact (pending.txt is appended before the screenshot — a crash
can leave a claim without a file). Covered by
`scripts/test/verify-pending-captures.spec.mjs` (3 cases). The same
`selectPendingCapture` selection is what the golden-write step (1d) will
use, so review and promotion read the same bytes.

## How to review

1. `contact/contact-<variant>.png` — one page-set per variant tiling every
   pending capture with its diff bounding box outlined in blue. Red-tinted
   labels would flag out-of-region diffs (there are none).
2. `sheets/<id>.png` — per id: approved golden | pending capture | diff
   overlay with the bounding box outlined.
3. `contact/contact-no-baseline.png` — the 6 first-time captures (svg/engine
   locked views with no pixel golden; approve or reject on sight).

## After approval

The approval lands as a follow-up commit: `baseline/<id>.png` is replaced
with the capture for the approved ids only (same `selectPendingCapture`
selection), `index.json` removes them from `pending`, and CI must come back
green with zero task-9 pending ids before task 10 (`f6-t10-sharing`) is
rebased and continues. This packet is Linux UI round 1 of 2 — same captures
as the first build, tooling fix only.
