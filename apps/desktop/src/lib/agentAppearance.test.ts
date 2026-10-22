import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAgentAppearance } from './agentAppearance.ts'

test('new and invalid settings use Bot Avatar on + Compact', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{}', '{"density":"large"}']) {
    assert.deepEqual(parseAgentAppearance(raw), { botAvatars: true, density: 'compact' })
  }
})

test('the two preferences remain independent when restored', () => {
  for (const botAvatars of [true, false]) {
    for (const density of ['compact', 'comfortable']) {
      assert.deepEqual(parseAgentAppearance(JSON.stringify({ botAvatars, density })), {
        botAvatars,
        density,
      })
    }
  }
  assert.deepEqual(parseAgentAppearance('{"botAvatars":false}'), {
    botAvatars: false,
    density: 'compact',
  })
})
