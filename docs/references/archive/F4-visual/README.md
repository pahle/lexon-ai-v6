# F4 Chat visual review set

This directory contains the Task 19 visual review set. The exact inventory is in
[`index.json`](index.json); the capture record is in
[`capture-manifest.json`](capture-manifest.json). The final Rule 9 browser-GREEN
capture completed from producer `110ad23`. The main session verified all 66 image hashes, dimensions, and producer provenance,
compared every image with its prototype, and compared all ten inherited F2.1
references. The visual evidence is accepted with the documented deviations; no
owner visual approval is inferred. Attempt 6 independently passed the live
API-restart/reload proof in 15.6 seconds. The remaining gates are independent
review and Task 21.

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

The gallery below contains the 66 reviewed final images grouped by state and
theme. Comparison records and hashes are in the round-6, round-7, final,
final10, and final12 records under `recovery/task-19-comparison/`. The main
session confirmed the final organization-switcher captures show Personal and
Hukum Nusantara and the mobile expanded-sidebar captures show the open sheet.
The dark Delete confirmation is opaque at rest and hover. Deviations are
recorded in [`deviations.md`](deviations.md); independent review remains open.
The gallery and comparison are not owner visual approval.

## Reviewed image gallery

Each link opens one PNG from the verified final producer. Light and dark
captures are paired by state. Desktop variants and navigation-only captures are
listed separately so the complete 66-image set is easy to check.

### Desktop prototype states

| State               | Light                                                         | Dark                                                         |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| New chat            | [1440×900](captures/f4-new-chat-desktop-light.png)            | [1440×900](captures/f4-new-chat-desktop-dark.png)            |
| Deep thinking on    | [1440×900](captures/f4-deep-thinking-on-desktop-light.png)    | [1440×900](captures/f4-deep-thinking-on-desktop-dark.png)    |
| Thinking            | [1440×900](captures/f4-thinking-desktop-light.png)            | [1440×900](captures/f4-thinking-desktop-dark.png)            |
| Streaming answer    | [1440×900](captures/f4-streaming-answer-desktop-light.png)    | [1440×900](captures/f4-streaming-answer-desktop-dark.png)    |
| Reasoning open      | [1440×900](captures/f4-reasoning-open-desktop-light.png)      | [1440×900](captures/f4-reasoning-open-desktop-dark.png)      |
| Answer complete     | [1440×900](captures/f4-answer-complete-desktop-light.png)     | [1440×900](captures/f4-answer-complete-desktop-dark.png)     |
| Copied and feedback | [1440×900](captures/f4-copied-and-feedback-desktop-light.png) | [1440×900](captures/f4-copied-and-feedback-desktop-dark.png) |
| Edit user message   | [1440×900](captures/f4-edit-user-message-desktop-light.png)   | [1440×900](captures/f4-edit-user-message-desktop-dark.png)   |
| Edited branch       | [1440×900](captures/f4-edited-branch-desktop-light.png)       | [1440×900](captures/f4-edited-branch-desktop-dark.png)       |
| Stopped             | [1440×900](captures/f4-stopped-desktop-light.png)             | [1440×900](captures/f4-stopped-desktop-dark.png)             |
| Run error           | [1440×900](captures/f4-run-error-desktop-light.png)           | [1440×900](captures/f4-run-error-desktop-dark.png)           |
| Reconnecting        | [1440×900](captures/f4-reconnecting-desktop-light.png)        | [1440×900](captures/f4-reconnecting-desktop-dark.png)        |
| Thread loading      | [1440×900](captures/f4-thread-loading-desktop-light.png)      | [1440×900](captures/f4-thread-loading-desktop-dark.png)      |
| Chat actions menu   | [1440×900](captures/f4-chat-actions-menu-desktop-light.png)   | [1440×900](captures/f4-chat-actions-menu-desktop-dark.png)   |
| Rename inline       | [1440×900](captures/f4-rename-inline-desktop-light.png)       | [1440×900](captures/f4-rename-inline-desktop-dark.png)       |
| Delete confirmation | [1440×900](captures/f4-delete-confirm-desktop-light.png)      | [1440×900](captures/f4-delete-confirm-desktop-dark.png)      |
| Chats history       | [1440×900](captures/f4-chats-history-desktop-light.png)       | [1440×900](captures/f4-chats-history-desktop-dark.png)       |
| Chats search        | [1440×900](captures/f4-chats-search-desktop-light.png)        | [1440×900](captures/f4-chats-search-desktop-dark.png)        |
| Chats no results    | [1440×900](captures/f4-chats-no-results-desktop-light.png)    | [1440×900](captures/f4-chats-no-results-desktop-dark.png)    |
| Chats empty         | [1440×900](captures/f4-chats-empty-desktop-light.png)         | [1440×900](captures/f4-chats-empty-desktop-dark.png)         |

