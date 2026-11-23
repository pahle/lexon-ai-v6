# Agent skills

Third-party skills vendored from official vendors or core maintainers, read
by Codex from `.agents/skills/`. Claude Code reads the same skills through
relative symlinks in `.claude/skills/` (one per skill; add a symlink when a
skill is vendored). Sources and pinned commits are in
[`skills-lock.json`](skills-lock.json); each skill keeps its upstream license.

## Policy

1. **Sources:** official vendor organizations or core maintainers only. Every
   skill is read before it is added; skills are instructions an agent runs.
2. **Pinned and vendored:** copied at a pinned commit and committed. Updates
   are re-copied from a new commit after reviewing the diff.
3. **Just in time:** skills are added when their slice starts (see each
   brief's "Skills to use"), so agents are not flooded with irrelevant skills.
4. **Advice, not authority:** `AGENTS.md` and `docs/specs/` always win.
   Known conflicts are listed below; follow the Lexon column.

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
| `better-auth-best-practices`, `email-and-password-best-practices`, `organization-best-practices`, `two-factor-authentication-best-practices`, `better-auth-security-best-practices` | better-auth/skills (no license file upstream; vendored by product-owner decision) | F1 |
| `brainstorming`, `diagnosing-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills` | obra/superpowers v7.0.2 (MIT) | All slices: the superpowers workflow (brainstorming → plans → TDD → review) |
| `karpathy-guidelines` | multica-ai/andrej-karpathy-skills (MIT) | All slices: think before coding, simplicity, surgical changes, verifiable goals. Superpowers' workflow and `AGENTS.md` take precedence |

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
| Better Auth skills: `npx auth migrate`/`generate`, `drizzle-kit push`, Prisma/Kysely setups | Schema in the `auth` schema through the Drizzle adapter; versioned SQL migrations run as `lexon_migrator`; never `push` |
| Better Auth skills: `socialProviders`, stateless `cookieCache` mode | No social login or SSO in the MVP; sessions are stored in the database (LEX-ARC-001 §1, §3.2) |
| Better Auth skills: Admin plugin impersonation | Disabled; platform staff never act as users (LEX-ARC-001 §6.2 break-glass) |
| Better Auth skills: `auth` CLI `mcp` setup for editors | Do not modify editor/agent configuration; propose tooling to the human |
| Superpowers skills: `AGENTS.md` and `docs/specs/` versus any skill instruction | `AGENTS.md` and `docs/specs/` take precedence over every skill, including the superpowers workflow skills and `using-superpowers` |
| `finishing-a-development-branch`: merge back to the base branch locally, delete the branch, or discard the work | Never merge, delete, or discard a branch locally. Push the feature branch and open a **draft** PR; the product owner merges (Squash and merge) and deletes the branch |
| `diagnosing-superpowers`: search and file upstream GitHub issues, build and share a session bundle | Never file or comment on upstream issues and never send transcripts, bundles, or other session data outside this repository. Write findings to the workspace and give them to the product owner |
| `dispatching-parallel-agents`, `using-git-worktrees`: parallel agents and new worktrees (for example under `.worktrees/`) | These apply only to subagents inside one implementer session, working in that session's own worktree. Only one implementer session runs at a time; never touch another session's worktree or the shared checkout |
