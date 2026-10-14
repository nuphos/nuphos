import assert from 'node:assert/strict'
import test from 'node:test'

import { matchSlashCommands, slashQuery } from './composerSlashCommands.ts'

const run = () => null
const commands = [
  { id: 'new', title: 'New chat', description: '', run },
  { id: 'fork', title: 'Fork chat', description: '', run },
  { id: 'model', title: 'Model', description: '', run },
]

test('a slash opens the menu only at the start of an otherwise empty message', () => {
  assert.equal(slashQuery('/', '/'), '')
  assert.equal(slashQuery('/fo', '/fo'), 'fo')
  assert.equal(slashQuery('/fo', '/fo and more'), null)
  assert.equal(slashQuery('see /fo', 'see /fo'), null)
  assert.equal(slashQuery('/a b', '/a b'), null)
})

test('commands match by id prefix or title', () => {
  assert.deepEqual(
    matchSlashCommands(commands, 'chat').map((command) => command.id),
    ['new', 'fork'],
  )
  assert.deepEqual(
    matchSlashCommands(commands, 'mo').map((command) => command.id),
    ['model'],
  )
  assert.equal(matchSlashCommands(commands, '').length, 3)
})