### Mobile states

| State            | Light                                                   | Dark                                                   |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| New chat         | [390×844](captures/f4-new-chat-mobile-light.png)        | [390×844](captures/f4-new-chat-mobile-dark.png)        |
| Completed thread | [390×844](captures/f4-answer-complete-mobile-light.png) | [390×844](captures/f4-answer-complete-mobile-dark.png) |
| Chats history    | [390×844](captures/f4-chats-history-mobile-light.png)   | [390×844](captures/f4-chats-history-mobile-dark.png)   |

### Desktop variants

| State                               | Light                                                                    | Dark                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| No-signal completion                | [1440×900](captures/f4-no-signal-completion-desktop-light.png)           | [1440×900](captures/f4-no-signal-completion-desktop-dark.png)           |
| Measured completion without summary | [1440×900](captures/f4-measured-no-summary-completion-desktop-light.png) | [1440×900](captures/f4-measured-no-summary-completion-desktop-dark.png) |
| Matching-message highlight          | [1440×900](captures/f4-matching-message-highlight-desktop-light.png)     | [1440×900](captures/f4-matching-message-highlight-desktop-dark.png)     |
| Stopped before answer               | [1440×900](captures/f4-stopped-before-answer-desktop-light.png)          | [1440×900](captures/f4-stopped-before-answer-desktop-dark.png)          |

### Navigation captures

| State                      | Viewport | Light                                                                | Dark                                                                |
| -------------------------- | -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Organization switcher open | Desktop  | [1440×900](captures/f4-organization-switcher-open-desktop-light.png) | [1440×900](captures/f4-organization-switcher-open-desktop-dark.png) |
| Organization switcher open | Mobile   | [390×844](captures/f4-organization-switcher-open-mobile-light.png)   | [390×844](captures/f4-organization-switcher-open-mobile-dark.png)   |
| User menu open             | Desktop  | [1440×900](captures/f4-user-menu-open-desktop-light.png)             | [1440×900](captures/f4-user-menu-open-desktop-dark.png)             |
| User menu open             | Mobile   | [390×844](captures/f4-user-menu-open-mobile-light.png)               | [390×844](captures/f4-user-menu-open-mobile-dark.png)               |
| Sidebar expanded           | Mobile   | [390×844](captures/f4-sidebar-expanded-mobile-light.png)             | [390×844](captures/f4-sidebar-expanded-mobile-dark.png)             |
| Sidebar collapsed          | Desktop  | [1440×900](captures/f4-sidebar-collapsed-desktop-light.png)          | [1440×900](captures/f4-sidebar-collapsed-desktop-dark.png)          |

The approved UI/runtime corrections also cover bounded automatic SSE GET
reconnect and a pull-driven logical UI stream. It retries only the same run's
event GET at 500/1000/2000/4000/5000 ms for up to five retries; it does not
repeat an accepted message mutation or model request. Terminal finish, 4xx or
identity denial, abort, close, generation change, and exhausted retries stop
the attempt. Controller unit evidence is recorded in the ignored Task 19
report. The live Caddy/backend restart proof passed in capture attempt 6,
including the retained manual reload recovery assertion. Attempts 8–10 exposed
test-fixture readiness defects (closed mobile sheet, screen-reader-only heading,
and a not-yet-loaded Personal organization entry) and are retained in the
working report. The Rule 9 browser test caught a translucent light-theme hover
color; initial visual review also showed a muted dark idle color. The final
capture confirms the local fix keeps destructive colors solid at rest and hover
in both themes. The full 329 frontend tests, 35 transport tests, 259
tooling tests, lint (99 boundary checks), types, build, and formatting gates
passed before the final review.
