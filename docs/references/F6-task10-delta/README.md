# F6 task-10 visual delta review packet — Linux UI round 2 of 2

Review surface for the **56 pending view ids** on `f6-t10-sharing`
(head `24b46622`, merge of `f6-projects` at `b5cedd98`). Every approved
golden in `docs/references/F4.1-visual/baseline/` (post-#104 re-baseline)
is diffed against the pending capture from **run 45863433280**
(Linux/Chromium, shards 1 and 3 — shard 2 claimed no pending ids; all 56
pending ids are claimed exactly once across the two shards' `pending.txt`).

Selection: `scripts/visual-pending-selection.mjs` — same shard-authoritative
pick as round 1, now disambiguated by the checked-in `review/` bytes
(`reviewPath`): a claimed file equal to the baseline while the checked-in
copy differs is a _proven_ fresh capture (a stale copy would carry the
checked-in bytes, not baseline bytes); a non-claimer file matching neither
baseline nor checked-in fails loudly (hidden second capture). 12 spec cases
in `scripts/test/visual-pending-selection.spec.mjs`.

Machine check (`--mode bbox`): the diff bounding box must be explainable by
the task-10 change — the settings-nav Matters item, the chats DataTabs row
plus the list reflow it causes, or the chat floating-menu Share item.
Nothing is approved or re-golden'd in this packet.

## What task 10 changes on screen

1. `settings-navigation.tsx` inserts a **Matters** item into the settings
   nav for owner/admin (captures run as team owner).
2. `chats/page.tsx` renders a **DataTabs** row ("All | Shared with me")
   whenever the list is not in search state.
3. The chat **floating actions menu** gains a **Share** item on owned
   chats.

## Results — 56 ids, 0 anomalies

| Category               | Ids | Diff region                                                                                   | Explanation                                                                                                                                                                                                        |
| ---------------------- | --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `settings-*-desktop-*` | 16  | `x241-291 y427-472` (~0.05-0.06%) — the settings-nav slot between "Invitations" and "General" | Matters item inserted; identical bbox on all 16 states                                                                                                                                                             |
| `settings-*-mobile-*`  | 16  | byte-identical (0.00%)                                                                        | Mobile settings shows the nav only on the root index (`showSections`); every captured view is a named section where the nav column is `max-md:hidden` — nothing to diff                                            |
| `chats-*` (non-search) | 20  | Content area only — desktop `x484-1192 y205-680`, mobile `x16-362 y95-685`; sidebar untouched | DataTabs row inserted at the top of the list; the list below reflows, so bboxes cover tab row + shifted rows. `chats-loading` diffs only the strip (0.06-0.22%); `chats-history/waiting` reflow more rows (≤7.08%) |
| `chat-floating-menu-*` | 4   | Menu popup only — desktop `x1237-1418 y101-161`, mobile `x199-380 y95-155`                    | Share item between Rename and Delete                                                                                                                                                                               |

No diff lands in the header, sidebar, or any region unrelated to the three
changes above. `chats-*` search states are correctly absent (the tab row is
hidden in search state); `settings-matters-*` remain `planned` (task 12).

## Flags recorded in results.json

- `identicalToCheckedIn`: 15 — `settings-*-mobile-*` recaptures that
  reproduced the checked-in bytes exactly (legit identical vs stale claim
  are indistinguishable post-hoc; flagged, and the sheets still diff
  against the approved baseline).
- `identicalToBaseline`: 16 — all `settings-*-mobile-*`, expected
  unchanged (the extra id beyond the 15 is
  `settings-members-load-failed-mobile-light`, a proven fresh capture —
  see below).
- `staleReviewDrift`: 2 — `chats-load-failed-mobile-dark` and
  `settings-members-load-failed-mobile-light`; the checked-in `review/`
  copy predates the re-baseline. Selections compare against the approved
  baseline, so the sheets still show the true delta.
- Multi-claimer, missing claimed files, baseline-picked captures: none.

## Layout

- `sheets/<id>.png` — approved golden | pending capture | diff overlay with
  the changed-pixel bounding box.
- `contact/contact-<variant>.png` — tiled captures with bbox outlines.
- `results.json` — per-id capture shard, percent, differing pixel count,
  bbox, and selection flags.

## Reproduce

```sh
gh api repos/pahle/lexon-ai-v6/actions/runs/45863433280/artifacts \
  --jq '.artifacts[].name'   # visual-pending-45863433280-shard-{1,3}
node scripts/visual-compare-sidebar-delta.mjs \
  --capture-root <dir with shard-*/> --mode bbox --run 45863433280
```
