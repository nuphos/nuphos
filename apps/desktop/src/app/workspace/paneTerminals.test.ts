import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import { paneTerminalCount } from './paneTerminals.ts'
import { createWorkspaceState } from './store/workspaceState.ts'

const tab = (id: string, active: string) => ({ ...createWorkspaceTab('t'), id, active })

test('counts terminal tabs across every chat a pane holds', () => {
  const state = createWorkspaceState()

  assert.equal(paneTerminalCount(state), 0)
  const busy = {
    ...state,
    buckets: {
      a: {
        tabs: [tab('1', 'team.terminal'), tab('2', 'team.browser')],
        activeTabId: '1',
        mountedTabIds: new Set<string>(),
        dockOpen: true,
      },
      b: {
        tabs: [tab('3', 'team.terminal')],
        activeTabId: '3',
        mountedTabIds: new Set<string>(),
        dockOpen: true,
      },
    },
  }

  assert.equal(paneTerminalCount(busy as typeof state), 2)
})
