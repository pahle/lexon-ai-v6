# F4 visual target (product-owner approved prototype)

Approved by the product owner on 2026-11-09 as the visual target for F4 Chat.
Implementation must match these screens in **layout, hierarchy, content,
navigation, and states**. Component sizes and internals come from shadcn/ui
`base-nova` and the assistant-ui components (LEX-DS-001 §5): where a
component differs from the prototype by a few pixels, the component wins;
where the structure or a state differs, the prototype wins.

The prototype is a design artifact, not source code. Do not copy its HTML or
CSS into `frontend/`; build the screens from the shadcn and assistant-ui
components named below. Sample chat content is synthetic and in Indonesian
on purpose (realistic user input); all UI copy is English.

## Screens (`screens/`, 1440×900, light unless named)

| File                                                                      | Shows                                                                                                                | Built from                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `01-new-chat.png`                                                         | New chat page (was Home): greeting, composer, Deep thinking toggle, disclaimer; sidebar with New chat, Chats, Recent | `sidebar-07`, assistant-ui Thread welcome + Composer |
| `02-deep-thinking-on.png`                                                 | Deep thinking pressed, with its tooltip                                                                              | Toggle (`aria-pressed`), Tooltip                     |
| `03-thinking.png`                                                         | Run started, model reasoning: "Thinking…" indicator, Stop button                                                     | assistant-ui Reasoning, ComposerPrimitive.Cancel     |
| `04-streaming-answer.png`                                                 | Reasoning done ("Thought for N seconds", collapsed), answer streaming                                                | Reasoning, MessagePrimitive                          |
| `05-reasoning-open.png`                                                   | Reasoning summary expanded                                                                                           | Reasoning (Collapsible)                              |
| `06-answer-complete.png`                                                  | Finished answer with action bar: Copy, Good, Bad, Regenerate                                                         | ActionBarPrimitive                                   |
| `07-copied-and-feedback.png`                                              | Copied state, Good pressed, toast "Thanks for your feedback."                                                        | ActionBar feedback, Sonner                           |
| `08-edit-user-message.png`                                                | Inline edit of a user message (Cancel / Send)                                                                        | Edit composer                                        |
| `09-edited-branch.png`                                                    | After an edit: branch picker "2 / 2" on the user message                                                             | BranchPickerPrimitive                                |
| `10-stopped.png`                                                          | Answer stopped by the user: partial text kept, "Stopped" label                                                       | —                                                    |
| `11-run-error.png`                                                        | Run failed: partial text kept, safe error with Try again                                                             | Alert (destructive)                                  |
| `12-reconnecting.png`                                                     | Stream connection lost, reconnecting                                                                                 | status text (`role="status"`)                        |
| `13-thread-loading.png`                                                   | Opening a chat: skeleton                                                                                             | Skeleton                                             |
| `14-chat-actions-menu.png`                                                | Sidebar chat ⋯ menu: Rename, Delete                                                                                  | `sidebar-07` SidebarMenuAction + DropdownMenu        |
| `15-rename-inline.png`                                                    | Inline rename in the sidebar                                                                                         | Input                                                |
| `16-delete-confirm.png`                                                   | Permanent delete confirmation                                                                                        | AlertDialog                                          |
| `17-chats-history.png`                                                    | Chats page: search field, list grouped by date                                                                       | Input, list                                          |
| `18-chats-search.png`                                                     | Search over titles and message text, highlighted snippets                                                            | —                                                    |
| `19-chats-no-results.png`                                                 | No results, Clear search                                                                                             | Empty                                                |
| `20-chats-empty.png`                                                      | No chats yet, New chat                                                                                               | Empty                                                |
| `21-answer-dark.png`, `22-streaming-dark.png`, `23-chats-search-dark.png` | Dark theme                                                                                                           | —                                                    |

## Source

`source/chat.html` is the prototype. To regenerate a PNG, replace the
`__TILE__` placeholder with a data URI of
`docs/brand/lexon-2026/01_VECTOR/marks/LEXON-mark-tile-seal-micro.svg`, open
the file at 1440×900 with `?s=<state>&shot=1` (add `&theme=dark` for dark),
and take a screenshot; the state names are listed in the file.
The product owner's live copy:
https://claude.ai/artifact/JuqT5JrHV2YbKGfyEBiws5 (private to the product
owner).
