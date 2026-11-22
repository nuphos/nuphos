import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { MODEL_UNAVAILABLE_MESSAGE } from './plain-failure'
import { classifyPreviewInterruption } from './preview-transcript'

import { failureLine } from '@/lib/agent/waiting-answers'
import { formatAgentStreamError } from '@/routes/agent/errors'

// Claude Code behind a team's LiteLLM proxy, as logged in production at 2026-11-16T21:09:11Z.
const litellm = new OpenAbRpcError(
  '**Internal Error** (code: -32603)\nInternal error: API Error: 400 400: {\'error\': \'anthropic_messages: Invalid model name passed in model=claude-opus-5-5. Call `/v1/models` to view available models for your key.\'}\n> {"errorKind":"unknown"}',
  -32603,
)

const unavailable = {
  litellm,
  // The Anthropic API's answer for a model the key cannot use.
  anthropic: new OpenAbRpcError(
    '**Internal Error** (code: -32603)\nInternal error: API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}',
    -32603,
  ),
  // The OpenAI API's answer, through any adapter.
  openai: new Error(
    'The model `gpt-9` does not exist or you do not have access to it. (code: model_not_found)',
  ),
}

test('a model the endpoint does not serve is one plain sentence wherever the failure is shown', () => {
  for (const [provider, error] of Object.entries(unavailable)) {
    for (const [where, shown] of Object.entries({
      live: formatAgentStreamError(error),
      stored: classifyPreviewInterruption(error, false).message,
      // What a parent or child thread is told when a delegated turn fails.
      thread: failureLine(error),
    }))
      expect([provider, where, shown]).toEqual([provider, where, MODEL_UNAVAILABLE_MESSAGE])
  }
})

test("the proxy's own text never reaches the user", () => {
  for (const shown of [
    formatAgentStreamError(litellm),
    classifyPreviewInterruption(litellm, false).message,
    failureLine(litellm),
  ]) {
    expect(shown).not.toContain('anthropic_messages')
    expect(shown).not.toContain('/v1/models')
    expect(shown).not.toContain('claude-opus-5-5')
  }
})

test('another not-found error is not taken for an unavailable model', () => {
  const error = new OpenAbRpcError(
    '**Internal Error** (code: -32603)\nInternal error: API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"file: report.pdf"}}',
    -32603,
  )

  expect(formatAgentStreamError(error)).not.toBe(MODEL_UNAVAILABLE_MESSAGE)
})
