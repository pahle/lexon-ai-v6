# Task 3 report — published auth frame and onboarding

## Implementation

- Added a shared server-compatible `AuthFrame` and moved sign-in/sign-up form heading, field, submit, and footer structure to the published login-02/signup-02 pattern while retaining existing auth handlers, schemas, links, and policy copy. Forgot password now sits in the password label row. No social controls were added.
- Applied the same frame to recovery, verification, two-factor challenge, invitation, admin setup, and onboarding presentation. Kept non-auth `AuthCard` callers in their existing card mode. Removed the collapsed nested onboarding centering wrappers.
- Added a regular-hook shell-local sidebar bridge for existing optional sidebar consumers because the pristine published sidebar removed `useSidebarOptional`; generated `ui/sidebar.tsx` was not changed. Standalone consumers still see no optional state outside the provider.
- Reset generated `ui/input-otp.tsx` with the pinned shadcn CLI in the auth-owned flow; added exact-pinned `tw-animate-css@1.4.0`, an import required by the retained generated UI CSS.
- Added the test-only `@` alias, the visual-review Playwright project, a minimal Compose `visual-dev` target using the existing runner/descriptor, and a reusable real-stack capture helper. Development indicator suppression is conditional on `LEXON_VISUAL_DEV=1`; normal Next config behavior is unchanged.
- Adapted `postcss.config.mjs` to the official Tailwind v4 PostCSS plugin object shape after the imported generated UI CSS exposed Vite's failure to load the prior Next plugin string array.

## TDD and verification

- RED — `pnpm exec vitest run --project frontend frontend/test/auth-presentation.spec.tsx frontend/test/auth-entry.spec.tsx frontend/test/auth-primitives.spec.tsx frontend/test/organizations.spec.tsx`: before production edits, the new frame test failed because the old layout lacked `lg:grid-cols-2`; before transplanting form markup, real LoginForm/SignupForm heading assertions failed because the published centered FieldGroup hierarchy was missing.
- GREEN — `pnpm exec vitest run --project frontend frontend/test/auth-presentation.spec.tsx frontend/test/auth-entry.spec.tsx frontend/test/auth-primitives.spec.tsx frontend/test/organizations.spec.tsx frontend/test/brand.spec.tsx frontend/test/sidebar-context.spec.tsx`: 6 files, 15 tests passed.
- GREEN — focused ESLint over changed source/test/capture files completed with exit 0.
- GREEN — `pnpm exec vitest run --project frontend frontend/test/workspace-shell.spec.tsx`: 26 tests passed after the optional sidebar bridge.
- GREEN — Compose visual-review browser assertions: 1023/1024 cover boundary and overflow checks passed; secondary account routes `/forgot-password`, `/reset-password`, `/verify-email`, `/two-factor`, `/accept-invitation`, `/admin-setup` all returned 200 with one main, one heading, and the empty cover.
- GREEN — `LEXON_VISUAL_DEV=1 pnpm test:e2e -- --project visual-review`: 4 tests passed; all 12 captures were rendered in the run.
- GREEN — `pnpm exec eslint` over changed source and capture test files; `git diff --check`; checkpoint index parses and contains exactly 12 `checkpoint-a-*` entries.
- CONCERN — `pnpm --filter @lexon/frontend typecheck` fails only at the known Task 5 issue `frontend/src/components/organizations/workspace.tsx:22`: `displayName` is not a `ThreadProps` property. This predates Task 3 and is explicitly owned by Task 5.
- CONCERN — `pnpm --filter @lexon/frontend build` compiles successfully, then fails in its TypeScript phase on the same Task 5 `displayName`/`ThreadProps` mismatch.

## Compose checkpoint A

Exact command for the main agent to render/review the current checkpoints and complete the flow:

```sh
LEXON_VISUAL_DEV=1 pnpm test:e2e -- --project visual-review
```

Output: 4 passed in 28.6 seconds. The separate existing F1 signup run was `LEXON_VISUAL_DEV=1 pnpm test:e2e -- --project identity-browser --grep 'entry signup verifies email before authenticated continuation'`; it fails on the expected “Check your email” heading because the dev HMR WebSocket handshake errors prevent the browser-side submit flow.

The successful portion rendered these 8 files through the real Compose stack at deviceScaleFactor 1; dimensions were verified with `file`:

- `docs/references/F2.1-visual/checkpoints/a-sign-in-{desktop,mobile}-{light,dark}.png`
- `docs/references/F2.1-visual/checkpoints/a-sign-up-{desktop,mobile}-{light,dark}.png`

