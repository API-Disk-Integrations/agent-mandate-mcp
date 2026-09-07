import assert from 'node:assert/strict';
import test from 'node:test';
import { SafeApiError, verifyAction } from '../src/client.js';
const MAX_BODY_BYTES = 1_048_576;
const input = {
    mandate: { mandate: { id: 'mnd_fixture' }, signature: 'fixture-signature' },
    action: { agent: 'fixture-agent', action: 'payments.transfer', amountMinor: 25, currency: 'USD', at: '2026-09-04T12:00:00Z' },
};
const output = {
    count: 1,
    receipts: [{ decision: 'deny', violations: [{ code: 'action_not_granted', detail: 'fixture' }] }],
};
test('posts exactly once with bearer auth and preserves a denial', async () => {
    let calls = 0;
    const fetchImpl = async (url, init) => {
        calls += 1;
        assert.equal(String(url), 'https://agentmandate-api.com/v1/verify');
        assert.equal(init?.method, 'POST');
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer sentinel-key');
        assert.deepEqual(JSON.parse(String(init?.body)), input);
        return Response.json(output);
    };
    assert.deepEqual(await verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), output);
    assert.equal(calls, 1);
});
test('the released client type removes caller-selected origin', () => {
    const rejectedAtCompileTime = {
        apiKey: 'sentinel-key',
        // @ts-expect-error origin is intentionally absent from released options
        origin: 'http://untrusted.invalid',
    };
    assert.equal(rejectedAtCompileTime.origin, 'http://untrusted.invalid');
});
for (const hostileOrigin of ['http://untrusted.invalid', 'https://alternate.invalid']) {
    test(`untyped origin ${hostileOrigin} cannot alter the fixed HTTPS endpoint`, async () => {
        let calls = 0;
        const fetchImpl = async (url, init) => {
            calls += 1;
            assert.equal(String(url), 'https://agentmandate-api.com/v1/verify');
            assert.equal(init?.redirect, 'error');
            return Response.json(output);
        };
        const options = { apiKey: 'sentinel-key', fetchImpl, origin: hostileOrigin };
        assert.deepEqual(await verifyAction(input, options), output);
        assert.equal(calls, 1);
    });
}
test('rejects a redirect response without following or retrying', async () => {
    let calls = 0;
    const fetchImpl = async (_url, init) => {
        calls += 1;
        assert.equal(init?.redirect, 'error');
        return new Response('', { status: 302, headers: { location: 'http://untrusted.invalid' } });
    };
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.status === 302);
    assert.equal(calls, 1);
});
test('rejects ambiguous single and batch input before any request', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return Response.json(output);
    };
    await assert.rejects(() => verifyAction({ ...input, actions: [input.action] }, { apiKey: 'sentinel-key', fetchImpl }));
    assert.equal(calls, 0);
});
test('rejects a batch above the contract maximum before any request', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return Response.json(output);
    };
    await assert.rejects(() => verifyAction({ mandate: input.mandate, actions: Array(501).fill(input.action) }, { apiKey: 'sentinel-key', fetchImpl }));
    assert.equal(calls, 0);
});
test('rejects an oversized serialized request before fetch', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return Response.json(output);
    };
    const oversized = {
        ...input,
        mandate: { ...input.mandate, oversized: 'x'.repeat(MAX_BODY_BYTES) },
    };
    await assert.rejects(() => verifyAction(oversized, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.status === 413 && error.code === 'payload_too_large');
    assert.equal(calls, 0);
});
function oversizedStreamResponse(status, headers) {
    let sent = 0;
    const chunk = new Uint8Array(65_536).fill(0x78);
    const stream = new ReadableStream({
        pull(controller) {
            if (sent > MAX_BODY_BYTES) {
                controller.close();
                return;
            }
            controller.enqueue(chunk);
            sent += chunk.byteLength;
        },
    });
    return new Response(stream, {
        status,
        ...(headers === undefined ? {} : { headers }),
    });
}
test('rejects an oversized success stream with missing Content-Length before JSON parse', async () => {
    const fetchImpl = async () => oversizedStreamResponse(200);
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.code === 'payload_too_large');
});
test('rejects an oversized chunked error stream despite misleading Content-Length', async () => {
    const fetchImpl = async () => oversizedStreamResponse(500, {
        'content-length': '7',
        'transfer-encoding': 'chunked',
    });
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.status === 500 && error.code === 'payload_too_large');
});
for (const status of [200, 500]) {
    test(`rejects declared oversized ${status === 200 ? 'success' : 'error'} response before reading JSON`, async () => {
        const fetchImpl = async () => new Response('{}', {
            status,
            headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
        });
        await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.code === 'payload_too_large');
    });
}
test('accepts a bounded success response when Content-Length is missing', async () => {
    const body = JSON.stringify(output);
    const fetchImpl = async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
    assert.deepEqual(await verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), output);
});
test('requires currency when amountMinor is supplied', async () => {
    await assert.rejects(() => verifyAction({ ...input, action: { action: 'payments.transfer', amountMinor: 1 } }, { apiKey: 'sentinel-key' }));
});
test('allowlists a documented error code while discarding upstream strings', async () => {
    const fetchImpl = async () => Response.json({
        error: {
            code: 'rate_limited',
            message: 'never-print-this',
            requestId: 'never-print-this',
            details: { ignored: true },
        },
    }, { status: 429 });
    await assert.rejects(() => verifyAction(input, { apiKey: 'never-print-this', fetchImpl }), (error) => {
        assert.ok(error instanceof SafeApiError);
        assert.equal(error.status, 429);
        assert.equal(error.code, 'rate_limited');
        assert.equal('requestId' in error, false);
        assert.doesNotMatch(String(error), /never-print-this/);
        return true;
    });
});
test('normalizes an undocumented error code to unknown', async () => {
    const fetchImpl = async () => Response.json({
        error: { code: 'surprise_code', message: 'bounded fixture' },
    }, { status: 418 });
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }), (error) => error instanceof SafeApiError && error.code === 'unknown');
});
test('returns a bounded error for invalid JSON without exposing the credential or body', async () => {
    const fetchImpl = async () => new Response('raw-body-fixture', { status: 502 });
    await assert.rejects(() => verifyAction(input, { apiKey: 'never-print-this', fetchImpl }), (error) => {
        assert.ok(error instanceof SafeApiError);
        assert.equal(error.status, 502);
        assert.doesNotMatch(String(error), /never-print-this|raw-body-fixture/);
        return true;
    });
});
test('does not retry a server failure', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return Response.json({ error: { code: 'internal_error', message: 'fixture failure' } }, { status: 500 });
    };
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl }));
    assert.equal(calls, 1);
});
test('aborts one in-flight request at the configured timeout', async () => {
    let calls = 0;
    const fetchImpl = async (_url, init) => {
        calls += 1;
        return await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
    };
    await assert.rejects(() => verifyAction(input, { apiKey: 'sentinel-key', fetchImpl, timeoutMs: 5 }), (error) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(calls, 1);
});
