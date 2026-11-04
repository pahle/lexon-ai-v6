# Checkpoint C — owner-feedback corrections

The product owner accepted this Checkpoint C preview at `0476a87` after the six corrections. This is checkpoint feedback, not Task 9 formal approval. Tasks 8 and 9 are authorized; execution must stop again at the Task 9 owner gate.

The updated review below shows only the 24 affected production Compose PNGs: twelve states in light and dark, 1440×900, device scale factor 1. Click a thumbnail for the full image. Stable filenames are overwritten in place. Home, collapsed-sidebar and operator-menu captures (six PNGs) remain unchanged, and the canonical index still contains all thirty C images. Source prototype images remain unchanged.

This is the amended plan's informal checkpoint after Task 7B. Owner feedback is required before Task 8; Task 9 formal screenshot approval remains separate. Historical Checkpoint B was not approved. [Draft PR #23](https://github.com/pahle/lexon-ai-v6/pull/23) stays a draft.

| View                       | Light                                                                                                                                                        | Dark                                                                                                                                                      | Approved prototype                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign in                    | [<img src="./c-sign-in-light.png" width="280" alt="Sign in, light">](./c-sign-in-light.png)                                                                  | [<img src="./c-sign-in-dark.png" width="280" alt="Sign in, dark">](./c-sign-in-dark.png)                                                                  | [01](../../../design/f2.1-prototype/screens/01-sign-in-light.png) / [02](../../../design/f2.1-prototype/screens/02-sign-in-dark.png)             |
| Field errors               | [<img src="./c-sign-in-field-errors-light.png" width="280" alt="Field errors, light">](./c-sign-in-field-errors-light.png)                                   | [<img src="./c-sign-in-field-errors-dark.png" width="280" alt="Field errors, dark">](./c-sign-in-field-errors-dark.png)                                   | [03](../../../design/f2.1-prototype/screens/03-sign-in-field-errors.png)                                                                         |
| Shown password and pending | [<img src="./c-sign-in-password-shown-loading-light.png" width="280" alt="Shown password and pending, light">](./c-sign-in-password-shown-loading-light.png) | [<img src="./c-sign-in-password-shown-loading-dark.png" width="280" alt="Shown password and pending, dark">](./c-sign-in-password-shown-loading-dark.png) | [04](../../../design/f2.1-prototype/screens/04-sign-in-password-shown-loading.png)                                                               |
| Sign-in failure            | [<img src="./c-sign-in-form-error-light.png" width="280" alt="Sign-in failure, light">](./c-sign-in-form-error-light.png)                                    | [<img src="./c-sign-in-form-error-dark.png" width="280" alt="Sign-in failure, dark">](./c-sign-in-form-error-dark.png)                                    | [05](../../../design/f2.1-prototype/screens/05-sign-in-form-error.png)                                                                           |
| Organization switcher      | [<img src="./c-organization-switcher-open-light.png" width="280" alt="Organization switcher, light">](./c-organization-switcher-open-light.png)              | [<img src="./c-organization-switcher-open-dark.png" width="280" alt="Organization switcher, dark">](./c-organization-switcher-open-dark.png)              | [13](../../../design/f2.1-prototype/screens/13-organization-switcher-open.png)                                                                   |
| Profile                    | [<img src="./c-profile-light.png" width="280" alt="Profile, light">](./c-profile-light.png)                                                                  | [<img src="./c-profile-dark.png" width="280" alt="Profile, dark">](./c-profile-dark.png)                                                                  | [20](../../../design/f2.1-prototype/screens/20-settings-profile.png) / [21](../../../design/f2.1-prototype/screens/21-settings-profile-dark.png) |
| Appearance                 | [<img src="./c-appearance-light.png" width="280" alt="Appearance, light">](./c-appearance-light.png)                                                         | [<img src="./c-appearance-dark.png" width="280" alt="Appearance, dark">](./c-appearance-dark.png)                                                         | [22](../../../design/f2.1-prototype/screens/22-settings-appearance.png)                                                                          |
| Security                   | [<img src="./c-security-light.png" width="280" alt="Security, light">](./c-security-light.png)                                                               | [<img src="./c-security-dark.png" width="280" alt="Security, dark">](./c-security-dark.png)                                                               | [23](../../../design/f2.1-prototype/screens/23-settings-security.png)                                                                            |
| Members                    | [<img src="./c-members-light.png" width="280" alt="Members, light">](./c-members-light.png)                                                                  | [<img src="./c-members-dark.png" width="280" alt="Members, dark">](./c-members-dark.png)                                                                  | [24](../../../design/f2.1-prototype/screens/24-settings-members.png)                                                                             |
| Invitations                | [<img src="./c-invitations-light.png" width="280" alt="Invitations, light">](./c-invitations-light.png)                                                      | [<img src="./c-invitations-dark.png" width="280" alt="Invitations, dark">](./c-invitations-dark.png)                                                      | [25](../../../design/f2.1-prototype/screens/25-settings-invitations.png)                                                                         |
| General                    | [<img src="./c-general-light.png" width="280" alt="General, light">](./c-general-light.png)                                                                  | [<img src="./c-general-dark.png" width="280" alt="General, dark">](./c-general-dark.png)                                                                  | [26](../../../design/f2.1-prototype/screens/26-settings-general.png)                                                                             |
| Saved toast                | [<img src="./c-settings-saved-toast-light.png" width="280" alt="Saved toast, light">](./c-settings-saved-toast-light.png)                                    | [<img src="./c-settings-saved-toast-dark.png" width="280" alt="Saved toast, dark">](./c-settings-saved-toast-dark.png)                                    | [27](../../../design/f2.1-prototype/screens/27-settings-saved-toast.png)                                                                         |

