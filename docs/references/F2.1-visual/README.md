# F2.1 pristine visual references

These images record the untouched published `base-nova` login, signup,
sidebar, assistant thread, and assistant thread-list surfaces before Lexon
presentation changes. Each view has a light-theme desktop capture at
1440×900 and a mobile capture at 390×844, both at device scale factor 1.

The image inventory and exact view metadata are in [`index.json`](./index.json).
Resolved package versions, registry snapshot comparison, generated-source
hashes, default CSS provenance, fixture import graph, font and geometry checks,
asset provenance, and PNG hashes are in
[`reference/source-manifest.json`](./reference/source-manifest.json).

## Isolation and provenance

The capture runner assembles an isolated Next.js fixture under
`.cache/f2.1-reference/` from the generated frontend sources and
[`reference/default-theme.css`](./reference/default-theme.css). Its layout
imports only that CSS file and mounts the generated tooltip provider. Thread
views use the existing inert local runtime shape and have no model transport,
chat route, or API credentials. The browser rejects non-loopback and `/api/`
requests. The generated Geist and Geist Mono fonts are served locally through
`next/font`; no browser font-host request is made.

The published auth blocks reference `/placeholder.svg` but do not ship that
asset. The fixture uses the exact official shadcn UI placeholder asset at
[`reference/shadcn-placeholder.svg`](./reference/shadcn-placeholder.svg),
recorded with its source URL and SHA-256 in the source manifest.

The fixture stylesheet imports `tailwindcss`, `tw-animate-css`, and
`shadcn/tailwind.css`. It does not import the product layout or production
`globals.css`. The rendered login confirms that the generated `--font-sans`
resolves to loaded Geist, `--radius` resolves to 0.625rem, and generated input
and default button heights are both 32px.

The fixture and frontend registry `view` snapshots matched before installation
(SHA-256 `16af43a215a2429bb52a8824c23fd77859672feb1e52b44fe9c921d195eee1bc`).
The 46 generated source files also matched byte-for-byte after aligning the
fixture's CLI generation context with the pre-task frontend CSS. The untouched
default CSS was saved and restored before capture.

## Capture

Run `node scripts/visual/pristine-reference.mjs` from the repository root at
the pristine baseline commit. The runner verifies source hashes and isolation,
starts and stops its own loopback Next.js process, waits for the thread-list
hydration state to settle, captures all ten PNGs, and verifies their dimensions.
It refuses to run if any reference PNG already exists; it never overwrites a
reference image. The temporary sample routes in the pristine commit are removed
by the following adaptation task, so use the committed PNGs and manifest for
later work rather than regenerating them from an adapted tree.

The images are immutable comparison inputs. Later adapted captures are separate
artifacts indexed by the same view identifiers; these reference paths stay
fixed.
