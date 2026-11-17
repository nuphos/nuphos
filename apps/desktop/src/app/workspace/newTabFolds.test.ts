import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadGroupState } from '../../components/sidebar/state.ts'

import { browsableOptions, isNewTabGroupCollapsed, toggleNewTabGroup } from './newTabFolds.ts'

const values = new Map<string, string>()

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  },
  window: new EventTarget(),
})

beforeEach(() => values.clear())

const TEAM = 'team-a'
const recent = { key: 'recent', options: ['Inbox', 'Runtimes'] }
const workspace = { key: 'workspace', defaultCollapsed: true, options: ['Files', 'Browser'] }
const collapsed = (group: { key: string; defaultCollapsed?: boolean }) =>
  isNewTabGroupCollapsed(loadGroupState(TEAM), group)

test('a group nobody has toggled follows its default', () => {
  assert.equal(collapsed(recent), false)
  assert.equal(collapsed(workspace), true)
})

test('a toggle overrides the default and is kept per team', () => {
  toggleNewTabGroup(TEAM, workspace)
  toggleNewTabGroup(TEAM, recent)

  assert.equal(collapsed(workspace), false)
  assert.equal(collapsed(recent), true)
  assert.equal(isNewTabGroupCollapsed(loadGroupState('team-b'), workspace), true)
})

test('New tab folds do not touch a sidebar group with the same title', () => {
  toggleNewTabGroup(TEAM, { key: 'Workspace' })

  assert.equal(loadGroupState(TEAM).Workspace, undefined)
})

test('arrow keys move only through rows of unfolded groups', () => {
  assert.deepEqual(browsableOptions([recent, workspace], collapsed), ['Inbox', 'Runtimes'])

  toggleNewTabGroup(TEAM, workspace)

  assert.deepEqual(browsableOptions([recent, workspace], collapsed), [
    'Inbox',
    'Runtimes',
    'Files',
    'Browser',
  ])
})
