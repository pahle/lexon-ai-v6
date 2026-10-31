# F0 version ledger

Read: 2026-10-31. Exact releases selected from official npm metadata; no installed compatibility claim before execution.

Node 24.22.1 and pnpm 10.33.1 match the available local tools. Node satisfies the Nest 12 schematics 24.15+ floor. All pnpm settings use workspace YAML.

Scaffolds: Nest CLI 12.0.11 (ESM, no Observe) and assistant-ui 0.0.127 default release (skip install, no skills). Template product sources, Observe instructions, Supertest and provider code were removed. TypeScript 7 / oxlint / oxfmt were replaced.

| Package                    | Exact version | Source                                                                               |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `@ai-sdk/react`            | `4.0.163`     | [Official registry](https://www.npmjs.com/package/@ai-sdk/react/v/4.0.163)           |
| `@assistant-ui/ai-sdk`     | `0.0.16`      | [Official registry](https://www.npmjs.com/package/@assistant-ui/ai-sdk/v/0.0.16)     |
| `@assistant-ui/react`      | `0.15.32`     | [Official registry](https://www.npmjs.com/package/@assistant-ui/react/v/0.15.32)     |
| `@base-ui/react`           | `1.9.0`       | [Official registry](https://www.npmjs.com/package/@base-ui/react/v/1.9.0)            |
| `@eslint/js`               | `10.0.1`      | [Official registry](https://www.npmjs.com/package/@eslint/js/v/10.0.1)               |
| `@hookform/resolvers`      | `6.0.2`       | [Official registry](https://www.npmjs.com/package/@hookform/resolvers/v/6.0.2)       |
| `@nestjs/cli`              | `12.0.11`     | [Official registry](https://www.npmjs.com/package/@nestjs/cli/v/12.0.11)             |
| `@nestjs/common`           | `12.3.2`      | [Official registry](https://www.npmjs.com/package/@nestjs/common/v/12.3.2)           |
| `@nestjs/core`             | `12.3.2`      | [Official registry](https://www.npmjs.com/package/@nestjs/core/v/12.3.2)             |
| `@nestjs/platform-express` | `12.3.2`      | [Official registry](https://www.npmjs.com/package/@nestjs/platform-express/v/12.3.2) |
| `@nestjs/schematics`       | `12.0.12`     | [Official registry](https://www.npmjs.com/package/@nestjs/schematics/v/12.0.12)      |
| `@nestjs/testing`          | `12.3.2`      | [Official registry](https://www.npmjs.com/package/@nestjs/testing/v/12.3.2)          |
| `@tailwindcss/postcss`     | `4.3.3`       | [Official registry](https://www.npmjs.com/package/@tailwindcss/postcss/v/4.3.3)      |
| `@tanstack/react-query`    | `5.105.0`     | [Official registry](https://www.npmjs.com/package/@tanstack/react-query/v/5.105.0)   |
| `@types/express`           | `5.0.6`       | [Official registry](https://www.npmjs.com/package/@types/express/v/5.0.6)            |
| `@types/node`              | `24.19.2`     | [Official registry](https://www.npmjs.com/package/@types/node/v/24.19.2)             |
| `@types/react`             | `19.3.0`      | [Official registry](https://www.npmjs.com/package/@types/react/v/19.3.0)             |
| `@types/react-dom`         | `19.3.0`      | [Official registry](https://www.npmjs.com/package/@types/react-dom/v/19.3.0)         |
| `ai`                       | `7.0.159`     | [Official registry](https://www.npmjs.com/package/ai/v/7.0.159)                      |
| `eslint`                   | `10.14.0`     | [Official registry](https://www.npmjs.com/package/eslint/v/10.14.0)                  |
| `eslint-config-prettier`   | `10.1.8`      | [Official registry](https://www.npmjs.com/package/eslint-config-prettier/v/10.1.8)   |
| `globals`                  | `17.13.0`     | [Official registry](https://www.npmjs.com/package/globals/v/17.13.0)                 |
| `jsdom`                    | `30.1.3`      | [Official registry](https://www.npmjs.com/package/jsdom/v/30.1.3)                    |
| `lucide-react`             | `1.66.0`      | [Official registry](https://www.npmjs.com/package/lucide-react/v/1.66.0)             |
| `next`                     | `16.4.3`      | [Official registry](https://www.npmjs.com/package/next/v/16.4.3)                     |
| `prettier`                 | `3.9.10`      | [Official registry](https://www.npmjs.com/package/prettier/v/3.9.10)                 |
| `react`                    | `19.3.1`      | [Official registry](https://www.npmjs.com/package/react/v/19.3.1)                    |
| `react-dom`                | `19.3.1`      | [Official registry](https://www.npmjs.com/package/react-dom/v/19.3.1)                |
| `react-hook-form`          | `7.91.0`      | [Official registry](https://www.npmjs.com/package/react-hook-form/v/7.91.0)          |
| `reflect-metadata`         | `0.2.2`       | [Official registry](https://www.npmjs.com/package/reflect-metadata/v/0.2.2)          |
| `rxjs`                     | `7.8.2`       | [Official registry](https://www.npmjs.com/package/rxjs/v/7.8.2)                      |
| `tailwindcss`              | `4.3.3`       | [Official registry](https://www.npmjs.com/package/tailwindcss/v/4.3.3)               |
| `typescript`               | `6.0.3`       | [Official registry](https://www.npmjs.com/package/typescript/v/6.0.3)                |
| `typescript-eslint`        | `8.72.1`      | [Official registry](https://www.npmjs.com/package/typescript-eslint/v/8.72.1)        |
| `vite`                     | `8.3.5`       | [Official registry](https://www.npmjs.com/package/vite/v/8.3.5)                      |
| `vitest`                   | `5.0.5`       | [Official registry](https://www.npmjs.com/package/vitest/v/5.0.5)                    |
| `zod`                      | `4.6.7`       | [Official registry](https://www.npmjs.com/package/zod/v/4.6.7)                       |

Peer checks: Nest 12 packages agree on ^12; TypeScript ESLint accepts >=4.8.4 <6.1; assistant-ui accepts React 19; adapter accepts ai ^7.0.101; AI SDK React accepts React ^19.2.1. Image pins arrive with Task 5.

Vitest 5.0.5 / Vite 8.3.5 natively emit the decorator metadata from the Nest TypeScript config. The real Nest DI characterization test passes without an added SWC plugin; no unused transformer dependency is retained.

Task 4 exact pins: @nestjs/config 12.0.1; nestjs-pino 5.3.1; pino 10.4.0; pino-http 11.0.0. Official package metadata on 2026-10-31 confirms Nest12 peers and the Pino10/pino-http11 peer pair.

Task 5 pins: testcontainers/@testcontainers/postgresql 12.2.1, pg/@types/pg 8.23.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, ioredis 6.0.0, AWS S3 client/presigner 3.1161.0. Registry peer metadata verified on 2026-10-31. Container tags/digests verified through official Docker Hub manifests and pulled successfully: PostgreSQL 17.11-bookworm, Valkey 9.0.7-alpine3.24, SeaweedFS 4.51; Node 24.22.1-bookworm-slim is pinned in the same manifest.

Task 8 pins (2026-10-31): bullmq 6.5.3 and @nestjs/bullmq 12.0.0. Published peers explicitly accept BullMQ ^6 and Nest ^12; strict-peer install passed with ioredis 6.0.0. Native Processor/WorkerHost registration and real stalled-job recovery passed.

Task 10 reverified AWS SDK client-s3/s3-request-presigner 3.1161.0 APIs and SeaweedFS 4.51 contract on 2026-10-31; no version change.
