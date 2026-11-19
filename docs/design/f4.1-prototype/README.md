# F4.1 prototype: brand v4.1 and chat experience

**Approved by the product owner on 2026-11-18 (revision 14.9); revision 15 adds the F4.2 failure states (2026-11-19).** This is the visual
target for [F4.1](../../briefs/F4.1-brand-refresh.md). Screens are built **1:1**
with it: layout, sizes, spacing, type, copy, and states. shadcn `base-nova` and
assistant-ui provide structure, behavior, and accessibility (LEX-DS-001 v3.1 §5).
The measured values are written down in LEX-DS-001 v3.1 §5.5, and the fidelity
gate is in §5.6.

- `source/prototype.html`: the clickable prototype, self-contained (fonts and
  marks embedded). Open it in a browser and pick a state; switch Desktop/Mobile
  and Light/Dark. Add `?shot=1` to hide the picker, `&m=1` for mobile,
  `&theme=dark` for dark, and `#<state>` for the state, for example
  `prototype.html?shot=1&m=1&theme=dark#chat-edit`. It is a design artifact;
  build the product from shadcn and assistant-ui, styled to match it.
- `source/prototype.src.html`: the same markup, CSS, and script as
  `prototype.html` without the embedded fonts and marks (about 110 KB instead of
  380 KB). **Read this file for values**; open `prototype.html` to view states.
- `screens/r14/<state>-<d|m>[-dark].png`: every state of the current
  revision at 1440×900 (`d`) and 390×844 (`m`), light and dark (300 files).
  The folder keeps its name; it always holds the current revision.
- `screens/fm-strip.png`, `screens/finish-strip.png`: the thinking indicator.
- The numbered PNGs in `screens/` (`00-personal.png` to `51-mobile-dark.png`)
  are revision 12, kept for history. Revision 14 supersedes them.
- Tokens: LEX-DS-001 §2.

## States

State names are the F4.1 visual capture ids. Each capture is compared with the
state of the same name.

| Group     | States                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth      | `sign-in`, `sign-in-field-errors`, `sign-in-form-alert`, `sign-in-pending`, `sign-up`, `forgot-password`, `forgot-password-sent`, `reset-password`, `reset-password-invalid`, `verify-email`, `two-factor`, `accept-invitation`, `accept-invitation-declined`, `accept-invitation-unavailable`, `admin-setup`, `admin-setup-activate`, `admin-setup-unavailable`, `onboarding`, `onboarding-invitations`, `onboarding-team` |
| Status    | `not-found`, `organizations-not-found`, `workspace-error`, `platform-no-access`                                                                                                                                                                                                                                                                                                                                             |
| Shell     | `shell-personal`, `shell-team`, `organization-switcher-open`, `user-menu-open`, `recent-menu`, `sidebar-collapsed`, `mobile-sheet-open`, `recent-load-failed`                                                                                                                                                                                                                                                                                     |
| Chat      | `chat-new`, `chat-starter-pill`, `chat-deep-thinking`, `chat-thinking`, `chat-streaming-scroll`, `chat-reasoning-collapsed`, `chat-reasoning-open`, `chat-answer-actions`, `chat-copied`, `chat-copy-failed`, `chat-feedback`, `chat-edit`, `chat-branch`, `chat-stopped`, `chat-error`, `chat-reconnecting`, `chat-composer-running`, `chat-thread-loading`, `chat-floating-menu`, `chat-rename`, `chat-delete`                                                         |
| Chats     | `chats-history`, `chats-search`, `chats-no-results`, `chats-empty`, `chats-loading`, `chats-load-failed`                                                                                                                                                                                                                                                                                                                                         |
| Settings  | `settings-profile`, `settings-appearance`, `settings-security`, `settings-members`, `settings-invitations`, `settings-general`, `settings-profile-save-failed`, `settings-members-load-failed`, `toast-success`                                                                                                                                                                                                                                                                             |
| Platform  | `platform-accounts`, `platform-provisioning-populated`, `platform-provisioning-empty`, `platform-provisioning-loading`, `platform-provisioning-error`, `platform-provisioning-detail`                                                                                                                                                                                                                                       |
| Indicator | `indicator` (the thinking indicator at preview and actual size)                                                                                                                                                                                                                                                                                                                                                             |

## Fixtures shown

- User: Ayu Wardani, Senior Associate, `ayu@hukum-nusantara.co.id`.
- Team: Hukum Nusantara (`HN`, 3 members: Ayu Wardani as owner, Rizky Pratama
  as admin, Sari Wibowo as member); other organization: Pro Bono Clinic.
- Chat: "Syarat sah perjanjian (Pasal 1320)" with the question and answer shown
  in the states; Recent lists the six chats in `chats-history`.
