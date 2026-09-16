#!/usr/bin/env node
/**
 * The signed-envelope walkthrough.
 *
 *   node examples/verify-mandate.mjs
 *
 * Creates a mandate, verifies an action against it through the MCP tool, then
 * tampers with one signed field and verifies again. It prints the real decision
 * for each and exits non-zero unless BOTH the expected accept and the expected
 * rejection occur.
 *
 * WHY THE SECOND CALL MATTERS
 * A walkthrough that only shows the happy path cannot tell you whether the
 * signature is checked at all. Raising `approvalRequiredAboveMinor` from 25,000
 * to 999,999 while keeping the original signature is exactly what an attacker
 * would try: it turns a `requires_approval` into an `allow`. If that second call
 * succeeds, the guarantee is worthless and this script fails loudly.
 *
 * The key is read from the environment or prompted for without echo. It is never
 * printed, never written to disk, and never passed on a command line. The
 * signature is printed only as a short prefix.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.AGENT_MANDATE_API_URL ?? 'https://agentmandate-api.com';

/**
 * Defaults to the GitHub Release tarball because npm currently serves 0.1.0,
 * which has the first-use defect this version fixes. Override to test another
 * artifact. Once 0.1.1 is on npm this becomes
 * '@api-disk-integrations/agent-mandate-mcp@0.1.1'.
 */
const SPEC = process.env.AGENT_MANDATE_MCP_SPEC ??
  'https://github.com/API-Disk-Integrations/agent-mandate-mcp/releases/download/v0.1.1/api-disk-integrations-agent-mandate-mcp-0.1.1.tgz';

/** The grant allows up to 100,000 minor units but requires approval above 25,000. */
const CLAIMS = {
  principal: 'user_8814',
  agent: 'agent_procurement_v3',
  expiresAt: '2026-12-31T23:59:59Z',
  currency: 'USD',
  totalSpendCapMinor: 500000,
  grants: [{
    action: 'payments.transfer',
    resources: ['vendor.acme'],
    maxAmountMinor: 100000,
    approvalRequiredAboveMinor: 25000,
  }],
};

/** 30,000 is inside the grant's ceiling but above the approval threshold. */
const ACTION = {
  agent: 'agent_procurement_v3',
  action: 'payments.transfer',
  resource: 'vendor.acme',
  amountMinor: 30000,
  currency: 'USD',
};

async function readKey() {
  if (process.env.AGENT_MANDATE_API_KEY) return process.env.AGENT_MANDATE_API_KEY;
  if (!process.stdin.isTTY) {
    console.error('Set AGENT_MANDATE_API_KEY, or run this in a terminal to be prompted.');
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const hide = (s) => { rl.output.write(s); rl.input.on('data', () => {}); };
  return new Promise((resolve) => {
    rl.question('Agent Mandate API key (not echoed): ', (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
    rl._writeToOutput = function (s) { if (s.includes('key')) rl.output.write(s); };
    void hide;
  });
}

async function createMandate(key) {
  const res = await fetch(`${API}/v1/mandates`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(CLAIMS),
  });
  if (!res.ok) throw new Error(`POST /v1/mandates returned ${res.status}. Check the key has mandate-creation access.`);
  const body = await res.json();
  if (!body?.mandate || !body?.signature) throw new Error('Response was not an envelope: expected {mandate, signature}.');
  return body;
}

/** A minimal stdio MCP client. Keeps the walkthrough dependency-free. */
function startServer(key, cache) {
  const child = spawn('npx', ['--yes', SPEC], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AGENT_MANDATE_API_KEY: key, npm_config_cache: cache, CI: '1' },
  });
  const pending = new Map();
  let id = 0, buf = '', stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`${method} timed out. stderr: ${stderr.slice(0, 200)}`)); } }, 60000);
  });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { child, call, notify, stderr: () => stderr };
}

function describe(result) {
  if (result?.isError === true) {
    return { ok: false, text: (result.content ?? []).map((c) => c.text).join(' ').trim() };
  }
  const receipt = result?.structuredContent?.receipts?.[0];
  if (!receipt) return { ok: false, text: 'no receipts in structuredContent' };
  return { ok: true, decision: receipt.decision, violations: receipt.violations ?? [], receipt };
}

