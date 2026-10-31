# Agent skills

Third-party skills vendored from official vendors or core maintainers, read
by Codex from `.agents/skills/`. Sources and pinned commits are in
[`skills-lock.json`](skills-lock.json); each skill keeps its upstream license.

## Policy

1. **Sources:** official vendor organizations or core maintainers only. Every
   skill is read before it is added; skills are instructions an agent runs.
2. **Pinned and vendored:** copied at a pinned commit and committed. Updates
   are re-copied from a new commit after reviewing the diff.
3. **Just in time:** skills are added when their slice starts (see each
   brief's "Skills to use"), so agents are not flooded with irrelevant skills.
4. **Advice, not authority:** `docs/specs/` always wins. Known conflicts are
   listed below; follow the Lexon column.

## Installed

| Skill | Upstream | Added for |
|---|---|---|
| `ai-sdk` | vercel/ai | F0, F3 |
| `assistant-ui`, `setup`, `runtime` | assistant-ui/skills | F0, F4 |
| `shadcn` | shadcn-ui/ui | F0, F2 |
| `playwright-cli` | microsoft/playwright-cli | F0 (E2E) |
| `docker-compose-patterns`, `docker-build-strategies` | docker/skills | F0, F20 |
| `valkey` | valkey-io/valkey-skills | F0, F3 |
| `vitest`, `pnpm` | antfu/skills | F0 |

## Known conflicts with Lexon documents

| Skill says | Lexon rule |
|---|---|
| `ai-sdk`: start with the Vercel AI Gateway (`AI_GATEWAY_API_KEY`) | Models only through OpenRouter via `@openrouter/ai-sdk-provider`, with the reviewed allowlist (LEX-ARC-001 §6.2). No AI Gateway |
| `ai-sdk`, `setup`: stream from a Next.js `app/api/chat` route | The frontend never calls models. Generation runs in the AI Worker and reaches the browser via Valkey Streams → SSE on the Backend API (LEX-ARC-001 §4.1, §4.7) |
| `setup`: Assistant Cloud, LangGraph, Mastra, and other hosted runtimes | Not used. assistant-ui connects to Lexon's own `ChatTransport` (LEX-ARC-001 §4.1) |
| `shadcn`: Radix-based styles | Style `base-nova` (Base UI) only (LEX-TS-001 §3) |
| `vitest`, `pnpm`: Vite/Nuxt-oriented examples; `curl … \| sh` pnpm install | NestJS + Next.js workspace; install pnpm via Corepack or the pinned version, never piped shell scripts |
| `docker-*`: generic Compose and Dockerfile layouts | Networks, targets, limits, and pinning per LEX-ARC-001 §2.2, §3.6, §5.3 and LEX-TS-001 §7 |
| `valkey`: cluster, eviction, and caching patterns | Single instance, `noeviction`, AOF `everysec`, per-use connections (LEX-ARC-001 §5.4) |
