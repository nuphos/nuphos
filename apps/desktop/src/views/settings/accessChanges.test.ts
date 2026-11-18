import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeAccessChange, viaLabel } from './accessChanges.ts'

const grant = (userIds: string[] = [], managerIds: string[] = [], everyone = false) => ({
  everyone,
  userIds,
  managerIds,
})
const name = (id: string) => ({ leo: 'Leo', maya: 'Maya' })[id] ?? 'A former member'

test('each person given or losing use or management gets a line', () => {
  assert.deepEqual(
    describeAccessChange({ previous: grant(['maya']), next: grant(['leo'], ['maya']) }, name),
    ['Maya can now manage it', 'Leo can now use it'],
  )
})

test('managers count as users, and everyone covers anyone taken off the list', () => {
  assert.deepEqual(
    describeAccessChange({ previous: grant([], ['maya']), next: grant(['maya']) }, name),
    ['Maya no longer manages it'],
  )
  assert.deepEqual(
    describeAccessChange({ previous: grant(['leo'], [], true), next: grant([], [], true) }, name),
    ['No change to who can use it'],
  )
  assert.deepEqual(
    describeAccessChange({ previous: grant([], [], true), next: grant(['leo']) }, name),
    ['Stopped sharing with everyone in the team'],
  )
})

test('a computer handed to a new owner says who owns it now', () => {
  assert.deepEqual(
    describeAccessChange(
      { previous: grant(['leo']), next: grant(['leo']), owner: { from: 'gone', to: 'maya' } },
      name,
    ),
    ['Maya now owns it'],
  )
})

test('sharing with everyone, and a grant that stops, read plainly', () => {
  assert.deepEqual(describeAccessChange({ previous: grant(), next: grant([], [], true) }, name), [
    'Shared with everyone in the team',
  ])
  assert.deepEqual(describeAccessChange({ previous: grant(['leo'], [], true), next: null }, name), [
    'Stopped sharing with everyone in the team',
    'Leo can no longer use it',
  ])
  assert.deepEqual(describeAccessChange({ previous: grant(['gone']), next: grant() }, name), [
    'A former member can no longer use it',
  ])
})

test('a save that changed nothing still says so', () => {
  assert.deepEqual(describeAccessChange({ previous: grant(['leo']), next: grant(['leo']) }, name), [
    'No change to who can use it',
  ])
})

test('changes made from a chat or by leaving the team say how', () => {
  assert.equal(viaLabel('share'), null)
  assert.equal(viaLabel('conversation_invite'), 'when inviting them to a chat')
  assert.equal(viaLabel('team_removal'), 'removed from the team')
})
