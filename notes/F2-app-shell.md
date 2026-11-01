# F2 — App shell: reference behavior notes (dirty side)

Source: reference diagrams (`10-arsitektur-per-layer/01-frontend-nextjs`,
`20-fitur/15-pengaturan`, `00-arsitektur-keseluruhan/peta-halaman-…`).
Behavior only; nothing here may be copied into `main`.

- The reference uses one app sidebar plus a page-header component; a
  separate "page chrome" context lets pages set titles and actions.
- Workspace context distinguishes Personal from the active organization;
  the switcher lives in the sidebar.
- User settings are a flat `/settings/<section>` set (profile/personalisation,
  appearance, security, models, connectors, memory, privacy, activity).
  Organization settings live under `/organizations/<id>/settings/<section>`.
  Lexon F2 adopts the same shape for profile, security, appearance and
  members/invitations/general; later sections arrive with their slices.
- The reference maps raw backend errors to friendly text in one place and
  never shows raw errors; Lexon F2 keeps this via shared error states.
- Appearance in the reference is a theme choice; Lexon adds Light/Dark/System
  with WCAG-checked dark tokens (product-owner decision).
- Home in the reference is the assistant page with a chat composer; Lexon F2
  scaffolds that surface with a disabled composer until F4.
