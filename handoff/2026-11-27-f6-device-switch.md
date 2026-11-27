# Handoff 2026-11-27: F6 in flight, owner switching devices

Read this first, then STATE.md. Everything below was verified against GitHub on
2026-11-27 (about 19:00 WIB).

## Where F6 stands

- Integration PR **#92** `f6-projects -> main` (draft). Head `0165fd62`.
  Done and merged into f6-projects: tasks 0-11, fix batches 1-3, #104 sidebar
  re-baseline, #105 task-10 goldens, #108 branch-nav terminal reconcile repair,
  #109 memberNames outside the tenant tx.
- Note: #109 landed as a merge commit ("Merge pull request #109"), not a
  squash. Harmless on the integration branch; squash when #92 goes to main.
- Batch 1-3 code reviews by me: approved (details in STATE.md sections dated
  2026-11-26/27).

## Open PRs and what each needs

| PR | Branch | State | Next |
|---|---|---|---|
| #113 | docs/f6-r18-amend -> main | draft, mine | Prototype revision 18.1 (restricted row a11y variant, absolute matter dates; 28 PNGs). Owner merges after CI green. Then main must be merged into f6-projects (implementer, via PR) before round 5. |
| #112 | f6-srcfix-regen -> f6-projects | ready, CI green | Approved by me: mid-run regenerate parentage fix (onReload flat list). Implementer merges when every check is green. |
| #111 | f6-r18-matters -> f6-projects | draft | Task 12 round 4 (Matters UI rebuilt to r18). NOT approvable: see the round-5 prompt below. Work continues on this branch. |
| #110 | f6-t12-visual -> f6-projects | draft | Task 12 round 3 capture specs. Superseded by #111 (check whether #111 contains it; close #110 if so). |
| #92 | f6-projects -> main | draft | Merge only after task 12 approved + goldens, chat-thread:363 durable fix, every check green on head. |

## Unfinished work (in order)

1. Owner merges #113 (prototype 18.1). Implementer merges main into f6-projects.
2. Implementer: round-5 fixes (prompt below), local iteration, then ONE CI
   round (round 5 is the final approved Linux UI round for task 12), stop at
   pending-compare sheets.
3. Me: review the round-5 sheets (tools/visual-review/), owner eye approval,
   then implementer writes goldens for the 64 r18 ids.
4. Implementer: chat-thread.spec.ts:363 durable fix (canonical-complete
   reconcile or SDK flat-list source fix), forced-race harness RED, 20x green.
   Required before #92 merges.
5. Follow-ups recorded, not blocking: auth pool headroom (chat-sse-load S2
   peak 418, run 45949552031); dropped operation-bearing publication should
   emit a chat refresh notify; ai-worker-crash shutdown bound 1/37 under load.
6. Me: final F6 review (reviews/F6-review.md), then the owner merges #92.

## Owner rulings so far (F6 task 12)

- Restricted member row: muted name + "Access restricted by your
  organization", no row-wide opacity (accessibility). Prototype 18.1.
- Matter chip in the chat header: implement as r18.
- Layouts: match r18.
- Matter "Last activity": absolute format like Chats/Recent. Prototype 18.1.
- Linux UI rounds: round 3 (task 12), round 4 and round 5 approved; round 5
  is the final one.
- Earlier: ownerName additive field (option 1); 190-id sidebar re-baseline and
  the 56 task-10 ids approved by eye.

## Implementer reliability notes (keep checking)

Reports repeatedly omitted failing checks (#104 unit-integration, #110
chat-sse-load, the 62/64 gate result, chat-share error state twice), ran
`gh pr checks` while pending, and pushed without the commit gate. Always
verify CI and artifacts yourself.

## Unsent prompt for the implementer (round 5); the owner has NOT sent it yet

Send it to the next implementer session after the commit/handoff prompt. If
#113 is already merged by then, the prerequisite paragraph is still valid.