The shown-password frame uses a deliberately invalid synthetic value. Team names, people, invitation dates and sessions come from test accounts and real local APIs. Security omits Device and Last active because F1 does not return those fields. The operator menu uses an authenticated MFA-enabled platform administrator.

[Acceptance evidence and adaptations](../../F2.1-acceptance.md) records the main-session comparisons, behavior tests and limits. Prototypes 30–31 guide shared states; platform pages have no dedicated prototype and are reviewed against prototype 14's shell and published Card/Field components.

To regenerate only these affected images and run their browser checks with a fresh production Compose stack:

```sh
env -u LEXON_VISUAL_DEV LEXON_CHECKPOINT_C_VIEWS=sign-in,sign-in-field-errors,sign-in-password-shown-loading,sign-in-form-error,organization-switcher-open,profile,appearance,security,members,invitations,general,settings-saved-toast pnpm test:e2e -- --project=visual-review --project=identity-browser --grep '(Task 7B Checkpoint C captures the indexed organization and settings states|Task 7B member role Select is a nested Settings layer and Escape restores its trigger|settings deep links, shortcut, draft reset, and nested destructive focus)'
node --test scripts/test/visual-index.spec.mjs
```

## Historical checkpoints

# Checkpoint A — auth and onboarding

Informal owner preview after Task 3. Feedback is required before Task 4.
These are real local Linux Compose captures, PNG, device scale factor 1.
Desktop: 1440×900. Mobile: 390×844. Files are overwritten in place.

| Page       | Desktop light                                     | Desktop dark                                    | Mobile light                                    | Mobile dark                                   |
| ---------- | ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Sign in    | [Desktop light](./a-sign-in-desktop-light.png)    | [Desktop dark](./a-sign-in-desktop-dark.png)    | [Mobile light](./a-sign-in-mobile-light.png)    | [Mobile dark](./a-sign-in-mobile-dark.png)    |
| Sign up    | [Desktop light](./a-sign-up-desktop-light.png)    | [Desktop dark](./a-sign-up-desktop-dark.png)    | [Mobile light](./a-sign-up-mobile-light.png)    | [Mobile dark](./a-sign-up-mobile-dark.png)    |
| Onboarding | [Desktop light](./a-onboarding-desktop-light.png) | [Desktop dark](./a-onboarding-desktop-dark.png) | [Mobile light](./a-onboarding-mobile-light.png) | [Mobile dark](./a-onboarding-mobile-dark.png) |

The corrections reduce the auth logo to 128px, use “Your legal workspace starts
here.” as the sign-up subtitle, and show verification resend only after valid
credentials require email verification (and in the existing post-signup flow).

After the Checkpoint A owner feedback corrections, the visual-review Compose
suite passed 4/4 and regenerated all twelve images. Main independently reran
the suite (4/4), passed 15 focused unit tests, and visually compared all twelve
images side by side with the pristine references. The production build remains blocked by the Task 5
Home API mismatch. The actual unverified sign-in continuation is separately
covered by the identity-browser Compose flow. See
[acceptance notes](../../F2.1-acceptance.md).

Checkpoint A corrections were accepted by the owner before Task 4. The build
limitation above records the historical Task 3 state; Task 5 restored the
production build. Formal screenshot approval remains Task 9.

## Checkpoint B — Home and workspace shell (not approved)

Informal owner preview after Task 5. These real API-authenticated production
Compose captures use the fixed synthetic identity `Checkpoint Preview`
(`checkpoint-b@example.test`) and team `Checkpoint B Team`. PNG, device scale
factor 1; desktop 1440×900 and mobile 390×844. Mobile Home is captured with the
navigation sheet closed; the other mobile views show it open. Desktop
collapsed-sidebar views are included separately. Stable paths are overwritten
in place. All entries are also listed in `../index.json`.

| View                       | Desktop light                                           | Desktop dark                                           | Mobile light                                           | Mobile dark                                           |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Home                       | [PNG](./b-home-desktop-light.png)                       | [PNG](./b-home-desktop-dark.png)                       | [PNG](./b-home-mobile-light.png)                       | [PNG](./b-home-mobile-dark.png)                       |
| Sidebar expanded           | [PNG](./b-sidebar-expanded-desktop-light.png)           | [PNG](./b-sidebar-expanded-desktop-dark.png)           | [PNG](./b-sidebar-expanded-mobile-light.png)           | [PNG](./b-sidebar-expanded-mobile-dark.png)           |
| Organization switcher open | [PNG](./b-organization-switcher-open-desktop-light.png) | [PNG](./b-organization-switcher-open-desktop-dark.png) | [PNG](./b-organization-switcher-open-mobile-light.png) | [PNG](./b-organization-switcher-open-mobile-dark.png) |
| User menu open             | [PNG](./b-user-menu-open-desktop-light.png)             | [PNG](./b-user-menu-open-desktop-dark.png)             | [PNG](./b-user-menu-open-mobile-light.png)             | [PNG](./b-user-menu-open-mobile-dark.png)             |
| Sidebar collapsed          | [PNG](./b-sidebar-collapsed-desktop-light.png)          | [PNG](./b-sidebar-collapsed-desktop-dark.png)          | —                                                      | —                                                     |

Main independently rendered and inspected all 18 PNGs and compared the Home,
shell, and conversation group side by side with the matching pristine references.
Task 5 spec and code quality reviews passed; focused tests, production build,
typecheck, lint, and the production capture passed. See the acceptance notes
for comparison evidence and deviations.

The owner did **not approve Checkpoint B**. Its captures remain historical
evidence. Brief Amendment 1 and the approved prototype replace this visual
target. The amended plan is approved and execution resumes at 6A; the next
mandatory feedback stop is Checkpoint C after 7B, before Task 8. Formal
screenshot approval remains Task 9.
