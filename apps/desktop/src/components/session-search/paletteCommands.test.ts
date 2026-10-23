import assert from 'node:assert/strict'
import test from 'node:test'

import { matchPaletteCommands, PALETTE_COMMANDS } from './paletteCommands.ts'

test('a page name finds its sidebar page', () => {
  assert.deepEqual(
    matchPaletteCommands('skills').map(({ id, group }) => ({ id, group })),
    [{ id: 'team.agent-skills', group: 'Go to' }],
  )
})

test('every action carries its shortcut from the cheat sheet', () => {
  for (const command of PALETTE_COMMANDS.filter(({ group }) => group === 'Actions')) {
    assert.ok(command.combo, command.id)
  }
})

test('a label that starts with the query ranks ahead of one that only contains it', () => {
  const ids = matchPaletteCommands('t').map(({ id }) => id)

  // "New tab" (a word starts with t) is declared after Connectors (t inside a word).
  assert.ok(ids.indexOf('new-tab') < ids.indexOf('team.integrations'), ids.join(', '))
})

test('an empty query lists no commands', () => {
  assert.deepEqual(matchPaletteCommands('  '), [])
})

test('another team is found by name and switches to it', () => {
  const teams = [
    { id: 't1', name: 'Zeabur Inc.' },
    { id: 't2', name: 'Design Team' },
  ]

  assert.deepEqual(
    matchPaletteCommands('design', teams).map(({ id, label }) => ({ id, label })),
    [{ id: 'switch-team:t2', label: 'Switch to Design Team' }],
  )
  assert.ok(matchPaletteCommands('switch', teams).length >= 2)
})
