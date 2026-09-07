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

- npm: `@api-disk-integrations/agent-mandate-mcp@0.1.0`
- Official MCP Registry: `io.github.API-Disk-Integrations/agent-mandate@0.1.0`
- source: `API-Disk-Integrations/agent-mandate-mcp`

## Install and run

After the exact package version is publicly published and independently read
back, run it with the version pinned:

```bash
AGENT_MANDATE_API_KEY="$AGENT_MANDATE_API_KEY" \
  npx --yes @api-disk-integrations/agent-mandate-mcp@0.1.0
```

Do not commit a literal credential. A generic stdio client configuration is:

```json
{
  "mcpServers": {
    "agent-mandate": {
      "command": "npx",
      "args": ["--yes", "@api-disk-integrations/agent-mandate-mcp@0.1.0"],
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
