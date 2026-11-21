# Visual review (comparison sheets and goldens)

1. **Only CI captures count.** Local Docker on the Mac renders differently
   (F4.2: 110 false diffs). Golden, deviation and approval decisions use the
   Linux CI artifacts.
2. **Download the artifact yourself** (works through the session proxy):
   list artifacts with the GitHub MCP `actions_list` (`list_workflow_run_artifacts`),
   then `curl -sS -L -o a.zip https://api.github.com/repos/pahle/lexon-ai-v6/actions/artifacts/<id>/zip`
   into a fresh scratch folder and unzip. `pending-compare/results.json` has the
   per-variant percentages; sheets are prototype | capture | diff.
3. **Review every sheet by eye.** A low % is not correctness (F4.1). Build
   grids with PIL to look at many sheets at once; zoom crops for suspicious
   pixels (diff two PNGs with `ImageChops.difference`).
4. Gate 1.5%. Over the gate: fix, or record in `deviations.md` only after the
   owner decides. Re-approvals and extra Linux rounds always stop for the owner.
5. `index.json` lists: `pending` = captured, awaiting owner approval (merge-e2e
   checks every pending view was captured); `planned` = in the prototype, not
   built yet (never captured or compared). A slice moves ids planned → pending
   in the commit that first captures them.
