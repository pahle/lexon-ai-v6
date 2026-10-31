# Playbook: git and pull requests

- Persistent branches: `main` (protected by convention: PRs only) and
  `brief-generator` (this orphan branch; never merged).
- Work on `main` content from a separate checkout or worktree, e.g.
  `git worktree add ../lexon-brief-generator brief-generator`.
- Temporary branch per change, created from `origin/main`
  (or from the feature branch when fixing an implementation).
- Commit messages in English; end with the attribution lines your harness
  requires.
- Open PRs as drafts; the product owner marks ready and merges with
  **Squash and merge**, then deletes the branch. Give them exact steps:
  GitHub UI (Ready for review → Squash and merge → Delete branch) or
  `gh pr ready <n>` / `gh pr merge <n> --squash --delete-branch`.
- Never force-push. If a branch name already exists remotely with an old,
  squash-merged tip: `git checkout -B <name> origin/main`, commit, then
  `git merge -s ours origin/<name>` and push normally.
- After a merge, tell the product owner to `git checkout main && git pull`.
