# Verify a signed agent mandate through MCP

**Check a signed authorization envelope before trusting an agent's claimed authority.**

Agent Mandate's MCP tool accepts the complete `{ mandate, signature }` envelope
returned by `POST /v1/mandates`. **Raw claims are not a signed envelope.**

**The walkthrough:** create an envelope, verify an action through MCP, then change one
signed field and verify again. You see the real verification result for each request,
including the one that gets refused.

**Requirements:** Node.js 20 or newer, and an Agent Mandate API key.

**Getting a key:** the free tier includes **500 verified actions per month** and needs
no card. Issuing mandates is free and never consumes the allowance; one unit is one
action *verified*. Paid plans start at $299/month for 10,000 verified actions. This
walkthrough consumes at most **two** of your free units.

**Running this in production?** [When a signed mandate is and is not worth
it](https://agentmandate-api.com/use-cases/ai-agent-action-authorization-api#production),
with the published pricing. Short version: if the approval gate is one you control, a
policy check inside your own service is simpler and cheaper. The signature earns its
price when somebody other than you has to be able to verify the decision.

**Just exploring?** `POST /v1/demo/verify` takes raw claims, needs no key at all, and
is shown at the end. It does not replace the signed-envelope walkthrough, because it
does not check a signature.

---

## Run the walkthrough

```bash
git clone https://github.com/API-Disk-Integrations/agent-mandate-mcp.git
cd agent-mandate-mcp
git checkout v0.1.1
npm ci
AGENT_MANDATE_API_KEY=your_key node examples/verify-mandate.mjs
```

The example runner comes from this repository, but it installs
`@api-disk-integrations/agent-mandate-mcp@0.1.1` **from npm into a throwaway prefix**
and runs that, so it exercises the published artifact rather than your working tree.
Omit `AGENT_MANDATE_API_KEY` and it prompts without echoing.

### What it prints

```
=== 1. Create a mandate ===
POST /v1/mandates -> 200
envelope keys: mandate, signature, requestId
signature: v1:b63eacaa7… (67 chars)

=== 3. Verify the action against the signed envelope ===
action: payments.transfer 30000 USD, approval required above 25000
decision: requires_approval
  violation: Actions above 25000 minor units need a human approval token.
  digest: c90fd0bc104dce63…

=== 4. Tamper with one signed field, keep the signature ===
raising approvalRequiredAboveMinor 25000 -> 999999, which would turn this into an allow
rejected: Agent Mandate error 400/invalid_request.
The tampered mandate did not buy an allow. The signature is doing its job.
```

That is a real run against production, not illustrative output. The grant allows up to
100,000 minor units but requires approval above 25,000, and the action asks for 30,000,
so `requires_approval` is the **correct** answer. A `deny` or `requires_approval` is a
correct result, not a failure.

**Verification reports a result; your application remains responsible for enforcing it.**

## Install the server

```bash
npx --yes @api-disk-integrations/agent-mandate-mcp@0.1.1
```

A generic stdio client configuration:

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

`${AGENT_MANDATE_API_KEY}` denotes the host's secret reference; use your client's
documented secret facility if its syntax differs. The package uses stdio and reads
exactly that environment variable. It has no remote `/mcp` endpoint.

**Pin the version.** `0.1.0` is still on the registry and has a first-use defect: its
input schema accepted any object for `mandate`, so a call built from the keyless
demo's shape returned `HTTP 400`.

If you would rather verify a checksummed artifact, every release also attaches a
tarball and its SHA-256:

```bash
curl -fsSLO https://github.com/API-Disk-Integrations/agent-mandate-mcp/releases/download/v0.1.1/api-disk-integrations-agent-mandate-mcp-0.1.1.tgz
shasum -a 256 api-disk-integrations-agent-mandate-mcp-0.1.1.tgz   # compare with the release page
npm install -g ./api-disk-integrations-agent-mandate-mcp-0.1.1.tgz
```

## The two shapes, which is the thing that trips people up

| Endpoint | Key | Takes |
| --- | --- | --- |
| `POST /v1/demo/verify` | none | `{mandate: {…claims…}, action: {…}}` — **raw claims** |
| `POST /v1/verify` | yes | `{mandate: {mandate: {…claims…}, signature: "…"}, action: {…}}` — the **envelope** |

The envelope is the entire response body of `POST /v1/mandates`:
`{mandate, signature, requestId}`. Pass it through unchanged.

`"mandate.mandate" must be the claims object` means bare claims were passed where the
envelope belongs. Run `POST /v1/mandates` first and pass its whole response.

## The two calls by hand

**Step 1 — create a mandate.** Issuing is free and does not consume your allowance.

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

Answers `200` with `{"mandate": {…}, "signature": "…", "requestId": "…"}`.
**That whole body is the envelope.**

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

### With no key at all

```sh
curl -X POST https://agentmandate-api.com/v1/demo/verify \
  -H 'content-type: application/json' \
  -d '{"mandate":{"principal":"user_8814","agent":"a1","expiresAt":"2026-12-31T23:59:59Z","currency":"USD","totalSpendCapMinor":500000,"grants":[{"action":"payments.transfer","resources":["vendor.acme"],"maxAmountMinor":100000,"approvalRequiredAboveMinor":25000}]},"action":{"agent":"a1","action":"payments.transfer","resource":"vendor.acme","amountMinor":30000,"currency":"USD"}}'
```

This route takes **bare claims**, not the envelope, and does not check a signature.

## What this server does not do

It does not issue or revoke mandates, execute an action, change an account, or call
billing. It makes at most one API request per tool call and never retries
automatically.

- npm: `@api-disk-integrations/agent-mandate-mcp`
- Official MCP Registry: `io.github.API-Disk-Integrations/agent-mandate`
- source: `API-Disk-Integrations/agent-mandate-mcp`

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
