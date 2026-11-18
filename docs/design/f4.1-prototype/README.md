# F4.1 prototype: brand v4.1 and chat experience

**Approved by the product owner on 2026-11-18 (revision 14).** This is the visual
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
- `screens/r14/<state>-<d|m>[-dark].png`: every state at 1440×900 (`d`) and
  390×844 (`m`), light and dark (264 files).
- `screens/fm-strip.png`, `screens/finish-strip.png`: the thinking indicator.
- The numbered PNGs in `screens/` (`00-personal.png` to `51-mobile-dark.png`)
  are revision 12, kept for history. Revision 14 supersedes them.
- Tokens: LEX-DS-001 §2.

## States

State names are the F4.1 visual capture ids. Each capture is compared with the
state of the same name.

| Group     | States                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth      | `sign-in`, `sign-in-field-errors`, `sign-in-form-alert`, `sign-in-pending`, `sign-up`, `forgot-password`, `forgot-password-sent`, `reset-password`, `reset-password-invalid`, `verify-email`, `two-factor`, `accept-invitation`, `accept-invitation-unavailable`, `admin-setup`, `admin-setup-unavailable`, `onboarding`, `onboarding-invitations`                  |
| Status    | `not-found`, `organizations-not-found`, `workspace-error`, `platform-no-access`                                                                                                                                                                                                                                                                                     |
| Shell     | `shell-personal`, `shell-team`, `organization-switcher-open`, `user-menu-open`, `recent-menu`, `sidebar-collapsed`, `mobile-sheet-open`                                                                                                                                                                                                                             |
| Chat      | `chat-new`, `chat-starter-pill`, `chat-deep-thinking`, `chat-thinking`, `chat-streaming-scroll`, `chat-reasoning-collapsed`, `chat-reasoning-open`, `chat-answer-actions`, `chat-copied`, `chat-feedback`, `chat-edit`, `chat-branch`, `chat-stopped`, `chat-error`, `chat-reconnecting`, `chat-thread-loading`, `chat-floating-menu`, `chat-rename`, `chat-delete` |
| Chats     | `chats-history`, `chats-search`, `chats-no-results`, `chats-empty`, `chats-loading`                                                                                                                                                                                                                                                                                 |
| Settings  | `settings-profile`, `settings-appearance`, `settings-security`, `settings-members`, `settings-invitations`, `settings-general`, `toast-success`                                                                                                                                                                                                                     |
| Platform  | `platform-accounts`, `platform-provisioning-populated`, `platform-provisioning-empty`, `platform-provisioning-loading`, `platform-provisioning-error`, `platform-provisioning-detail`                                                                                                                                                                               |
| Indicator | `indicator` (the thinking indicator at preview and actual size)                                                                                                                                                                                                                                                                                                     |

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
- Sidebar: no "Tools" label; "Recent" is the only labeled group. Platform shows
  only to platform administrators.
- Answer actions are icon-only; stopped and reconnecting are status lines; a
  failure is one error row; edit Cancel and Save sit below the box.
- Toasts appear at the top right, never over the composer.
- Platform pages keep today's functions (provisioning, account status) in the
  platform page pattern; F4.3 replaces them with Accounts and Organizations.

## Thinking indicator

One continuous morphing mark, about 20px in the message header, drawn in SVG
with a small amount of script; LEX-DS-001 §5.4 describes it, and the
`indicator` state shows it.
