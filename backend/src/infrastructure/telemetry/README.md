# Telemetry boundary

Each runtime uses `TelemetryModule.forRuntime(runtime)` and attaches the Nest Pino logger at bootstrap. HTTP request IDs are propagated only when bounded and identifier-shaped; otherwise a fresh UUID replaces them.

Logging uses two layers: Pino's explicit redaction paths and an operational-field allowlist. Arbitrary payloads, headers, URLs, nested objects and free-form log messages are not retained. Errors expose only their type. Use fixed `event` codes with safe IDs and numeric timings; never interpolate prompts, document text, credentials or provider errors into logs. Boot failures may list configuration field names, never supplied values. Register a new event code deliberately when adding a runtime behavior.

Worker health uses a file on writable tmpfs, defaulting to
`/run/lexon/health/status.json`. Boot validates the configurable write interval
(default 5000ms), staleness threshold (20000ms) and dependency deadline (2000ms).
The threshold must exceed the normal write/check cycle. Compose supplies the
writable mount, so this remains compatible with a read-only root filesystem.

Snapshots contain only active/standby/unhealthy status, liveness/readiness,
a timestamp and allowlisted dependency names/statuses. Writes use a unique
same-directory 0600 temporary file and atomic rename. Cycles do not overlap.
A failed sample or write marks internal writer health down and attempts file
invalidation; if that also fails, the old snapshot expires at the configured
staleness threshold. Late writes after shutdown are invalidated. A health
timer never advances the owning work-loop heartbeat.

`node backend/dist/bootstrap/health-check.js --mode readiness` checks the file
without booting Nest or reading infrastructure settings. Liveness mode is
independently available. Missing, malformed, stale (`age >= threshold`) and
future-dated files (more than 1000ms ahead) fail silently. A dependency failure
can be live while unready. Standby is ready when its dependencies are up.
Detection of an event-loop stall or an unwritable/invalidation-resistant file
is bounded by the last successful snapshot plus staleness and the external
probe interval. External telemetry export belongs to F20.