Desktop images are 1440×900; mobile images are 390×844. All 12 stable overwrite paths are indexed in `docs/references/F2.1-visual/index.json`. Screenshots are captured only after route response, actual theme application, loaded Inter, decoded visible logo, and visible heading checks.

The onboarding checkpoint uses a real API-authenticated incomplete identity: `authenticateApi(page.request)` creates the user through sign-up, consumes the captured verification email, and signs in through the real endpoints; the test then uses `PATCH /api/identity/profile` to set a display name and visits the guarded `/onboarding` route. It leaves onboarding incomplete and does not fake session state, bypass SQL/guards, or submit the onboarding completion endpoint.

Signup remains an open dev-preview integration finding. In a fresh normal-load `/sign-up`, JS chunks completed with 200/304, with no page errors, failed HTTP requests, or validation errors. Clicking Create account yielded no auth API response and the document navigated with method `GET`, path `/sign-up`, and query-key names `name`, `email`, `password`; no values were collected. Sanitized console errors identify Next dev HMR WebSocket handshakes failing with `ERR_INVALID_HTTP_RESPONSE`. The form then rendered empty. The existing F1 `entry signup verifies email before authenticated continuation` test was rerun unchanged in the same visual-dev Compose target and fails at “Check your email”. No submission/authentication/security logic was changed. This remains for main adjudication and normal production-build verification after Task 5 restores the full build. The temporary diagnostic test has been removed; the existing F1 regression test remains intact.

Temporary real-render review coverage for other affected auth pages is the `secondary account flows render inside the shared auth frame` test in `backend/test/e2e/visual-rework.spec.ts`; it covers the six routes above without recording secrets. The auth boundary test in that file checks 1023/1024.

## Research notes

- Lexon approved design source: `docs/specs/LEXON-03-DESIGN-SYSTEM.md`, v2.0, read 2026-11-03; establishes the accepted brand frame, typography, color, and responsive constraints.
- shadcn authentication blocks: https://ui.shadcn.com/blocks/authentication and https://ui.shadcn.com/blocks/signup, checked 2026-11-03 against pinned shadcn CLI 4.23.0; used login-02/signup-02 form hierarchy and removed social providers per brief.
- shadcn Field: https://ui.shadcn.com/docs/components/aria/field, checked 2026-11-03; supports published Field, FieldGroup, FieldDescription structure used for form labels, submit, and account links.
- Next `devIndicators`: https://nextjs.org/docs/pages/api-reference/config/next-config-js/devIndicators, checked 2026-11-03 against installed Next 16.4.3; supports disabling the dev badge for test screenshots while retaining build/runtime overlays.
- React Rules of Hooks: https://react.dev/reference/rules/rules-of-hooks, checked 2026-11-03 against React 19.3.1; optional sidebar state is bridged through a normal hook call in a provider child, not a hook inside try/catch.
- Next server/client context guidance: https://nextjs.org/docs/app/getting-started/server-and-client-components#context-providers, checked 2026-11-03 against Next 16.4.3; `AuthFrame` stays server-compatible and does not introduce a React context provider.
- Tailwind PostCSS: https://tailwindcss.com/docs/installation/framework-guides/nextjs and Vite shared PostCSS option https://vite.dev/config/shared-options.html#css-postcss, checked 2026-11-03; supports the minimal shared config shape change needed to load generated CSS in Vitest.
- `tw-animate-css@1.4.0`: official package metadata checked 2026-11-03 (`MIT`, repository `https://github.com/Wombosvideo/tw-animate-css.git`); pinned directly because the kept generated UI stylesheet imports it.

## Deviations / review state

| Item | State | Reason |
| --- | --- | --- |
| 12 required Checkpoint A PNGs and `index.json` entries | Complete: 12 of 12 rendered and indexed | Onboarding uses the real API-authenticated incomplete account fixture described above. |
| Main side-by-side visual comparison | Pending | Main must render and compare actual checkpoint PNGs before acceptance. |
| Real browser signup through visual-dev | Fails in dev preview | Existing F1 browser regression fails after native GET; sanitized console shows Next HMR WebSocket handshake failures. Preserve behavior and verify through normal production build when Task 5 resolves the current full-build type error. |
| Full build | Compiles, then fails during TypeScript | The only reported failure is the known Task 5 `displayName`/`ThreadProps` mismatch; production runtime public-asset packaging remains tracked outside this task. |
| Full TypeScript check | Fails on known Task 5 `displayName`/`ThreadProps` mismatch only | Out of Task 3 scope. |

No sample routes or generated reference assets were edited. No push was performed.
