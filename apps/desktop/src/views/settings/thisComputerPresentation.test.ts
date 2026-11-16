import assert from 'node:assert/strict'
import { test } from 'node:test'

import { thisComputerBadge } from './thisComputerPresentation.ts'

test("this computer's card shows its own connection and why it is down, never a bare Offline", () => {
  assert.deepEqual(thisComputerBadge('online'), { label: 'Running', tone: 'online' })
  assert.deepEqual(thisComputerBadge('reconnecting'), { label: 'Reconnecting…', tone: 'pending' })
  assert.deepEqual(thisComputerBadge('superseded'), {
    label: 'In use by another app',
    tone: 'off',
  })
  assert.deepEqual(thisComputerBadge('revoked'), {
    label: 'Access removed',
    tone: 'error',
  })
  // Until the app says, the backend's view stands.
  assert.equal(thisComputerBadge(undefined), undefined)
})
