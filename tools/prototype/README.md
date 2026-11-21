# Prototype toolkit (F4.1 prototype, revision 16)

The source of truth is on `main`: `docs/design/f4.1-prototype/source/prototype.src.html`
(markup, CSS and script without embedded assets). This folder only holds the
tools and the embedded assets needed to rebuild `prototype.html` and render
screenshots. Never keep a second copy of the source here.

## Setup in a new session

```bash
W=$SCRATCHPAD/proto            # any scratch folder
mkdir -p $W && cp tools/prototype/*.py tools/prototype/*.cjs tools/prototype/assets/* $W/
git -C <main checkout> show origin/main:docs/design/f4.1-prototype/source/prototype.src.html > $W/proto.src.html
cd $W && python3 build.py .    # writes lexon-v41-prototype.html (= prototype.html) and shot.html
```

## Render states

```bash
node shoot.cjs "state:d,state:m,state:d:dark,state:m:dark" outdir   # 1440x900 / 390x844
```

`d` = desktop, `m` = mobile, `:dark` = dark theme. Output names match
`docs/design/f4.1-prototype/screens/r14/<state>-<d|m>[-dark].png` (the folder
keeps its name; it always holds the current revision). Playwright and Chromium
are preinstalled in cloud sessions (`require('playwright')`).

## Publish back

1. Edit `$W/proto.src.html`, run `python3 build.py .`, render every changed
   state in all four variants, and look at each image (grids with PIL help).
2. Copy `proto.src.html` → `source/prototype.src.html`, `lexon-v41-prototype.html`
   → `source/prototype.html`, and the PNGs into `screens/r14/` on a docs branch.
3. Update the prototype README (States table + revision section) and, when a
   pattern changes, LEX-DS-001.
4. **State ids are locked to the capture index.** `scripts/test/prototype-state-ids.spec.mjs`
   requires every prototype state in `GROUPS` to exist in
   `docs/references/F4.1-visual/index.json`. A new or renamed state must be
   added to the index `planned` list in the same PR (PR #52 created `planned`);
   retiring a state needs the retirement mechanism and belongs in the slice
   branch. Run `node --test scripts/test/prototype-state-ids.spec.mjs` and
   `node_modules/.bin/prettier --check docs` before pushing.
5. Update the shared artifact: https://claude.ai/artifact/1xFWhbFH5WxwAnHMZPDER6
   (publish `lexon-v41-prototype.html` with that `url`).

## Kit pages

`#kit-table`, `#kit-detail`, `#kit-states`, `#kit-overlays` (LEX-DS-001 §5.7) are
references, not capture states; they live in `KITPAGES` and the sidebar `Kit`
group. A new family of shared parts gets a new kit page.

## Other files

- `measure-sb.cjs`: measures sidebar grid edges in the browser (F4.1 lesson:
  measure, do not eyeball).
- `assets/`: brand v4.1 fonts (OFL, GUST licenses included) and marks, embedded
  by `build.py`.
