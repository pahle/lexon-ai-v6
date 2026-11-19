# F2.1 visual target (product-owner approved prototype)

Approved by the product owner on 2026-11-03 as the visual target for F2.1.
Implementation must match these screens in **layout, hierarchy, content,
navigation, and states**. Component sizes and internals come from the
shadcn/ui `base-nova` and assistant-ui components (LEX-DS-001 §5): where a
component differs from the prototype by a few pixels, the component wins; where
the structure or a state differs, the prototype wins.

The prototype is a design artifact, not source code. Do not copy its HTML or
CSS into `frontend/`; build the screens from the shadcn and assistant-ui
components named below.

## Screens (`screens/`, 1440×900, light unless named)

| File                                                                                | Shows                                                                                  | Built from                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `01-sign-in-light.png`, `02-sign-in-dark.png`                                       | Sign in, compact wordmark 128px, placeholder cover                                     | `login-02`, Field, InputGroup                        |
| `03-sign-in-field-errors.png`                                                       | Submit with invalid email and empty password: field-level errors, red label and border | Field (`data-invalid`, `FieldError`), `aria-invalid` |
| `04-sign-in-password-shown-loading.png`                                             | Password visible (eye toggle), pending submit with spinner                             | InputGroup + InputGroupButton, Button + Spinner      |
| `05-sign-in-form-error.png`                                                         | Server rejected the sign-in: form-level alert, generic copy                            | Alert (destructive)                                  |
| `10-home-light.png`, `11-home-dark.png`                                             | Workspace shell and Home                                                               | `sidebar-07`, assistant-ui Thread                    |
| `12-home-sidebar-collapsed.png`                                                     | Icon-collapsed sidebar: tile mark, Home, avatar                                        | `sidebar-07` (`collapsible="icon"`)                  |
| `13-organization-switcher-open.png`                                                 | Organization switcher menu: Personal, teams, Create a team                             | `sidebar-07` team switcher, DropdownMenu             |
| `14-user-menu-open.png`                                                             | User menu: Settings (Ctrl/Cmd ,), Sign out; Platform nav for a platform admin          | `sidebar-07` nav-user                                |
| `20-settings-profile.png`, `21-settings-profile-dark.png`                           | Settings dialog, Profile section                                                       | `sidebar-13` (sidebar in a dialog), Field            |
| `22-settings-appearance.png`                                                        | Appearance: Light, Dark, System cards                                                  | RadioGroup                                           |
| `23-settings-security.png`                                                          | Security: password, email, 2FA, sessions                                               | Field rows, Badge, Table                             |
| `24-settings-members.png`, `25-settings-invitations.png`, `26-settings-general.png` | Organization sections (team only, by role)                                             | Table, Select, Switch, Empty                         |
| `27-settings-saved-toast.png`                                                       | Non-blocking confirmation                                                              | Sonner                                               |
| `30-ui-patterns-light.png`, `31-ui-patterns-dark.png`                               | Required states for fields, passwords, buttons, alerts, toasts, empty, loading         | LEX-DS-001 §5.1                                      |
| `40-marks-current-vs-v1-1.png`                                                      | Brand v1.1 mark padding (top row old, bottom row new)                                  | `docs/brand/lexon-2026/`                             |

Headlines render in the system serif on Linux; on macOS and Windows they use
Georgia as LEX-DS-001 §3 specifies.

## Source

`source/*.dc.html` are the prototype artboards (Design canvas format), kept for
reference and to regenerate the PNGs. `shots.json` lists the captured states.
The product owner's live canvas: https://claude.ai/artifact/XnajyopyYmW3Fz3BZ2jAyY
(private to the product owner).
