import { expect, test } from 'bun:test'
import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'
import { formatAgentStreamError } from '@/routes/agent/errors'

// Actual response from DeepSeek Harness 0.2.2-rc.1 without an API key.
const notice =
  'turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment'
const error = new OpenAbRpcError(
  `**Internal Error** (code: -32603)\nInternal error: ${notice}`,
  -32603,
  {
    code: -32603,
    message: `Internal error: ${notice}`,
  },
)

test('shows the agent’s actionable error in at most 200 characters, live and in history', () => {
  const expected = `${Array.from(notice).slice(0, 199).join('')}…`

  expect(formatAgentStreamError(error)).toBe(expected)
  expect(classifyPreviewInterruption(error, false).message).toBe(expected)
})
