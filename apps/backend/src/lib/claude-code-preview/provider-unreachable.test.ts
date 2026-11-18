import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { PROVIDER_UNREACHABLE_MESSAGE } from './plain-failure'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

/** claude-agent-acp when Claude Code cannot reach its API, as logged on 2026-11-17. */
const unreachable = (code: string) =>
  new OpenAbRpcError(
    `**Internal Error** (code: -32603)\nInternal error: API Error: Unable to connect to API (${code})\n> {"errorKind":"server_error"}`,
    -32603,
    { code: -32603, message: `Internal error: API Error: Unable to connect to API (${code})` },
  )

test('a computer that cannot reach the model API is one plain sentence, live and stored alike', () => {
  for (const code of ['EPROTO', 'ECONNRESET', 'ETIMEDOUT']) {
    expect(formatAgentStreamError(unreachable(code))).toBe(PROVIDER_UNREACHABLE_MESSAGE)
    expect(classifyPreviewInterruption(unreachable(code), false).message).toBe(
      PROVIDER_UNREACHABLE_MESSAGE,
    )
  }
})

test('the network error code never reaches the user', () => {
  expect(formatAgentStreamError(unreachable('EPROTO'))).not.toContain('EPROTO')
})
