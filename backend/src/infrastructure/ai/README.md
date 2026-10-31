# AI compatibility boundary

Only this infrastructure folder imports the AI SDK, OpenRouter or MCP client.
Its public index exports the Nest module only. The lint boundary rejects deep
imports of the raw provider constructor from runtime/domain code. The module
constructs adapters without opening a network connection and exports no raw
provider. AI infrastructure is registered only in the AI worker root.

F0 has no production model selection or execution surface. The reviewed
allowlist is `{version:1,models:[]}`. Each later entry must identify a model,
provider, processing region, literal `zeroDataRetention:true`, and an ISO
review timestamp. Model-provider pairs are unique. Region is retained as input
to the cross-border processing review. Adding an entry is a reviewed config
change; F3 must enforce the allowlist and explicit provider preferences on each
request. Test-only IDs never enter this configuration.

AI SDK 7.0.159 uses the v4 mock model stream contract. OpenRouter 3.1.0
constructs a v4 model with injected fetch; the proof emits Hello world from a
mock without a provider request. MCP client/server 2.4.0 negotiates protocol
2026-07-28, discovers and calls a harmless tool through createMcpHandler.fetch
in-process. An unexpected global fetch fails the test. Both sides close at
teardown; no port, real model key or remote server is needed.
