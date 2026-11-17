import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { AGENT_CLI_UNSTARTABLE_MESSAGE } from './plain-failure'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

// claude-agent-acp on Windows, spawning npm's claude.cmd without a shell, as logged on 2026-11-17.
const einval = new OpenAbRpcError(
  '**Internal Error** (code: -32603)\nInternal error\n> spawn EINVAL',
  -32603,
  { code: -32603, message: 'Internal error' },
)

test('an agent CLI that cannot start is one plain sentence, live and stored alike', () => {
  expect(formatAgentStreamError(einval)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  expect(classifyPreviewInterruption(einval, false).message).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
})

test('Node’s spawn error code never reaches the user', () => {
  expect(formatAgentStreamError(einval)).not.toContain('EINVAL')
})
