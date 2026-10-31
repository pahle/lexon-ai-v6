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
