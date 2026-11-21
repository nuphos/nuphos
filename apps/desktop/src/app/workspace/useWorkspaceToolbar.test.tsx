import assert from 'node:assert/strict'

import { test } from 'bun:test'

import { showsListControls } from './useWorkspaceToolbar'

import type { Scope } from '../../types'

const scope = { kind: 'team', teamId: 'team' } as Scope
const page = (active: string) => ({ active }) as Parameters<typeof showsListControls>[1]

test('the Inbox page has no toolbar search: it sits in the sidebar, above the list it filters', () => {
  assert.equal(showsListControls(scope, page('team.inbox')), false)
  assert.equal(showsListControls(scope, page('team.members')), true, 'a list page keeps its search')
})
