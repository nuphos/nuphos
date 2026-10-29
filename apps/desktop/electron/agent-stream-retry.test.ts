import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { frameShowsTurnRan, mayRestartFreshAfterStreamError } from './agent-stream-retry.ts'

describe('agent stream fresh retry safety', () => {
  it('treats any agent output as the turn having run', () => {
    for (const type of ['text-delta', 'reasoning-delta', 'tool-input-available'])
      assert.equal(frameShowsTurnRan({ type }), true, type)
    for (const type of ['start', 'turn-interrupted', 'error', 'atlas-stream-done'])
      assert.equal(frameShowsTurnRan({ type }), false, type)
  })

  it('allows a fresh retry only before the turn ran and outside explicit resume', () => {
    assert.equal(mayRestartFreshAfterStreamError({ explicitResume: false, turnRan: false }), true)
    assert.equal(mayRestartFreshAfterStreamError({ explicitResume: false, turnRan: true }), false)
    assert.equal(mayRestartFreshAfterStreamError({ explicitResume: true, turnRan: false }), false)
  })
})
