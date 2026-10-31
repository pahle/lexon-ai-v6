# Telemetry boundary

Each runtime uses `TelemetryModule.forRuntime(runtime)` and attaches the Nest Pino logger at bootstrap. HTTP request IDs are propagated only when bounded and identifier-shaped; otherwise a fresh UUID replaces them.

Logging uses two layers: Pino's explicit redaction paths and an operational-field allowlist. Arbitrary payloads, headers, URLs, nested objects and free-form log messages are not retained. Errors expose only their type. Use fixed `event` codes with safe IDs and numeric timings; never interpolate prompts, document text, credentials or provider errors into logs. Boot failures may list configuration field names, never supplied values. Register a new event code deliberately when adding a runtime behavior.

Health indicators and the tmpfs snapshot adapter are added with their owning task. External telemetry export belongs to F20.
