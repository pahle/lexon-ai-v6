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

No Task 4 implementation has started. Formal screenshot approval remains Task 9.
