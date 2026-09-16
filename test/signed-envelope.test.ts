/**
 * Regression test for the defect found by the 2026-09-15 MCP canary.
 *
 * The free route POST /v1/demo/verify accepts BARE CLAIMS and works, so the
 * landing page, the playground and the published Postman example all teach that
 * shape. The paid POST /v1/verify requires the SIGNED ENVELOPE returned by
 * POST /v1/mandates.
 *
 * The tool's schema used to be `z.record(z.string(), z.unknown())`, which
 * accepted the bare shape and forwarded it, so a developer following the public
 * instructions received HTTP 400 naming an internal field path, with nothing
 * pointing at /v1/mandates.
 *
 * These tests assert the tool now refuses locally, and that a well-formed
 * envelope is still accepted. They must not be deleted to make a build pass:
 * the first one is the bug.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyActionInput } from '../src/schema.js'

const action = { action: 'payments.transfer', resource: 'vendor.acme', amountMinor: 30_000, currency: 'USD' }

/** Exactly what the landing page, the demo and the Postman example teach. */
const BARE_CLAIMS = {
  principal: 'user_8814',
  agent: 'agent_procurement_v3',
  expiresAt: '2026-12-31T23:59:59Z',
  currency: 'USD',
  totalSpendCapMinor: 500_000,
  grants: [{ action: 'payments.transfer', resources: ['vendor.acme'], maxAmountMinor: 100_000 }],
}

test('bare claims are refused locally, so the 400 never has to happen', () => {
  const r = verifyActionInput.safeParse({ mandate: BARE_CLAIMS, action })
  assert.equal(r.success, false, 'the bare-claims shape must not be accepted')
})

test('a mandate with no signature is refused', () => {
  const r = verifyActionInput.safeParse({ mandate: { mandate: BARE_CLAIMS }, action })
  assert.equal(r.success, false, 'an envelope without a signature must not be accepted')
})

test('an empty signature is refused', () => {
  const r = verifyActionInput.safeParse({ mandate: { mandate: BARE_CLAIMS, signature: '' }, action })
  assert.equal(r.success, false, 'an empty signature must not be accepted')
})

test('the envelope POST /v1/mandates actually returns is accepted', () => {
  // Shape confirmed against production on 2026-09-15: the response body carries
  // the claims under `mandate`, a `signature`, and a `requestId` alongside.
  const envelope = { mandate: { ...BARE_CLAIMS, id: 'mnd_live' }, signature: 'sig', requestId: 'req_1' }
  const r = verifyActionInput.safeParse({ mandate: envelope, action })
  assert.equal(r.success, true, 'the real /v1/mandates response must pass unchanged')
})

test('the envelope is passed through unchanged, extra fields preserved', () => {
  const envelope = { mandate: { ...BARE_CLAIMS }, signature: 'sig', requestId: 'req_1' }
  const r = verifyActionInput.safeParse({ mandate: envelope, action })
  assert.equal(r.success, true)
  if (r.success) {
    assert.equal((r.data.mandate as Record<string, unknown>)['requestId'], 'req_1',
      'passthrough must preserve fields the API may rely on')
  }
})