const cache = mkdtempSync(join(tmpdir(), 'agent-mandate-walkthrough-'));
const cleanup = () => { try { rmSync(cache, { recursive: true, force: true }); } catch {} };

let server;
try {
  const key = await readKey();
  if (!key) { console.error('No key supplied.'); process.exit(2); }

  console.log('\n=== 1. Create a mandate ===');
  const envelope = await createMandate(key);
  console.log(`POST /v1/mandates -> 200`);
  console.log(`envelope keys: ${Object.keys(envelope).join(', ')}`);
  console.log(`signature: ${String(envelope.signature).slice(0, 12)}… (${String(envelope.signature).length} chars)`);
  console.log('That whole body is the envelope. Pass it through unchanged.');

  console.log(`\n=== 2. Start the MCP server ===`);
  console.log(`spec: ${SPEC}`);
  server = startServer(key, cache);
  const info = await server.call('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-mandate-walkthrough', version: '1.0.0' },
  });
  server.notify('notifications/initialized');
  console.log(`server: ${info?.serverInfo?.name ?? 'unnamed'} ${info?.serverInfo?.version ?? ''}`);
  const { tools } = await server.call('tools/list', {});
  console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);
  const tool = tools.find((t) => /verify/i.test(t.name))?.name ?? tools[0].name;

  console.log(`\n=== 3. Verify the action against the signed envelope ===`);
  console.log(`action: ${ACTION.action} ${ACTION.amountMinor} ${ACTION.currency}, approval required above 25000`);
  const good = describe(await server.call('tools/call', {
    name: tool, arguments: { mandate: { mandate: envelope.mandate, signature: envelope.signature }, action: ACTION },
  }));
  if (!good.ok) { console.log(`REJECTED: ${good.text}`); }
  else {
    console.log(`decision: ${good.decision}`);
    for (const v of good.violations) console.log(`  violation: ${v.detail ?? JSON.stringify(v)}`);
    if (good.receipt.digest) console.log(`  digest: ${String(good.receipt.digest).slice(0, 16)}…`);
  }
  const positiveOk = good.ok && good.decision === 'requires_approval';
  console.log(positiveOk
    ? 'As expected. A requires_approval is a correct answer, not a failure.'
    : `UNEXPECTED: wanted decision "requires_approval".`);

  console.log(`\n=== 4. Tamper with one signed field, keep the signature ===`);
  console.log('raising approvalRequiredAboveMinor 25000 -> 999999, which would turn this into an allow');
  const tampered = structuredClone(envelope.mandate);
  const grant = (tampered.grants ?? tampered.claims?.grants)?.[0];
  if (grant) grant.approvalRequiredAboveMinor = 999999;
  const bad = describe(await server.call('tools/call', {
    name: tool, arguments: { mandate: { mandate: tampered, signature: envelope.signature }, action: ACTION },
  }));
  let negativeOk;
  if (!bad.ok) { console.log(`rejected: ${bad.text.slice(0, 300)}`); negativeOk = true; }
  else {
    console.log(`decision: ${bad.decision}`);
    for (const v of bad.violations) console.log(`  violation: ${v.detail ?? JSON.stringify(v)}`);
    negativeOk = bad.decision !== 'allow';
  }
  console.log(negativeOk
    ? 'The tampered mandate did not buy an allow. The signature is doing its job.'
    : 'FAILURE: a tampered mandate was accepted. Do not rely on this verification.');

  console.log(`\n=== Result ===`);
  console.log(`untampered -> requires_approval : ${positiveOk ? 'PASS' : 'FAIL'}`);
  console.log(`tampered    -> not allowed      : ${negativeOk ? 'PASS' : 'FAIL'}`);
  const pass = positiveOk && negativeOk;
  console.log(pass ? '\nWalkthrough PASSED.' : '\nWalkthrough FAILED.');
  server.child.kill(); cleanup();
  process.exit(pass ? 0 : 1);
} catch (err) {
  console.error(`\nWalkthrough error: ${err.message}`);
  try { server?.child.kill(); } catch {}
  cleanup();
  process.exit(1);
}
