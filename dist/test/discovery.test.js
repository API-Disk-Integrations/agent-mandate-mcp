import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/server.js';
test('a client discovers one read-only verification tool and can call it', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
        apiKey: 'sentinel-key',
        fetchImpl: async () => Response.json({ count: 1, receipts: [{ decision: 'allow' }] }),
    });
    const client = new Client({ name: 'local-audit-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 1);
    assert.equal(listed.tools[0]?.name, 'verify_action');
    assert.ok(listed.tools[0]?.inputSchema);
    assert.ok(listed.tools[0]?.outputSchema);
    assert.equal(listed.tools[0]?.annotations?.readOnlyHint, true);
    assert.equal(listed.tools[0]?.annotations?.destructiveHint, false);
    assert.equal(listed.tools[0]?.annotations?.idempotentHint, false);
    const result = await client.callTool({
        name: 'verify_action',
        arguments: {
            mandate: { mandate: { id: 'mnd_fixture' }, signature: 'fixture-signature' },
            action: { action: 'inventory.read' },
        },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { count: 1, receipts: [{ decision: 'allow' }] });
    await client.close();
    await server.close();
});
test('a missing caller credential fails closed without making a request', async () => {
    let calls = 0;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({ apiKey: '', fetchImpl: async () => {
            calls += 1;
            return Response.json({ count: 1, receipts: [] });
        } });
    const client = new Client({ name: 'local-audit-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
        name: 'verify_action',
        arguments: { mandate: { signature: 'fixture' }, action: { action: 'inventory.read' } },
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 0);
    await client.close();
    await server.close();
});
test('the MCP error boundary never surfaces provider-controlled strings', async () => {
    const secret = 'sentinel-secret-never-emit';
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
        apiKey: secret,
        fetchImpl: async () => Response.json({
            error: { code: 'rate_limited', message: secret, requestId: secret },
        }, { status: 429 }),
    });
    const client = new Client({ name: 'local-audit-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({
        name: 'verify_action',
        arguments: { mandate: { signature: 'fixture' }, action: { action: 'inventory.read' } },
    });
    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.type, 'text');
    assert.equal(result.content[0]?.type === 'text' ? result.content[0].text : '', 'Agent Mandate error 429/rate_limited.');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    await client.close();
    await server.close();
});
test('a client pinned to protocol revision 2026-07-28 discovers and calls the exact tool', async () => {
    let calls = 0;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const serverHandle = serveStdio(() => createServer({
        apiKey: 'sentinel-key',
        fetchImpl: async () => {
            calls += 1;
            return Response.json({ count: 1, receipts: [{ decision: 'allow' }] });
        },
    }), { transport: serverTransport });
    const client = new Client({ name: 'current-protocol-audit-client', version: '0.0.0' }, {
        versionNegotiation: {
            mode: { pin: '2026-07-28' },
            probe: { timeoutMs: 1_000, maxRetries: 0 },
        },
    });
    await client.connect(clientTransport);
    assert.equal(client.getProtocolEra(), 'modern');
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    const first = await client.listTools();
    const second = await client.listTools();
    assert.deepEqual(second, first);
    assert.equal(first.tools.length, 1);
    assert.equal(first.tools[0]?.name, 'verify_action');
    assert.equal(first.tools[0]?.annotations?.readOnlyHint, true);
    assert.equal(first.tools[0]?.annotations?.destructiveHint, false);
    assert.equal(first.tools[0]?.annotations?.idempotentHint, false);
    assert.equal(first.tools[0]?.annotations?.openWorldHint, false);
    const result = await client.callTool({
        name: 'verify_action',
        arguments: {
            mandate: { signature: 'fixture' },
            action: { action: 'inventory.read' },
        },
    });
    assert.deepEqual(result.structuredContent, {
        count: 1,
        receipts: [{ decision: 'allow' }],
    });
    assert.equal(calls, 1);
    await client.close();
    await serverHandle.close();
});
