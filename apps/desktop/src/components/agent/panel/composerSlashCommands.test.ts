import assert from 'node:assert/strict'
import test from 'node:test'

import { matchSlashCommands, slashKeyAction, slashQuery } from './composerSlashCommands.ts'

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

test('/model + Enter sends /model: Enter runs nothing until the arrows pick a row', () => {
  // `/model` still matches the Model action, but nothing is highlighted yet.
  assert.equal(matchSlashCommands(commands, 'model').length, 1)
  assert.equal(slashKeyAction('Enter', false, -1), null)
  assert.equal(slashKeyAction('Enter', false, 0), 'select')
})

test('Tab and the arrows work the menu; Shift+Enter never selects', () => {
  assert.equal(slashKeyAction('Tab', false, -1), 'select')
  assert.equal(slashKeyAction('ArrowDown', false, -1), 'next')
  assert.equal(slashKeyAction('ArrowUp', false, -1), 'previous')
  assert.equal(slashKeyAction('Enter', true, 0), null)
  assert.equal(slashKeyAction('Escape', false, -1), 'dismiss')
})
