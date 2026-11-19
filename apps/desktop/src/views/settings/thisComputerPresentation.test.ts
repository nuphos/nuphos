import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOX_BADGE } from './boxPresentation.ts'
import { computerBadge } from './thisComputerPresentation.ts'

import type { MachineState } from './boxPresentation.ts'

const connections = [undefined, 'online', 'reconnecting', 'superseded', 'revoked'] as const

test('a computer says Running exactly when its picture runs', () => {
  for (const state of Object.keys(BOX_BADGE) as MachineState[])
    for (const connection of connections)
      assert.equal(
        computerBadge(state, connection).tone === 'online',
        state === 'running',
        `${state} with ${connection}`,
      )
})

test("this computer's card says why it is down, never a bare Offline", () => {
  assert.deepEqual(computerBadge('stopped', 'reconnecting'), {
    label: 'Reconnecting…',
    tone: 'pending',
  })
  assert.deepEqual(computerBadge('stopped', 'superseded'), {
    label: 'In use by another app',
    tone: 'off',
  })
  assert.deepEqual(computerBadge('stopped', 'revoked'), { label: 'Access removed', tone: 'error' })
  // Its app connected before the backend saw it: the card waits for the backend, as its picture does.
  assert.deepEqual(computerBadge('stopped', 'online'), BOX_BADGE.stopped)
  // Another computer, or before the app has said: the backend's view stands.
  assert.deepEqual(computerBadge('running'), BOX_BADGE.running)
  assert.deepEqual(computerBadge('stopped'), BOX_BADGE.stopped)
})
