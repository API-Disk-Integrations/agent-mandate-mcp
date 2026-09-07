# Threat model

- Credential disclosure: the key is accepted only through the caller process,
  never as a tool argument. Provider-controlled error messages and request IDs
  are discarded; tests assert the MCP error boundary cannot reflect the key.
- Fail-open decision handling: all three server decisions pass through without
  reinterpretation; transport errors are tool errors, never `allow`.
- Confused deputy: the tool verifies facts but executes nothing and exposes no
  issuance, revocation, billing, or account operation.
- Replay and nondeterminism: callers can supply `at`; this adapter neither
  stores nor silently rewrites it.
- Excessive request/response size: batches are capped at 500, serialized UTF-8
  requests are rejected above 1 MiB before Fetch, and decoded response bytes
  are stream-counted and rejected above 1 MiB before JSON parsing, including
  missing, misleading, and chunked Content-Length cases.
- Unbounded network behavior: one request to the fixed HTTPS Agent Mandate
  endpoint, a 30-second default timeout, explicit Fetch redirect error mode,
  redirect-response rejection, and no automatic retry.
- Data leakage: no operational logging is implemented; MCP output contains only
  the reviewed API response or a bounded safe error.
- Remote multi-tenant credential sharing: remote transport is deliberately
  absent until per-user authentication and secret mapping are designed and
  reviewed.