- Platform administrator: Dimas Prasetyo; provisioning organizations Harbor
  Legal Partners, Sinar Hukum, and Kantor Hukum Wibowo.

## Decisions in revision 14 (owner review round 4)

- One wordmark on auth pages, in the form column; the Night cover has the rule,
  tagline, statement, and domain only. No icon tile above auth titles.
- Every page uses a pattern: auth frame, status page, list page, settings
  dialog, platform page (LEX-DS-001 §5.5).
- Chat header shows the full chat title next to the sidebar trigger, on
  desktop and mobile.
- Sidebar: the team tile, the Assistant icon, and the user avatar keep the same
  position when the sidebar collapses. No "Tools" label; "Recent" is the only labeled group. Platform shows
  only to platform administrators.
- Answer actions are icon-only; stopped and reconnecting are status lines; a
  failure is one error row; edit Cancel and Save sit below the box.
- Toasts appear at the top right, never over the composer.
- Platform pages keep today's functions (provisioning, account status) in the
  platform page pattern; F4.3 replaces them with Accounts and Organizations.

## Revision 14.3 (2026-11-18): auth flows as F4 delivered them

Revision 14 drew four auth flows that Lexon does not have. They now show
today's behavior (the brief: behavior stays as F4 delivered it):

- Onboarding has three steps: display name, pending invitations, then create a
  team or start on your own (`onboarding-team`).
- Reset password has one New password field.
- Accept invitation shows Accept and Decline with no organization details, and
  Sign in or create an account for the wrong account; `accept-invitation-declined`
  added.
- Administrator setup is sign in or create the setup account, then email and
  two-step verification, then `admin-setup-activate`.

## Revision 14.5 (2026-11-18): owner decisions during round 4

Drawn from the round-4 code on `f4.1-brand-refresh`, not from memory:

- Settings → Security: Password ("Last changed …"), Email with Change email,
  Two-step verification with Recovery codes and Manage, "Where you are signed
  in" with Sign out other sessions; each session shows the device, "This
  device", and "Active now" or "Signed in N days ago". No location.
- Settings → Members: a Leave organization button below the list.
- Chats: date groups Today, Yesterday, Previous 7 days, Previous 30 days, then
  months; the Nov 4 chats sit under Previous 30 days, and search shows the same
  dates.
- Composer: grows with its text up to 200px (mobile 144px), then scrolls inside.
- Mobile: Copy and Edit under a user message stay visible (no hover on touch).
- Editing a message keeps the action row under the muted answer.

## Revision 14.6–14.9 (2026-11-19)

- chat-error: the answer header keeps "Thought for N seconds" when the
  thinking duration was measured before the failure (owner); with no measured
  duration, the mark stays alone.

- Sidebar on one grid (owner): content runs x 16–240; tile, icons, titles and
  avatar share the left edge; chevron glyphs, the shortcut and ⋯ share the
  right edge. The collapsed rail is 64px so the tile and avatar never move.

- Auth wordmark 96px on desktop and 88px on mobile, down from 128px (owner).

- Mobile auth: the wordmark stays at the top and the form block is centered
  vertically in the remaining height (owner).
- User message Copy and Edit are hidden while an answer is thinking, streaming,
  or reconnecting, as the app already does.

## Revision 15 (2026-11-19): F4.2 failure states

The product owner approved these states in the F4.2 spec review. LEX-DS-001 v3.2 records their values.

- `chat-copy-failed`: Copy shows the alert icon and the tooltip "Could not copy". The next click tries again.
- `chat-composer-running`: the user tried to send while an answer was arriving. The disclaimer line reads "Wait for the answer to finish, or stop it."
- `chat-thread-loading` (changed): the disclaimer line reads "Loading this chat…".
- `recent-load-failed`: Recent shows "We could not load recent chats." with a Try again link.
- `chats-load-failed`: the error row replaces the list.
- `settings-members-load-failed`: the error row replaces the member rows. Invitations, sessions, and platform lists use the same pattern; platform already has `platform-provisioning-error`.
- `settings-profile-save-failed`: the form alert sits above the fields. The typed value ("Partner") is kept, and Save stays enabled. Organization General uses the same pattern. Appearance is saved on the device only (`next-themes`), so it cannot fail to save.
- `chat-streaming-scroll` and `chat-reconnecting` (changed): scroll-to-latest now sits 12px above the composer box. In revision 14 it covered the top of the composer on mobile and touched it on desktop. This fixes a revision 14 defect.
- On mobile, the tooltip of the first answer action aligns with the button's left edge.

## Thinking indicator

One continuous morphing mark, about 20px in the message header, drawn in SVG
with a small amount of script; LEX-DS-001 §5.4 describes it, and the
`indicator` state shows it.
