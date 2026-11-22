import { expect, test } from 'bun:test'

import { CodexTurnFailedError } from './codex-turn-failure'
import { CONTEXT_TOO_LONG_MESSAGE } from './plain-failure'
import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

// OpenCode through the ACP shim, as logged in production on 2026-11-16.
const OPENCODE_DETAIL =
  '{"message":"OpenCode Go: Upstream request failed: [400003] Input tokens exceed the model context limit.","type":"api_error","code":"context_length_exceeded"}'
const opencode = new OpenAbRpcError(
  `**Internal Error** (code: -32603)\nInternal error: ${OPENCODE_DETAIL}\n> {"errorName":"UnknownError","service":"session"}`,
  -32603,
  { code: -32603, message: `Internal error: ${OPENCODE_DETAIL}` },
)

const overflows = {
  opencode,
  claude: new OpenAbRpcError(
    '**Internal Error** (code: -32603)\nInternal error: Prompt is too long',
    -32603,
  ),
  openai: new OpenAbRpcError(
    "**Internal Error** (code: -32603)\nInternal error: This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.",
    -32603,
  ),
  codex: new CodexTurnFailedError(
    "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
  ),
}

test('a conversation too long for the model is one plain sentence, live and stored alike', () => {
  for (const [agent, error] of Object.entries(overflows)) {
    expect([agent, formatAgentStreamError(error)]).toEqual([agent, CONTEXT_TOO_LONG_MESSAGE])
    expect([agent, classifyPreviewInterruption(error, false).message]).toEqual([
      agent,
      CONTEXT_TOO_LONG_MESSAGE,
    ])
  }
})

test("the provider's own text never reaches the user", () => {
  for (const shown of [
    formatAgentStreamError(opencode),
    classifyPreviewInterruption(opencode, false).message,
  ]) {
    expect(shown).not.toContain('OpenCode Go')
    expect(shown).not.toContain('400003')
    expect(shown).not.toContain('context_length_exceeded')
  }
})

test('a stopped turn is still reported as stopped', () => {
  expect(classifyPreviewInterruption(opencode, true).reason).toBe('cancelled')
})
