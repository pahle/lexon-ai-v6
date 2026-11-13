# Task 15 — informal history/sidebar preview

Main-session local Compose/Caddy capture at source
`8047ff7435f6ee12d94d9c2655333b1fff9c61a8`: **1/1 passed (7.7 seconds)**.
PNG, deviceScaleFactor 1. [Producer, dimensions and SHA-256 hashes](index.json).
Stable filenames are overwritten on recapture. No real model was called.
This is the Task 15 informal feedback gate, not Task 19 formal approval.

| State               | Preview                                                                        | Main comparison reference                         |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| History             | [Light](task-15-chats-history-light.png)                                       | `17-chats-history.png`                            |
| Recent actions      | [Menu](task-15-chat-actions-menu.png)                                          | `14-chat-actions-menu.png`                        |
| Inline rename       | [Editing](task-15-chat-rename-inline.png)                                      | `15-rename-inline.png`                            |
| Delete from search  | [Confirmation](task-15-delete-confirm-search.png)                              | `16-delete-confirm.png`                           |
| Delete current chat | [Confirmation](task-15-delete-confirm-current-chat.png)                        | `16-delete-confirm.png`                           |
| Search              | [Light](task-15-chats-search-light.png), [dark](task-15-chats-search-dark.png) | `18-chats-search.png`, `23-chats-search-dark.png` |
| No matches          | [Light](task-15-chats-no-results-light.png)                                    | `19-chats-no-results.png`                         |
| Empty history       | [Desktop](task-15-chats-empty.png), [mobile](task-15-chats-empty-mobile.png)   | `20-chats-empty.png`; mobile layout check         |

The main session rendered and visually compared these states with the named
references in `docs/design/f4-prototype/screens/`. Earlier iterations exposed
spacing, action placement, unsettled menu capture and duplicate rename-label
defects; the final source corrects them. The final rename PNG was inspected
after the last correction. The structural layout is ready for informal feedback;
this is not a claim of pixel identity or approval of deviations.

## Differences and evidence limits

| Difference                                                         | Reason / disposition                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Georgia Chats page title                                           | Controlling LEX-DS-001 §3 page-headline typography; prototype uses sans.                                                                        |
| Two synthetic current-day chats, Personal organization             | Functional local fixture, not the full multi-date/six-chat formal review fixture. Date grouping and Recent-six are covered separately by tests. |
| `Mobile title event update` fixture title and generated test email | Diagnostic interaction data visible in this informal set. Task 19 must replace visible control markers with realistic synthetic content.        |
| Menu/dialog sizes, dialog footer and blurred backdrop              | Retained pinned Base UI/shadcn component presentation; no new dialog primitive.                                                                 |
| Empty-state description and icon                                   | Retained component copy/icon differs from prototype; exposed for owner feedback, not silently approved.                                         |
| Keyboard shortcut                                                  | Ctrl+Alt+N / Cmd+Alt+N replaces prototype Ctrl+Shift+O as approved.                                                                             |

The main session independently passed the full six-case chat-browser project
at `164ccca` (38.9 seconds), then the three affected history/new-chat/branch
flows at `4911883` (17.1 seconds), then the final history/rename flow at the
producer above (7.7 seconds). These are distinct source revisions, not one
combined final-head six-case result. The branch-target test uses browser-route
fixtures for server responses; it proves rendered navigation, actual scrolling
and highlight removal, not independent PostgreSQL persistence. Earlier backend
branch tests establish persistence separately.

The source underwent fresh spec/quality review and three scoped correction
reviews. No Important implementation finding remains in those task reviews.
The initial implementation did not fully follow tests-first chronology;
[acceptance notes](../../F4-acceptance.md#task-15--implementation-review-in-progress)
retain the exception for owner disposition. Corrective rounds recorded actual
RED/GREEN regressions. No Task 16 work starts before owner feedback.

Existing F2.1 goldens are unchanged and remain required. New F4 Linux golden
locking (Task 20) is owner-deferred to F4.1; Task 19 formal review remains in F4.
