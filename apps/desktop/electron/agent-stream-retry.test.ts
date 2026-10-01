import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  frameMayHaveStartedToolExecution,
  mayRestartFreshAfterStreamError,
} from './agent-stream-retry.ts'

describe('agent stream fresh retry safety', () => {
  it('treats input-available as potentially executed before a result exists', () => {
    assert.equal(
      frameMayHaveStartedToolExecution({
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'trigger_create',
      }),
      true,
    )
  })

  it('allows a fresh retry only before tool execution and outside explicit resume', () => {
    assert.equal(
      mayRestartFreshAfterStreamError({
        explicitResume: false,
        toolExecutionMayHaveStarted: false,
      }),
      true,
    )
    assert.equal(
      mayRestartFreshAfterStreamError({
        explicitResume: false,
        toolExecutionMayHaveStarted: true,
      }),
      false,
    )
    assert.equal(
      mayRestartFreshAfterStreamError({
        explicitResume: true,
        toolExecutionMayHaveStarted: false,
      }),
      false,
    )
  })
})
