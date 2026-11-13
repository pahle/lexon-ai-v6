# Task 14 — refreshed informal preview

The owner gave informal feedback on 2026-11-12. These stable PNG filenames were
refreshed by the main session on 2026-11-13 after the six corrections, using
source `49118830b63511ed6e0bf73d0d3a3e8f21ddfe41` and the local Compose/Caddy mock-model
stack. No real model was called. [Producer, dimensions and hashes](index.json).

The main session ran the affected three browser flows independently: **3/3
passed (17.1 seconds)**. The previous source `164ccca` also passed the full
six-case chat-browser project independently (38.9 seconds). These source
revisions and results are distinct. This is informal feedback evidence, not
Task 19 formal approval or Linux golden baselines.

The six corrections are present: Thinking before answer text; disabled
whitespace-only Send; automatic textarea growth without a resize grip; a
round Stop control with square icon; the running placeholder; and sans
semibold answer headings. The named no-answer reasoning regression is also
covered by component tests.

| State            | Desktop light                            | Desktop dark                            | Mobile light                            | Mobile dark                            |
| ---------------- | ---------------------------------------- | --------------------------------------- | --------------------------------------- | -------------------------------------- |
| New chat         | [PNG](task-14-newchat-desktop-light.png) | [PNG](task-14-newchat-desktop-dark.png) | [PNG](task-14-newchat-mobile-light.png) | [PNG](task-14-newchat-mobile-dark.png) |
| Completed answer | [PNG](task-14-answer-desktop-light.png)  | [PNG](task-14-answer-desktop-dark.png)  | [PNG](task-14-answer-mobile-light.png)  | [PNG](task-14-answer-mobile-dark.png)  |

- [Thinking before answer text](task-14-streaming-desktop-light.png)
- [Expanded reasoning summary](task-14-reasoning-expanded-desktop-light.png)

Main comparison references: `01-new-chat.png`, `03-thinking.png`,
`05-reasoning-open.png`, `06-answer-complete.png` and `21-answer-dark.png` in
`docs/design/f4-prototype/screens/`. The sidebar now includes Task 15 navigation.
Fixture names and prompt-control strings remain visible in this diagnostic
thread set. Task 19 must use realistic synthetic legal content with no visible
control markers, as the owner required. Actual copy interaction and a visible
reconnect state are not established by these captures.

The separate [Task 15 preview](../task-15/README.md) has its own owner feedback gate.
