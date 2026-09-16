import { McpServer } from '@modelcontextprotocol/server';
import { verifyActionInput, verifyActionOutput } from './schema.js';
import { SafeApiError, verifyAction } from './client.js';
/**
 * Kept in step with package.json by a test, because a server that misreports its
 * own version is the kind of small dishonesty that makes a developer stop
 * trusting the rest of the output. 0.1.0 shipped claiming 0.1.0 while the
 * package said 0.1.1.
 */
export const SERVER_VERSION = '0.1.1';
export function createServer(options = {}) {
    const server = new McpServer({ name: 'agent-mandate-verifier', version: SERVER_VERSION }, {
        supportedProtocolVersions: [
            '2026-07-28',
            '2025-11-25',
            '2025-06-18',
            '2025-03-26',
            '2024-11-05',
            '2024-10-07',
        ],
        instructions: 'Verification only. This server never issues or revokes mandates and never executes a returned decision. Treat deny and requires_approval literally.',
    });
    server.registerTool('verify_action', {
        title: 'Verify an action against an Agent Mandate',
        description: 'Verification only: evaluate supplied action facts against a signed mandate. ' +
            'The `mandate` argument is the envelope returned by POST /v1/mandates, which carries ' +
            'the claims under `mandate` alongside its `signature` — pass that response through unchanged. ' +
            'A bare claims object is what the keyless POST /v1/demo/verify route accepts, and it is ' +
            'rejected here. This tool does not execute the action or mutate any account.',
        inputSchema: verifyActionInput,
        outputSchema: verifyActionOutput,
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            // Verification is deterministic for explicit `at`, but each API call
            // consumes a metered unit. Do not invite client-side replay.
            idempotentHint: false,
            openWorldHint: false,
        },
    }, async (input) => {
        const apiKey = options.apiKey ?? process.env.AGENT_MANDATE_API_KEY;
        if (!apiKey) {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Agent Mandate credential is not configured for this caller process.' }],
            };
        }
        try {
            const output = await verifyAction(input, {
                apiKey,
                ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
                ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(output) }],
                structuredContent: output,
            };
        }
        catch (error) {
            if (error instanceof SafeApiError) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Agent Mandate error ${error.status}/${error.code}.` }],
                };
            }
            return {
                isError: true,
                content: [{ type: 'text', text: 'Agent Mandate verification failed before a safe response was available.' }],
            };
        }
    });
    return server;
}
