# F4 Task 18 — local S2 load evidence

Date: 2026-11-14. Status: local implementation and measurement captured; main
review is approved; exact-final-head Linux CI remains pending. This is not
Task 18 acceptance or F4 completion.

## Scope and preserved limits

The isolated `chat-sse-load` project opts in explicitly. It uses two owners in
separate organizations, 250 authenticated native k6 HTTP subscribers per owner,
two held mock runs, a per-user SSE cap of 256 for this run only, API limits of
1 CPU/1536 MiB, and k6 limits of 2 CPU/2048 MiB. F3 run caps remain 24 globally
and 6 per organization. A separate real default-six qualification verifies
that connection seven evicts only the oldest socket. Normal E2E remains on the
standard path. No SSE extension, RLS bypass, public diagnostic endpoint, paid
model call, or exemption was introduced.

The test-only control uses a private Unix socket. The measured request stream
uses the real authenticated API and Caddy path. The collector exports allowlisted
aggregates only; it rejects incomplete measurements and unknown fields. Compose
was invoked with `COMPOSE_DISABLE_ENV_FILE=true`; no `.env` file was opened or
copied.

## Local measurement

The final local invocation was `env COMPOSE_DISABLE_ENV_FILE=true pnpm
test:load:chat`, exit 0 in 173.715 seconds. Its output SHA-256 is
`dfcfbd8bc99b91769115c9377e91600f3dea4eebbee25abc4f04fd4b6a9bf13e`. The
integration test SHA-256 recorded by the controller is
`6bf27341c604705bef6da2b4c1ed4665c1833e13d5bbeb71bd660ab4e24270ca`.

All 29 plateau samples span 32.550 seconds. Every sample observed 500 live hub
subscriptions, 500 leases, and 500 reader subscriptions. The idle reader
baseline was one connection, one live subscriber used two, the 500-subscriber
plateau stayed at two, and teardown returned to one. All observed API RSS
samples peaked at 266.738 MiB against the 1536 MiB limit; k6 cgroup memory
peaked at 132.121 MiB against 2048 MiB. All 500 k6 requests completed with HTTP
200, zero errors, no reconnects, and one request per VU. The minimum observed
request duration was 38.525 seconds. Both mock-run stream entry counts advanced
from 3 to 6; these values are Redis stream entry counts, not durable step
sequence numbers.

Send-to-first-visible-answer-frame latency includes text-delta and text snapshot
frames, measured from before POST. The cold sample was 2136.85 ms; three warm
samples were 377.98, 972.22, and 945.98 ms. Across the four samples, median was
959.10 ms and p95/max were 2136.85 ms. These are descriptive measurements with
no latency gate.

The local environment was Darwin ARM64 with Docker 29.3.1, an aarch64 engine,
10 CPUs, and 8217059328 bytes reported to the VM. Source provenance identifies
head `267f24cde56cac1a96ab2de5fd02051e256522e6` and `sourceDirty: true`. The API
image reference contains a local image-configuration digest, not a registry
pull digest. k6 was pinned to the approved official
`grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8`.
Thus this is successful local evidence, not final clean Linux CI evidence.

The safe [load](F4-sse-load.json) and
[latency](F4-stream-latency.json) JSON files were canonicalized with the
repository formatter. Their parsed values remain identical to the original raw
captures, whose SHA-256 hashes were
`77987653affdee9e4112c7f7a6b75a2693d1fafda77abd5da8fd254fee384dc0` and
`1259db5e6d0c4460a74ba42bb35005f21d5e9b55655b0dd5c351e0808310f7ea`. The
canonical public files now hash to
`bc9883997a2c9f8b27555cbc3664233a418a6ba11ca4e098a08243071b65d0fa` and
`656b6dea99bbd5dbb82b80f82b8d4b3d61abd2e6bae3fd714d368cef739d622a`,
respectively.

## Failed attempts and corrections

The first real load ran with the production default of six and failed its
required 500-subscriber assertion at 12 live subscriptions. With the approved
isolated cap of 256, an early attempt observed only 262 at the 20-second
admission check; its complete first diagnostic was not retained. Diagnostic
attempt 2 observed 306 live subscriptions and 194
revoked connections; all 500 requests had started, with successful HTTP status
classes and no container OOM or restart. Diagnostic attempt 3 observed 264 live
subscriptions and 236 revoked sockets. Renewal was missing for 118 sockets per
owner, while authentication, ownership, snapshot, and tenant-transaction error
counters remained zero. This isolated the lease-heartbeat gap; it did not
justify a resource, timeout, cap, or authorization change.

