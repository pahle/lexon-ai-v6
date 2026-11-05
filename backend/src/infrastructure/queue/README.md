# Queue transport

The producer routes to `ai-interactive` or `ai-batch` using the queue and
priority persisted on the claimed outbox row. It always sets `jobId = outboxId`.
Short-transaction handlers use the platform `JobExecutor` and its supplied
tenant transaction; durable-step handlers run outside that receipt transaction
and receive an abort signal plus an owner-fenced organization permit. A retained
BullMQ ID suppresses another insertion, but removing a completed job permits
redelivery: PostgreSQL receipts protect short-transaction effects, while durable
step claims and fences protect run progression.

The native `@nestjs/bullmq` 12.0.0 `Processor` / `WorkerHost` integration is
verified with BullMQ 6.5.3 and NestJS 12.3.2. The fallback is unnecessary.
Only worker application contexts register processors. Producer-only modules
never instantiate a worker. Worker connections use `maxRetriesPerRequest:null`;
producer requests have a bounded enqueue deadline. A timeout can leave an
uncertain insertion outcome, so the dispatcher must retry the same outbox ID.
Use BullMQ's `prefix`, never an ioredis `keyPrefix`.

Interactive and batch workers have separate concurrency settings. Durable jobs
must acquire one of two per-organization permits before their handler runs. The
two permit keys live under the configured limiter prefix and expire at the step
lease duration; workers renew only their own token and abort the handler after
ownership loss. A busy result moves the BullMQ delivery to its delayed set with
`DelayedError`, without spending a failure attempt. PostgreSQL serializes claim
and renewal transactions per organization and counts live step leases as a
second admission fence.

Jobs get three attempts with exponential backoff starting at 250ms. Completed
jobs retain for at most 86400 seconds / 1000 entries; failed jobs retain for
604800 seconds / 5000 entries. BullMQ applies age/count cleanup lazily as jobs
finish. Receipt retention is independent of queue retention.

Queue, Streams and limiter URLs are configured separately. Every distinct URL
is checked for PONG, `noeviction`, AOF enabled and `appendfsync everysec`.
A failed check returns only dependency status. Worker failures stored in the
queue use a fixed message rather than handler error details.

The process fixtures compile with the same TypeScript configuration in global
setup. Their IPC barriers pause inside the handler before commit, or after the
executor commits before the BullMQ processor resolves. Tests SIGKILL that child,
confirm its exit, and wait for a replacement process to receive the stalled job.
No production failpoint exists. Outage tests affect a private TCP proxy only.
