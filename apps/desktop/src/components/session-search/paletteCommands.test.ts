import assert from 'node:assert/strict'
import test from 'node:test'

import { matchPaletteCommands } from './paletteCommands.ts'

test('a page name finds its sidebar page', () => {
  assert.deepEqual(
    matchPaletteCommands('skills').map(({ id, group }) => ({ id, group })),
    [{ id: 'team.agent-skills', group: 'Go to' }],
  )
})

test('an action carries the shortcut from the cheat sheet', () => {
  const [command] = matchPaletteCommands('new tab')

  assert.equal(command.id, 'new-tab')
  assert.equal(command.combo, 'mod+t')
})

test('an empty query lists no commands', () => {
  assert.deepEqual(matchPaletteCommands('  '), [])
})