The lease regression tests first failed on existing behavior: zero successful
renewals while subscription setup was held (expected at least two), and zero
additional renewals while tenant I/O was held before the real
`TenantDatabase.withTenant` method (expected at least three). The public-method
gate waits before delegating, so no tenant transaction is acquired or held.
The prior full SSE integration run passed 19/19 in 61.436 seconds (log SHA-256
`113e8a971ef7ab2d31245a4a150f38df80122e2bbe427f486d9a3fa4553d7443`); that run
used an earlier test-only gate. The latest public-gate fixture reproduced both
business RED assertions (frozen test SHA-256
`e3bf837df1ed2544bef48bec3646e11e0e453abcfff73e7443e2d50a64f9ca23`, RED log
SHA-256
`a12b4a8bb3f5708df8075e301433e773f034949579cd9a29db33c6774cbc1c9d`). The final full regression includes both current regression cases and passed
all 1,367 tests across 198 files (217.953 seconds; log SHA-256
`c0a167585708987647f7c0eb6477eefc5756365687ee667603bcb6e9bd536a68`).

Attempt 4 passed the native k6 request and plateau checks but failed teardown:
the fixture expected two idle reader connections, while the actual reader
settled at one. The existing reader intentionally disconnects its idle blocking
connection while replay is retained. No production reader behavior was changed.
The warm-baseline fixture was corrected to the observed one-connection idle
state; the one-subscriber/plateau count remains two and teardown must return to
one. Attempt 5 then passed the complete evidence validator.

## Verification and remaining gates

The required test-first REDs were assertion failures against existing behavior.
The first unchanged default-six load failed the 500-subscriber assertion at 12
live subscriptions (SSE test SHA-256
`8af96b5f816c7b1245b791fc3bf99795dbfd61d4e3cbc3007cc546476aa86893`; log
SHA-256 `2bc37b8e57bccce203b170f7688fc9e2e0c6888a7728479788cda1c9bbeb52a86`).
The latest public-method gate RED reproduced zero renewal during held
subscription setup (expected at least two) and zero further renewal while
`TenantDatabase.withTenant` dispatch was held before the original method
(expected at least three); no transaction was acquired during the gate. Frozen
test SHA-256 `e3bf837df1ed2544bef48bec3646e11e0e453abcfff73e7443e2d50a64f9ca23`,
controller RED log SHA-256
`a12b4a8bb3f5708df8075e301433e773f034949579cd9a29db33c6774cbc1c9d`. The
load-path suite also had a pre-fix assertion RED for uncovered load config paths
and the missing diagnostic artifact path (frozen test SHA-256
`c157a4d885a82acbe2832b79b4de3973780eaa5d372ea6f377bb5e3ec2f8eb28`, log
SHA-256 `9ea79715c4c83217eb429fb5e726844b80c95ec455c892d9ad1709f67efecd3c`).

The idle-reader correction had its own genuine validator RED: seven positive
valid-baseline cases were rejected while 42 negative cases still passed (frozen
test SHA-256
`8e83009fbdfa5830190f92d841b5f5789e28ab586014aa38a3de3c30b1185786`, log SHA-256
`eacda5a8bcdeec877539eeaaf219db6c040cb70226d371221e4d0f4fe9abd145`). The
validator was then changed to compare active reader counts to the two-connection
one-subscriber baseline and teardown exactly to the one-connection idle baseline.
This corrected an over-constrained fixture; it did not relax the one-subscriber
growth or return-to-baseline requirements.

Final controller verification passed: 258/258 Node tooling tests, 1,367/1,367
workspace tests across 198 files, workspace typecheck, workspace build,
format:check, and lint (including all 99 boundary fixtures). The final full-test
log SHA-256 is
`c0a167585708987647f7c0eb6477eefc5756365687ee667603bcb6e9bd536a68`;
the run took 217.953 seconds and preserved the frozen test source. Independent spec/quality review approved the complete Task 18 change with no
Critical or Important findings; exact-final-head Linux verification remains pending.

The unchanged normal Compose E2E layer passed in CI run
[43504282456](https://github.com/pahle/lexon-ai-v6/actions/runs/43504282456);
that run's unit layer had two timing assertion failures. The focused unchanged
local cases subsequently passed, but the run is not represented as full CI
success.

Independent spec/quality review approved implementation `664a45c` with no
Critical or Important findings. The load workflow on the exact clean final
source head under Linux remains open. Task 21 must run the required final head gates, including manual dispatch
of this load layer. Task 20 golden locking remains deferred to F4.1.
