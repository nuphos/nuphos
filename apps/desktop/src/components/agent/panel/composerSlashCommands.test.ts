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
  assert.equal(slashKeyAction('Enter', false, { active: -1, armed: false }), null)
  assert.equal(slashKeyAction('Enter', false, { active: 0, armed: true }), 'select')
})

test('Tab and the arrows work the menu; Shift+Enter never selects', () => {
  assert.equal(slashKeyAction('Tab', false, { active: -1, armed: false }), 'select')
  assert.equal(slashKeyAction('ArrowDown', false, { active: -1, armed: false }), 'next')
  assert.equal(slashKeyAction('ArrowUp', false, { active: -1, armed: false }), 'previous')
  assert.equal(slashKeyAction('Enter', true, { active: 0, armed: true }), null)
  assert.equal(slashKeyAction('Escape', false, { active: -1, armed: false }), 'dismiss')
})

test('a row the pointer highlights does not arm Enter', () => {
  assert.equal(slashKeyAction('Enter', false, { active: 1, armed: false }), null)
})
