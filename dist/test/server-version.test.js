import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SERVER_VERSION } from '../src/server.js';
test('the version the server reports is the version the package ships', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(SERVER_VERSION, pkg.version, 'createServer advertises its version in the MCP initialize handshake. If it ' +
        'disagrees with package.json, a developer who checks finds the artifact ' +
        'misreporting itself, which is exactly the trust this product sells.');
});