```text
Round 4 (#111, run 45982407809) reviewed. The r18 desktop layout is mostly there. #112 is approved: merge it once every check on its head is green. Owner rulings: matter "Last activity" uses the same absolute format as Chats/Recent (prototype updated). Round 5 is approved as the FINAL Linux UI round for task 12. Iterate with local captures first (local Mac captures are self-checks only, never evidence), then use round 5 once.

Prerequisite: docs PR #113 (prototype revision 18.1: restricted row without row-wide dimming, absolute dates in matter tables; 28 re-rendered views) goes to main. After the owner merges it, merge origin/main into f6-projects through a PR before round 5, so the comparison uses 18.1.

Fix before round 5:
1. chat-share STILL shows "We could not load who can see this chat." in both round 3 and round 4, and your round-4 report did not mention it. Root-cause it now: either the owner's GET /chats/:id/shares fails in this state (product bug) or the capture fixture is broken. RED test first, then fix. The capture must show the r18 dialog with the recipient row "Rina Kusuma · Can view".
2. Matter page mobile header: the avatars, Members and gear share the title row and squeeze the title into four lines. Per r18, put them on their own row under the number/practice-area line. Desktop: match the r18 container (left-aligned, full content width like the other list pages, not a centered narrow column), and add the row menu (⋯) on chat rows.
3. settings-matters-restrict: render a real stacked dialog over the Settings dialog, with its own overlay and the compact r18 width (nested Base UI dialog), not a panel inside the settings content.
4. Matters list: "Your role" is a plain text column as in r18 (no extra chip line); footer "1–5 of 5" with rows per page as in r18.
5. Fixture parity with r18/18.1 in every capture: dates 09:00 / Yesterday / Nov 12 / Nov 11 / Nov 9 (matters), 09:00 / Yesterday / Nov 11 / Nov 9 (matter chats), Yesterday / Nov 10 (personal); the sidebar Recent titles r18 shows; the chat titles r18 uses (e.g., chat-share uses "Due diligence checklist for PT acquisition"); "Restricted by Dewi Lestari · 25 Nov 2026".
6. Mobile spacing: every m variant diffs about 2x its d variant. Go through the mobile sheets state by state and fix what is UI rather than fixture.
7. Autofocused inputs in dialogs (red focus ring) are an accepted difference: keep the autofocus, and list it as an explained difference per id.

Round-5 report: per-id table (percent, PASS/FAIL). Every id over 1.5% needs a named cause that is either an approved difference (restricted row, autofocus ring) or explicitly listed for the owner. Stop for eye review; no goldens before approval.

Also before #92 can merge: chat-thread.spec.ts:363 still recurs (occurrences 8/9) because the terminal reconcile exports the repository before the finished assistant is merged. Make reconcile canonical-complete (append canonical terminal entries missing from the export, or fix the SDK flat-list source), with a forced-race harness that fails RED on today's code, then 20x green. Separate PR. chat-sse-load S2 (peak 418, auth pool waiting 471): accepted as intermittent. Record a follow-up for auth pool headroom in F6-acceptance.md with the run URL.

Rules unchanged: commit gate before every push; `gh pr checks` only after completion; every report lists every failing check and every known open issue. Docker: only touch containers and volumes named lexon-e2e-*, by explicit name filter. Never prune. Never touch the unnamed volume a4699d7d… or any lexon-dev_* volume. If disk space or leftover stacks block a gate, stop and ask me.
```

## New-device setup for the reviewer session

```bash
mkdir -p ~/Developer/Work && cd ~/Developer/Work
git clone https://github.com/pahle/lexon-ai-v6.git lexon-ai-v6   # shared checkout, keep detached at origin/main
git -C lexon-ai-v6 worktree add ../lexon-brief-generator brief-generator
git -C lexon-ai-v6 worktree add --detach ../lexon-docs origin/main
```

Then open the session in `lexon-brief-generator` and say: "read
handoff/2026-11-27-f6-device-switch.md and STATE.md". Prettier for docs:
run it from a checkout with node_modules (`pnpm install` in lexon-ai-v6), or
`npx prettier@<version pinned in package.json>`.

## Commit/handoff prompt sent to the implementer (2026-11-27)

Its reply has not been verified yet. On the new device, check: every F6 worktree
branch exists on origin at the reported SHA, every open PR body has a
"Status / Remaining" checklist, and #92 has the "Implementer handoff
2026-11-27" comment with the local notes.
