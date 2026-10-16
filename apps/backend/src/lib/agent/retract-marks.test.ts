import { expect, test } from 'bun:test'

import { consumeRetracted, markCarried, turnCarried } from './retract-marks'

import type { PendingUserMessage } from './pending-message-types'

// The test environment runs without Redis: every mark is a no-op that reads back as unset.
test('without Redis the marks pass drained messages through and read back unset', async () => {
  const drained = [{ id: 'p1' }] as PendingUserMessage[]

  expect(await markCarried('turn-1')(drained)).toBe(drained)
  expect(await turnCarried('turn-1')).toBe(false)
  expect(await consumeRetracted('s1')).toBe(false)
})
