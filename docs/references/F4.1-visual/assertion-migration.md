# Assertion migration from the retired visual specs

The F2.1 and F4 visual specs mixed screenshots with layout, behavior, and accessibility assertions. Before the screenshot comparisons are retired (owner decision Q2, 2026-11-15), every non-screenshot assertion gets a lasting home. This file records where each one went.

## `backend/test/e2e/visual-rework.spec.ts` → `backend/test/e2e/brand-layout.spec.ts` (Task 4B)

Method: the spec was copied whole. All 12 tests and all 221 `expect(` calls are unchanged, including the assertions inside the capture helpers of `visual-support.ts` (viewport, overflow, fonts, images, overlay checks). The only removals are screenshots: the four `page.screenshot` calls in the spec, and the screenshot and golden-comparison steps in the helpers, which the new spec turns off with `setVisualScreenshots(false)`. The new spec runs in the `identity-browser` project with `reducedMotion: 'reduce'`, the context of the retired `visual-review` project.

| Source test (`visual-rework.spec.ts`)                                                        | Kind                      | Destination (`brand-layout.spec.ts`, same title) |
| -------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `:43` sign-in and sign-up have the published frame and indexed checkpoint captures           | layout                    | moved unchanged                                  |
| `:87` a real API-authenticated incomplete identity renders onboarding checkpoints            | functional, layout        | moved unchanged                                  |
| `:138` auth frame cover follows the published 1024px desktop boundary without overflow       | layout                    | moved unchanged                                  |
| `:164` font and image assets load from the application origin with Inter available           | functional                | moved unchanged                                  |
| `:193` secondary account flows render inside the shared auth frame                           | functional, layout        | moved unchanged                                  |
| `:242` real API-authenticated workspace shell renders Task 4 review captures                 | functional, layout        | moved unchanged                                  |
| `:372` Task 7A Settings captures all Account sections, saved feedback, and narrow layouts    | functional, layout        | moved unchanged                                  |
| `:551` Task 7B member role Select is a nested Settings layer and Escape restores its trigger | functional, accessibility | moved unchanged                                  |
| `:744` real API-authenticated Home captures Task 6A shell states                             | functional, layout        | moved unchanged                                  |
| `:799` F4 new-chat composer exposes its active input and no retired controls                 | functional                | moved unchanged                                  |
| `:826` Task 6B auth state captures cover sign-in and secondary flows                         | functional, layout        | moved unchanged                                  |
| `:993` Task 7B Checkpoint C captures the indexed organization and settings states            | functional, layout        | moved unchanged                                  |

Proof of a faithful move: `pnpm test:e2e --project identity-browser` runs the 12 moved tests green against the unchanged (Royal Seal) UI.

Later F4.1 tasks update these assertions in place when they change the layout, and list each change old → new in `docs/references/F4.1-acceptance.md`.

## `backend/test/e2e/chat-visual.spec.ts` → `chat-states.spec.ts` and `chat-state-fixtures.ts` (Task 4C)

`chat-visual.spec.ts` was one capture test with no golden comparison. Its 62 non-screenshot assertions are the 8 setup assertions in the test (team creation, organization switch, onboarding, index size) and the 54 in `openState` and its helpers (per-state readiness, behavior, and the solid destructive button check).

| Source                                                                                                                                                                                                               | Kind                        | Destination                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture builders and state openers (`chatTree`, `chatList`, `searchPage`, `activeRunFrames`, `installChatFixtures`, `installRunStreamFixture`, `openState`, `expectSolidDestructiveButton`, constants), lines 19–848 | fixtures with 54 assertions | `backend/test/e2e/chat-state-fixtures.ts`, exported unchanged                                                                               |
| The test body up to the capture loop, minus `page.screenshot` and the index and manifest rewrite                                                                                                                     | functional                  | `backend/test/e2e/chat-states.spec.ts` ("every indexed F4 chat state opens with its expected content and controls"), project `chat-browser` |

Proof: `pnpm test:e2e --project chat-browser` passes with the new spec; `chat-visual` still passes with the fixtures imported from the new module.

## Still tied to the F2.1 goldens

`backend/test/e2e/platform-identity.spec.ts:54` ("F2 platform page passes both-theme axe checks in the real operator flow…") compares against F2.1 baselines through `captureTask9ReviewView`. Task 4D turns its screenshot comparison off the same way and keeps its axe and behavior assertions.

## Linux CI follow-ups (run 44309927756, commit b0658f1)

| Spec and line                                                                    | Old                                          | New                                                                               | Reason                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand-layout.spec.ts` `expectAppearanceGeometry` width (Task 7A narrow layouts) | `group.getBoundingClientRect().width <= 576` | span from the first card's left to the last card's right `<= 576`                 | The prototype appearance group fills the content column; the three fixed-width cards are what must stay compact. The card span is measured.                                   |
| `brand-layout.spec.ts` Task 7B Checkpoint C, invitations Cancel button           | `toHaveClass(/border-border/)`               | `toHaveClass(/text-muted-foreground/)` (the `not text-destructive` check is kept) | The prototype invitation row Cancel is `btn ghost sm`, not outline, so it has no border class.                                                                                |
| `platform-identity.spec.ts:447` provisioning detail opened                       | `getByText('provisioning', { exact: true })` | `[data-slot="badge"]` with text `Provisioning`                                    | The state badge capitalizes the state (prototype "Provisioning"); the old lowercase text no longer exists. The badge locator avoids matching the back link and the State row. |
| `chat-history.spec.ts:387` empty Chats state                                     | `height` is `320px`                          | `padding-top` and `padding-bottom` are `64px`                                     | The prototype `.empty` is `padding:64px 0` with content-sized height, so the fixed 320px height was retired.                                                                  |
| `platform-identity.spec.ts:273` Settings shortcut hint | `toContainText('⌘,')` | `toContainText(/(⌘\|Ctrl) ,/)` | The prototype hint is `Ctrl ,` (the Apple form `⌘ ,` after mount); the hint is still asserted, now in both platform forms. |
| `frontend/test/sidebar.spec.tsx:300` Settings item shortcut | `textContent` contains `⌘,` | `textContent` matches `/(⌘\|Ctrl) ,/` | Same as the E2E row above: the hint follows the prototype (`Ctrl ,`, Apple form `⌘ ,`); jsdom is a non-Apple platform. |
