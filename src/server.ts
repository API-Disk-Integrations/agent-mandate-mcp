import { McpServer } from '@modelcontextprotocol/server'
import { verifyActionInput, verifyActionOutput } from './schema.js'
import { SafeApiError, verifyAction } from './client.js'

export interface ServerOptions {
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'agent-mandate-verifier', version: '0.1.0' },
    {
      supportedProtocolVersions: [
        '2026-07-28',
        '2025-11-25',
        '2025-06-18',
        '2025-03-26',
        '2024-11-05',
        '2024-10-07',
      ],
      instructions:
        'Verification only. This server never issues or revokes mandates and never executes a returned decision. Treat deny and requires_approval literally.',
    },
  )

  server.registerTool(
    'verify_action',
    {
      title: 'Verify an action against an Agent Mandate',
      description:
        'Verification only: evaluate supplied action facts against a supplied signed mandate. This tool does not execute the action or mutate any account.',
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
    },
    async (input) => {
      const apiKey = options.apiKey ?? process.env.AGENT_MANDATE_API_KEY
      if (!apiKey) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Agent Mandate credential is not configured for this caller process.' }],
        }
      }

      try {
        const output = await verifyAction(input, {
          apiKey,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        if (error instanceof SafeApiError) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Agent Mandate error ${error.status}/${error.code}.` }],
          }
        }
        return {
          isError: true,
          content: [{ type: 'text', text: 'Agent Mandate verification failed before a safe response was available.' }],
        }
      }
    },
  )

  return server
}
