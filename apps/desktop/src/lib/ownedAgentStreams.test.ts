import assert from 'node:assert/strict'
import test from 'node:test'

import { markOwnedAgentStream, ownsAgentStream } from './ownedAgentStreams.ts'

test('a device owns only the streams it started', () => {
  markOwnedAgentStream('stream-started-here')

  assert.equal(ownsAgentStream('stream-started-here'), true)
  assert.equal(ownsAgentStream('stream-from-another-device'), false)
  assert.equal(ownsAgentStream(undefined), false)
})
