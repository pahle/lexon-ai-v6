# Frontend foundation

F0 provides backend health/version and a UUID validation form. Browser calls
use same-origin `/api`; Next rewrites forward to `BACKEND_INTERNAL_URL`
(default `http://localhost:3001`). Server Components use that internal HTTP
origin with a one-second deadline. Rendering waits for a request, so builds
need no running backend. Connection failure produces a usable unavailable
state. The frontend has no database, Valkey, S3 or model credentials.

React Hook Form uses the shared diagnostic Zod schema through the Zod
resolver. The fetch client validates shared responses and maps backend errors
to fixed English messages. It never displays arbitrary backend error text.
TanStack Query owns the browser health query; Base UI supplies form controls.
The minimal neutral foundation page is not the F2 workspace/design system.

The original scaffold's TypeScript 7 and oxlint/oxfmt settings were replaced
with TypeScript 6 and ESLint/Prettier per LEX-TS-001 §2/§7. Turbopack uses
extensionless TypeScript imports in this Bundler-mode package. Node packages
continue to use explicit emitted `.js` imports.

Keep `components.json` at `base-nova` with the style-aware `@assistant-ui`
registry. Exact assistant-ui/AI SDK client packages remain pinned for F4.
The compatibility test creates a supported local runtime, renders a
state-reading child, and proves idle state with zero adapter/network calls.
The application itself mounts no assistant runtime or disconnected chat UI.
There is no `/api/chat` handler or server-side model implementation.
