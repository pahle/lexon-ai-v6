# F4 Chat visual review set

This directory is the planned Task 19 capture set. The exact inventory is in
[`index.json`](index.json); the capture record is in
[`capture-manifest.json`](capture-manifest.json). Screenshots have not been
captured or compared yet.

The inventory contains 66 unique PNGs:

- 20 approved prototype states at desktop 1440×900 in light and dark themes:
  40 captures. The dark answer, streaming, and search references map to
  prototypes 21, 22, and 23. Other dark states use the corresponding approved
  light prototype as their structural reference.
- New chat, a completed answer thread, and Chats history at mobile 390×844 in
  light and dark themes: 6 captures.
- No-signal completion, measured completion without a summary,
  matching-message highlight, and stopped-before-answer variants at desktop in
  light and dark themes: 8 captures.
- Navigation combinations that need additional screenshots: organization
  switcher open and user menu open in desktop and mobile, plus mobile sidebar
  expanded and desktop sidebar collapsed, each in light and dark themes: 12
  captures.

`index.json` maps all 20 required navigation combinations. Eight combinations
reuse an existing New chat capture where the rendered state is the same:
New chat in all four theme/viewport combinations, desktop sidebar expanded,
and mobile sidebar collapsed. The remaining twelve combinations have unique
screenshots. On mobile, expanded and collapsed refer to the navigation sheet
being open and closed. Organization switcher, user menu, and desktop collapsed
sidebar captures also carry inherited F2.1 component references as
`secondaryReference` entries in the index.

Capture files use stable names under `captures/`. The intended command is
`pnpm test:e2e --project chat-visual`; captures use deterministic API route
fixtures with the real authenticated app shell and Caddy. Active run previews
use a test-only fetch stream fixture with validated snapshot frames held open
until navigation aborts the request. The fixed account, chat content, activity
time, viewport, locale, timezone, and reduced-motion setting are recorded in
the index and capture manifest. No provider response, generated email, test
control, or diagnostic prompt should be visible.

The capture-only fixture and review are pending. Each image must be compared
individually with its `prototypeReference`; the overview image alone is not
review evidence. The capture manifest producer commit and SHA-256 values remain
unset until capture.
