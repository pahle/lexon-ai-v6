# F4.1 prototype: brand v4.1 and chat experience

**Approved by the product owner on 2026-11-13 (revision 12).** This is the visual
target for [F4.1](../../briefs/F4.1-brand-refresh.md). Layout, hierarchy, content,
and states follow these screens; component internals and sizes follow shadcn
`base-nova` and assistant-ui (LEX-DS-001 v3.0 §5).

- `screens/`: PNG captures at 1440×900 (desktop) and 390×844 (mobile).
- `source/prototype.html`: the clickable prototype, self-contained (fonts and
  marks embedded). Open it in a browser and use the state picker. It is a
  design artifact only; build the product from shadcn and assistant-ui, not
  from this file's markup.
- Tokens: light from the brand kit (`docs/brand/lexon-2026-v4.1/lexon-shadcn-theme.css`);
  dark derived for Lexon and approved with this prototype. Both are listed with
  measured contrast in LEX-DS-001 v3.0 §2.

## Screen index

| Screen                                               | State                                                                       | Built from                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `00-personal.png`                                    | Personal workspace, Lexon monogram in the switcher                          | shadcn `sidebar-07` (inset), `TeamSwitcher`      |
| `01-sign-in.png`, `03-sign-in-dark.png`              | Sign in, Night cover on the right                                           | shadcn `login-02`                                |
| `02-sign-in-errors.png`                              | Field errors and form alert                                                 | `Field`, `FieldError`, `Alert` (LEX-DS-001 §5.1) |
| `10-new-chat.png`, `40-new-chat-dark.png`            | New chat: serif greeting, centered composer, starter pills                  | assistant-ui Thread welcome + Composer           |
| `11-deep-thinking.png`                               | Deep thinking pill pressed                                                  | assistant-ui Composer, `Toggle`                  |
| `12-thinking.png`                                    | Thinking indicator running                                                  | custom indicator in the assistant message header |
| `13-streaming.png`, `42-streaming-dark.png`          | Streaming answer, Stop, scroll-to-latest                                    | assistant-ui Thread, Composer                    |
| `14-reasoning-open.png`                              | Reasoning summary expanded                                                  | assistant-ui Reasoning                           |
| `15-answer.png`, `41-answer-dark.png`                | Completed answer, finished mark, "Thought for N seconds", action bar        | assistant-ui ActionBar                           |
| `16-feedback.png`                                    | Copied and feedback states                                                  | assistant-ui ActionBar                           |
| `17-edit.png`                                        | Editing a user message                                                      | assistant-ui EditComposer                        |
| `18-branch.png`                                      | Branch picker "2 / 2"                                                       | assistant-ui BranchPicker                        |
| `19-stopped.png`                                     | Stopped answer keeps its partial text                                       | assistant-ui Thread                              |
| `20-error.png`                                       | Failure with safe copy and Try again                                        | `Alert` inside the message                       |
| `21-reconnect.png`                                   | Reconnecting notice                                                         | inline status                                    |
| `22-loading.png`                                     | Thread loading                                                              | `Skeleton`                                       |
| `23-chat-menu.png`                                   | Floating pill: New chat and chat actions (⋯)                                | `Button`, `DropdownMenu`                         |
| `24-rename.png`                                      | Rename dialog                                                               | `Dialog`, `Field`                                |
| `25-delete.png`, `45-delete-dark.png`                | Delete confirmation, Merah Segel Deep confirm                               | `AlertDialog`                                    |
| `26-chats.png`                                       | Chats page (history)                                                        | shadcn list, `Input` search                      |
| `27-search.png`, `43-search-dark.png`                | Search with highlighted matches                                             | same                                             |
| `28-no-results.png`, `29-empty.png`                  | No results, no chats yet                                                    | `Empty`                                          |
| `30-org-switcher.png`                                | Organization switcher open: initials tile and member count                  | `TeamSwitcher`, `DropdownMenu`                   |
| `31-user-menu.png`                                   | User menu: name and job title                                               | `NavUser`                                        |
| `32-collapsed.png`                                   | Collapsed (icon) sidebar                                                    | `sidebar-07` collapsible icon                    |
| `33-settings-profile.png`                            | Settings → Profile with Job title                                           | shadcn `sidebar-13` in a `Dialog`                |
| `34-settings-appearance.png`, `44-settings-dark.png` | Settings → Appearance, dark                                                 | same                                             |
| `50-mobile.png`, `51-mobile-dark.png`                | Mobile thread with sheet sidebar                                            | `Sheet`                                          |
| `fm-strip.png`                                       | Thinking indicator, 24 frames at 0.5 s                                      | indicator component                              |
| `finish-strip.png`                                   | Indicator finishing into the Lexon mark, from a mark and from the dot phase | indicator component                              |

## Layout rules shown in the prototype

- **Shell:** inset sidebar; the content is a rounded card on the sidebar
  canvas with no hard header border. Groups: **Tools → Assistant** (New chat,
  Chats) and **Recent** (six chats, then View all chats). The user block shows
  name and job title.
- **Chat pages:** no breadcrumb header. The sidebar toggle sits top left; a
  floating pill top right holds **New chat (+)** and **chat actions (⋯)**.
- **New chat:** an EB Garamond greeting with no logo; the composer is centered;
  one row of short starter pills under it (Explain an article, Compare two
  rules, Check a clause, Summarize a regulation), with no label. A pill inserts
  an editable template and never sends.
- **Thread:** thread and composer 880px wide. Answers have no bubble, body
  line-height about 1.75. User messages sit in a Surface bubble. The composer is
  elevated (soft shadow, 20px radius) with a round send/stop button and a
  Deep thinking pill (pressed: tint background, red text). A fade sits above the
  composer; a scroll-to-latest button appears while streaming.
- **Answers carry no avatar.** The only mark on an answer is the indicator
  while it runs and the finished Lexon mark next to "Thought for N seconds"
  when it completes.

## Thinking indicator

One continuous morphing mark, about 20px in the message header (72px in the
preview), drawn in SVG with a small amount of script. Built in-house; no
third-party assets.

- **Marks:** the Lexon monogram, § (section sign), Writing (signature stroke),
  Paper (page with lines), Highlighter (band sweeping over lines), Column
  (courthouse: pediment, architrave, three pillars catching light, two steps),
  ¶ (pilcrow).
- **Order (shuffle bag):** every round starts with the Lexon monogram (outline
  draws, then fills, holds), then each other mark exactly once in a shuffled
  order; then a new round. No mark is skipped.
- **Between marks:** the current shape un-writes along its length into about
  26 dots of varied size and opacity. The dots gather, then wander for
  **10–14 s**, switching between randomly chosen patterns (scatter, orbit,
  swarm, spiral, figure-8) every 3.5–5 s with a smooth blend (about 1.6 s), then
  settle onto points of the next mark, which draws through them while they fade.
  Positions are continuous: nothing jumps.
- **Finish:** when the answer completes, from any phase, the motion gathers
  into the Lexon monogram (un-writing the current mark first if one is
  showing), the outline draws and fills (about 3 s), and the motion stops.
- **After finishing:** the static Lexon mark stays next to "Thought for N
  seconds" on every completed answer, including answers loaded later (no
  animation on load).
- **Reduced motion:** a static mark only.
- **Accessibility:** the graphic is `aria-hidden`; a status text announces
  "Thinking" and "Answer complete".
