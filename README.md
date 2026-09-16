# Agent Mandate MCP

Verification-only MCP server exposing one tool: `verify_action`.

The tool sends caller-supplied mandate and action facts to Agent Mandate's
`POST /v1/verify` endpoint and returns its `allow`, `deny`, or
`requires_approval` receipts. It does not issue or revoke mandates, execute an
action, change an account, or call billing. It makes at most one API request per
tool call and never retries automatically.

Status: **public source; npm package and Official MCP Registry release
pending**. The repository link below is live. The npm and Registry identities
become available only after their separate public releases:

- npm: `@api-disk-integrations/agent-mandate-mcp@0.1.1`
- Official MCP Registry: `io.github.API-Disk-Integrations/agent-mandate@0.1.1`
- source: `API-Disk-Integrations/agent-mandate-mcp`

## Install and run

After the exact package version is publicly published and independently read
back, run it with the version pinned:

```bash
AGENT_MANDATE_API_KEY="$AGENT_MANDATE_API_KEY" \
  npx --yes @api-disk-integrations/agent-mandate-mcp@0.1.1
```

Do not commit a literal credential. A generic stdio client configuration is:

```json
{
  "mcpServers": {
    "agent-mandate": {
      "command": "npx",
      "args": ["--yes", "@api-disk-integrations/agent-mandate-mcp@0.1.1"],
      "env": {
        "AGENT_MANDATE_API_KEY": "${AGENT_MANDATE_API_KEY}"
      }
    }
  }
}
```

`${AGENT_MANDATE_API_KEY}` denotes the host's secret/environment reference.
Use the client host's documented secret facility if its interpolation syntax
differs. The package uses stdio and reads exactly that environment variable;
it has no remote `/mcp` endpoint.

## Check whether an agent action exceeds its signed mandate

The complete first use, in two calls. Every command below was run against
production on 2026-09-15 and the decision shown is the decision returned.

**Step 1 — create a mandate.** This returns the *signed envelope*. The tool needs
this envelope, not the bare claims you send here.

```sh
curl -X POST https://agentmandate-api.com/v1/mandates \
  -H "authorization: Bearer $AGENT_MANDATE_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "principal": "user_8814",
    "agent": "agent_procurement_v3",
    "expiresAt": "2026-12-31T23:59:59Z",
    "currency": "USD",
    "totalSpendCapMinor": 500000,
    "grants": [{
      "action": "payments.transfer",
      "resources": ["vendor.acme"],
      "maxAmountMinor": 100000,
      "approvalRequiredAboveMinor": 25000
    }]
  }'
```

Answers `201` with `{"mandate": {…}, "signature": "…", "requestId": "…"}`.
**That whole response body is the envelope.** Pass it through unchanged.

**Step 2 — verify an action against it.** Call `verify_action` with the envelope as
`mandate`:

```json
{
  "mandate": { "mandate": { "…": "…" }, "signature": "…" },
  "action": {
    "agent": "agent_procurement_v3",
    "action": "payments.transfer",
    "resource": "vendor.acme",
    "amountMinor": 30000,
    "currency": "USD"
  }
}
```

The grant allows up to 100000 minor units but requires approval above 25000, and the
action asks for 30000. So the correct answer is **`requires_approval`**, with the
violation `Actions above 25000 minor units need a human approval token.`

**A `deny` or `requires_approval` is a correct result, not a failure.** The point of
the tool is that it says no when the mandate says no.

### If you get HTTP 400

`"mandate.mandate" must be the claims object` means bare claims were passed where the
envelope belongs. The keyless demo route `POST /v1/demo/verify` takes bare claims and
needs no key, which is why the shapes differ. Run step 1 and pass its whole response.

### Try it with no key at all

```sh
curl -X POST https://agentmandate-api.com/v1/demo/verify \
  -H 'content-type: application/json' \
  -d '{"mandate":{"principal":"user_8814","agent":"a1","expiresAt":"2026-12-31T23:59:59Z","currency":"USD","totalSpendCapMinor":500000,"grants":[{"action":"payments.transfer","resources":["vendor.acme"],"maxAmountMinor":100000,"approvalRequiredAboveMinor":25000}]},"action":{"agent":"a1","action":"payments.transfer","resource":"vendor.acme","amountMinor":30000,"currency":"USD"}}'
```

Note this route takes **bare claims**, not the envelope.

## Tool contract

There is exactly one tool, `verify_action`. Supply either one `action` or an
`actions` array, never both. A batch contains 1–500 actions. Monetary amounts
are non-negative integer minor units and require `currency`.

Example input:

```json
{
  "mandate": {
    "mandate": {"id": "mnd_example"},
    "signature": "caller-supplied-signature"
  },
  "action": {
    "agent": "procurement-agent",
    "action": "payments.transfer",
    "resource": "vendor.acme",
    "amountMinor": 2500,
    "currency": "USD",
    "at": "2026-09-05T20:00:00Z"
  }
}
```

Representative successful structured output:

```json
{
  "count": 1,
  "receipts": [
    {
      "decision": "deny",
      "mandateId": "mnd_example",
      "violations": [{"code": "action_not_granted", "detail": "No matching grant"}]
    }
  ]
}
```

Treat all three decisions literally. In particular, neither `allow` nor
`requires_approval` executes the proposed action.

## Errors, limits, and safety

- If `AGENT_MANDATE_API_KEY` is absent, the tool returns an MCP error before
  making a request.
- A provider error is reduced to its numeric HTTP status and an allowlisted
  code. Provider-controlled message and request-ID text is never returned to
  the model.
- One tool call produces at most one HTTPS request to the fixed
  `https://agentmandate-api.com/v1/verify` endpoint. There is no automatic
  retry; Fetch uses explicit `redirect: error`, and redirect responses are
  rejected without a follow-up request.
- The serialized UTF-8 request and decoded response body each have a hard
  1 MiB (1,048,576-byte) limit. The request is measured before Fetch. The
  response is counted while streaming before JSON parsing, regardless of a
  missing, misleading, or chunked `Content-Length` representation.
- The request timeout defaults to 30 seconds. A batch is also limited to 500
  actions. Provider account rate and monthly usage limits still apply; consult
  the current product pricing and documentation before production use.
- The server is read-only with respect to mandate, account, and billing state,
  but an API verification consumes the caller's metered allowance.
- Node.js 20 or newer is required. This release is tested for MCP protocol
  revision `2026-07-28` and retains the SDK's listed 2025 compatibility
  revisions.

## Links

- [Product, pricing, privacy, and terms](https://agentmandate-api.com/)
- [Developer documentation](https://agentmandate-api.com/docs)
- [OpenAPI reference](https://agentmandate-api.com/openapi.json)
- [Service status](https://agentmandate-api.com/status)
- [Source repository](https://github.com/API-Disk-Integrations/agent-mandate-mcp)
- [Issue support](https://github.com/API-Disk-Integrations/agent-mandate-mcp/issues)
- [Security reporting](https://github.com/API-Disk-Integrations/agent-mandate-mcp/security/advisories/new)
- [MIT license](./LICENSE)
- [Threat model](./THREAT_MODEL.md)

The source link is not evidence that the npm package or Registry listing is
available. Those two releases require their own public readback. A clone,
install, download, tool call, or listing is not evidence of customer activation
or revenue.
