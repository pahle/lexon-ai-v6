# Playbook: support the implementer during brainstorming and planning

The product owner pastes Codex/superpowers output and asks what to do.

1. Superpowers brainstorming ends each message with **one question** and
   waits. Answer the question; that is normal, not an error.
2. If Codex reports a conflict between official docs and `docs/specs/` or the
   brief: **verify it yourself** against the official source. If Codex is
   right, fix the brief/specs via PR (with a change-history row) and say so;
   if wrong, explain with the source.
3. Recommend one option with reasons, in Indonesian, then give a
   **ready-to-paste English answer** in a code block that:
   - states the decision and the constraints Codex must keep;
   - names the PR that updated the brief/specs, if any;
   - says where it should be recorded (e.g. "answer to brief open question 2").
4. Reviewing the written spec or plan: check every brief item is covered,
   decisions match the documents, layering/boundaries are right, tests are
   real (not mocks where the brief requires real infrastructure), and the
   work stays on a feature branch (never commits to `main`). Approve with an
   explicit list of amendments.
5. Remind the product owner of process points when relevant: work on a
   feature branch, push after each task so you can review incrementally,
   Squash and merge, delete merged branches.

## Model policy for implementer sessions (owner, 2026-11-23)

- Every implementer prompt says: "Run in Fusion (frontier lead + SWE-2
  sidekick): the frontier lead does brainstorming, spec, plan and reviews;
  SWE-2 writes code and tests." Never name an Opus manager or Sonnet
  implementers in a prompt.
- Routine steps (CI checks, merging `main`, lint fixes, worktree cleanup)
  use SWE-2.
- The brief generator runs in Fusion too. Ask the owner to switch to Opus
  only for a heavy decision: the final spec review, a visual approval, a
  security finding, or a debugging dead end.
- Trial: F4.4 task 1 (dependency upgrades). Its review checks that every
  task shows RED -> GREEN evidence (failing command and output before the
  change, passing after), that the spec and quality reviews actually ran and
  their findings were handled, and that every report states the CI result of
  its head. Then recommend to the owner whether Fusion stays for the rest of
  F4.4.
