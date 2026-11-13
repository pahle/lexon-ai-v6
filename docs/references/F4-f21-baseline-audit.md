# F4 audit of all F2.1 baselines

All **82** indexed views were rendered on Linux at producer `49ad2f95ed55ad95e74f16cafc3cf08d0634f6b0` in [run 43434198137](https://github.com/pahle/lexon-ai-v6/actions/runs/43434198137). The freshness step passed; all 82 downloaded PNG hashes match its retained manifest. Chromium `156.0.8078.4`, Playwright `1.64.1`, Node `v24.22.1`, Linux `7.0.0-1017-azure`, `en-US`, `Asia/Jakarta`, device scale 1. Original baseline, approval and index hashes remain unchanged. No baseline has been retired or regenerated.

The run's unit/integration job passed. Compose failed on the separate account-security Enter-to-disable-confirmation case; the 82-image producer and freshness validation completed. This is valid visual capture evidence, not a claim of full CI success. All 87 expected artifact files, including both explicit `.cache` metadata files, were retained; the suspected hidden-file omission did not occur and requires no workflow change.

The pinned public Playwright image comparator checked every image twice: once with the existing `maxDiffPixelRatio: 0.001` and default threshold, then with zero pixel tolerance for this audit only. Existing product comparison tolerances were not changed. **34 images are pixel-identical; 48 differ. 62 pass the existing comparison and 20 fail it.** Main-session review inspected the changed-image triptychs and representative native-size pairs.

## Classification and retirement scope

| Code | Count | Finding                                                                                                                                                                                        | Action                                                                                                                                |
| ---- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| I    |    34 | Pixel-identical.                                                                                                                                                                               | Keep existing assertions.                                                                                                             |
| N    |    16 | Approved navigation/breadcrumb changes only. Fourteen pass the existing threshold; two desktop Provisioning images fail.                                                                       | Keep the fourteen passing assertions. Two failing images meet the owner's condition, pending implementation of the retirement record. |
| B    |    14 | Settings desktop background: changed navigation and the blurred edge of the F4 composer. The Settings foreground rectangle is pixel-identical in every image. All pass the existing threshold. | Keep all existing assertions. No retirement proposed.                                                                                 |
| C    |    18 | Home, menu and sidebar states also show the F4 new-chat main area, directly or behind the mobile overlay.                                                                                      | **Hold retirement:** the current permission covers navigation only.                                                                   |

The C changes are required by the approved F4 design: remove the attachment button; add Deep thinking and the legal-information disclaimer; follow the prototype's composer/welcome hierarchy and placement ([brief items 1–3 and 18](../briefs/F4-chat.md), [design: visual reference](../superpowers/specs/2026-11-09-f4-chat-design.md)). Reverting these solely to match the inert F2.1 Home would conflict with F4. Owner clarification is needed before treating these specific changes as intentional retirement reasons. Any difference outside those specific required F4 changes is a regression to fix and is ineligible for retirement.

The temporary navigation behavior coverage passed through real Compose: labels/order, current-page state on New chat, Chats and a Recent thread, collapsed behavior and keyboard access. Existing functional/axe test bytes were preserved when adding that separate case. F4.1 must create replacement visual baselines; Task 20 remains deferred.

## Representative current images

The original reference is linked alongside each current image; these are review evidence, not goldens.

- Home: [original](F2.1-visual/baseline/home-desktop-light.png), [current](F4-f21-baseline-audit/current/home-desktop-light.png), [diff](F4-f21-baseline-audit/diff/home-desktop-light.png).
- Provisioning: [original](F2.1-visual/baseline/provisioning-desktop-light.png), [current](F4-f21-baseline-audit/current/provisioning-desktop-light.png), [diff](F4-f21-baseline-audit/diff/provisioning-desktop-light.png).
- Settings: [original](F2.1-visual/baseline/profile-desktop-light.png), [current](F4-f21-baseline-audit/current/profile-desktop-light.png), [diff](F4-f21-baseline-audit/diff/profile-desktop-light.png).

## Complete 82-image inventory

Full baseline/current SHA-256 values, exact different-pixel counts, bounds and reasons are recorded in [index.json](F4-f21-baseline-audit/index.json). Every differing image has a full-size exact-pixel diff; the stricter diagnostic does not replace or weaken the existing comparator.

| Image                                          | Existing comparison | Class | Diff                                                                            |
| ---------------------------------------------- | ------------------- | ----- | ------------------------------------------------------------------------------- |
| `sign-in-desktop-light`                        | passed              | I     | identical                                                                       |
| `sign-in-desktop-dark`                         | passed              | I     | identical                                                                       |
| `sign-in-mobile-light`                         | passed              | I     | identical                                                                       |
| `sign-in-mobile-dark`                          | passed              | I     | identical                                                                       |
| `sign-up-desktop-light`                        | passed              | I     | identical                                                                       |
| `sign-up-desktop-dark`                         | passed              | I     | identical                                                                       |
| `sign-up-mobile-light`                         | passed              | I     | identical                                                                       |
| `sign-up-mobile-dark`                          | passed              | I     | identical                                                                       |
| `forgot-password-desktop-light`                | passed              | I     | identical                                                                       |
| `forgot-password-desktop-dark`                 | passed              | I     | identical                                                                       |
| `forgot-password-mobile-light`                 | passed              | I     | identical                                                                       |
| `forgot-password-mobile-dark`                  | passed              | I     | identical                                                                       |
| `two-factor-desktop-light`                     | passed              | I     | identical                                                                       |
| `two-factor-desktop-dark`                      | passed              | I     | identical                                                                       |
| `two-factor-mobile-light`                      | passed              | I     | identical                                                                       |
| `two-factor-mobile-dark`                       | passed              | I     | identical                                                                       |
| `onboarding-desktop-light`                     | passed              | I     | identical                                                                       |
| `onboarding-desktop-dark`                      | passed              | I     | identical                                                                       |
| `onboarding-mobile-light`                      | passed              | I     | identical                                                                       |
| `onboarding-mobile-dark`                       | passed              | I     | identical                                                                       |
| `home-desktop-light`                           | failed              | C     | [diff](F4-f21-baseline-audit/diff/home-desktop-light.png)                       |
| `home-desktop-dark`                            | failed              | C     | [diff](F4-f21-baseline-audit/diff/home-desktop-dark.png)                        |
| `home-mobile-light`                            | failed              | C     | [diff](F4-f21-baseline-audit/diff/home-mobile-light.png)                        |
| `home-mobile-dark`                             | failed              | C     | [diff](F4-f21-baseline-audit/diff/home-mobile-dark.png)                         |
| `profile-desktop-light`                        | passed              | B     | [diff](F4-f21-baseline-audit/diff/profile-desktop-light.png)                    |
| `profile-desktop-dark`                         | passed              | B     | [diff](F4-f21-baseline-audit/diff/profile-desktop-dark.png)                     |
| `profile-mobile-light`                         | passed              | N     | [diff](F4-f21-baseline-audit/diff/profile-mobile-light.png)                     |
| `profile-mobile-dark`                          | passed              | N     | [diff](F4-f21-baseline-audit/diff/profile-mobile-dark.png)                      |
| `security-desktop-light`                       | passed              | B     | [diff](F4-f21-baseline-audit/diff/security-desktop-light.png)                   |
| `security-desktop-dark`                        | passed              | B     | [diff](F4-f21-baseline-audit/diff/security-desktop-dark.png)                    |
| `security-mobile-light`                        | passed              | N     | [diff](F4-f21-baseline-audit/diff/security-mobile-light.png)                    |
| `security-mobile-dark`                         | passed              | N     | [diff](F4-f21-baseline-audit/diff/security-mobile-dark.png)                     |
| `appearance-desktop-light`                     | passed              | B     | [diff](F4-f21-baseline-audit/diff/appearance-desktop-light.png)                 |
| `appearance-desktop-dark`                      | passed              | B     | [diff](F4-f21-baseline-audit/diff/appearance-desktop-dark.png)                  |
| `appearance-mobile-light`                      | passed              | N     | [diff](F4-f21-baseline-audit/diff/appearance-mobile-light.png)                  |
| `appearance-mobile-dark`                       | passed              | N     | [diff](F4-f21-baseline-audit/diff/appearance-mobile-dark.png)                   |
| `members-desktop-light`                        | passed              | B     | [diff](F4-f21-baseline-audit/diff/members-desktop-light.png)                    |
| `members-desktop-dark`                         | passed              | B     | [diff](F4-f21-baseline-audit/diff/members-desktop-dark.png)                     |
| `members-mobile-light`                         | passed              | N     | [diff](F4-f21-baseline-audit/diff/members-mobile-light.png)                     |
| `members-mobile-dark`                          | passed              | N     | [diff](F4-f21-baseline-audit/diff/members-mobile-dark.png)                      |
| `invitations-desktop-light`                    | passed              | B     | [diff](F4-f21-baseline-audit/diff/invitations-desktop-light.png)                |
| `invitations-desktop-dark`                     | passed              | B     | [diff](F4-f21-baseline-audit/diff/invitations-desktop-dark.png)                 |
| `invitations-mobile-light`                     | passed              | N     | [diff](F4-f21-baseline-audit/diff/invitations-mobile-light.png)                 |
| `invitations-mobile-dark`                      | passed              | N     | [diff](F4-f21-baseline-audit/diff/invitations-mobile-dark.png)                  |
| `general-desktop-light`                        | passed              | B     | [diff](F4-f21-baseline-audit/diff/general-desktop-light.png)                    |
| `general-desktop-dark`                         | passed              | B     | [diff](F4-f21-baseline-audit/diff/general-desktop-dark.png)                     |
| `general-mobile-light`                         | passed              | N     | [diff](F4-f21-baseline-audit/diff/general-mobile-light.png)                     |
| `general-mobile-dark`                          | passed              | N     | [diff](F4-f21-baseline-audit/diff/general-mobile-dark.png)                      |
| `provisioning-desktop-light`                   | failed              | N     | [diff](F4-f21-baseline-audit/diff/provisioning-desktop-light.png)               |
| `provisioning-desktop-dark`                    | failed              | N     | [diff](F4-f21-baseline-audit/diff/provisioning-desktop-dark.png)                |
| `provisioning-mobile-light`                    | passed              | I     | identical                                                                       |
| `provisioning-mobile-dark`                     | passed              | I     | identical                                                                       |
| `organization-switcher-open-desktop-light`     | failed              | C     | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-desktop-light.png) |
| `organization-switcher-open-desktop-dark`      | failed              | C     | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-desktop-dark.png)  |
| `organization-switcher-open-mobile-light`      | failed              | C     | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-mobile-light.png)  |
| `organization-switcher-open-mobile-dark`       | failed              | C     | [diff](F4-f21-baseline-audit/diff/organization-switcher-open-mobile-dark.png)   |
| `user-menu-open-desktop-light`                 | failed              | C     | [diff](F4-f21-baseline-audit/diff/user-menu-open-desktop-light.png)             |
| `user-menu-open-desktop-dark`                  | failed              | C     | [diff](F4-f21-baseline-audit/diff/user-menu-open-desktop-dark.png)              |
| `user-menu-open-mobile-light`                  | failed              | C     | [diff](F4-f21-baseline-audit/diff/user-menu-open-mobile-light.png)              |
| `user-menu-open-mobile-dark`                   | failed              | C     | [diff](F4-f21-baseline-audit/diff/user-menu-open-mobile-dark.png)               |
| `sign-in-field-errors-desktop-light`           | passed              | I     | identical                                                                       |
| `sign-in-field-errors-desktop-dark`            | passed              | I     | identical                                                                       |
| `sign-in-field-errors-mobile-light`            | passed              | I     | identical                                                                       |
| `sign-in-field-errors-mobile-dark`             | passed              | I     | identical                                                                       |
| `sign-in-password-shown-loading-desktop-light` | passed              | I     | identical                                                                       |
| `sign-in-password-shown-loading-desktop-dark`  | passed              | I     | identical                                                                       |
| `sign-in-password-shown-loading-mobile-light`  | passed              | I     | identical                                                                       |
| `sign-in-password-shown-loading-mobile-dark`   | passed              | I     | identical                                                                       |
| `sign-in-form-error-desktop-light`             | passed              | I     | identical                                                                       |
| `sign-in-form-error-desktop-dark`              | passed              | I     | identical                                                                       |
| `sign-in-form-error-mobile-light`              | passed              | I     | identical                                                                       |
| `sign-in-form-error-mobile-dark`               | passed              | I     | identical                                                                       |
| `settings-saved-toast-desktop-light`           | passed              | B     | [diff](F4-f21-baseline-audit/diff/settings-saved-toast-desktop-light.png)       |
| `settings-saved-toast-desktop-dark`            | passed              | B     | [diff](F4-f21-baseline-audit/diff/settings-saved-toast-desktop-dark.png)        |
| `settings-saved-toast-mobile-light`            | passed              | N     | [diff](F4-f21-baseline-audit/diff/settings-saved-toast-mobile-light.png)        |
| `settings-saved-toast-mobile-dark`             | passed              | N     | [diff](F4-f21-baseline-audit/diff/settings-saved-toast-mobile-dark.png)         |
| `sidebar-header-expanded-desktop-light`        | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-desktop-light.png)    |
| `sidebar-header-expanded-desktop-dark`         | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-desktop-dark.png)     |
| `sidebar-header-expanded-mobile-light`         | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-mobile-light.png)     |
| `sidebar-header-expanded-mobile-dark`          | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-expanded-mobile-dark.png)      |
| `sidebar-header-collapsed-desktop-light`       | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-collapsed-desktop-light.png)   |
| `sidebar-header-collapsed-desktop-dark`        | failed              | C     | [diff](F4-f21-baseline-audit/diff/sidebar-header-collapsed-desktop-dark.png)    |
