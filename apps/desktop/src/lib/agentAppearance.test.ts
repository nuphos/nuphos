import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAgentAppearance } from './agentAppearance.ts'

test('new and invalid settings use Compact', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{}', '{"density":"large"}']) {
    assert.deepEqual(parseAgentAppearance(raw), { density: 'compact' })
  }
})

test('a saved density is restored, and the retired Bot avatars switch is ignored', () => {
  assert.deepEqual(parseAgentAppearance('{"density":"comfortable"}'), { density: 'comfortable' })
  assert.deepEqual(parseAgentAppearance('{"botAvatars":false,"density":"compact"}'), {
    density: 'compact',
  })
})
