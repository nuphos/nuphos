import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import { tabsEndingWithPane } from './paneClose.ts'
import { MAIN_PAGE_BUCKET_KEY, createWorkspaceState } from './store/workspaceState.ts'

import type { WorkspaceTabState } from '../workspaceTabState'
import type { TabBucket } from './store/workspaceState'

const tab = (id: string, patch: Partial<WorkspaceTabState> = {}): WorkspaceTabState => ({
  ...createWorkspaceTab('t'),
  id,
  ...patch,
})

const bucket = (tabs: WorkspaceTabState[]): TabBucket => ({
  tabs,
  activeTabId: tabs[0]?.id ?? null,
  mountedTabIds: new Set<string>(),
  dockOpen: true,
})

const ssh = (status: 'connecting' | 'connected') => ({
  instanceName: 'i',
  region: 'r',
  publicIp: null,
  username: null,
  sessionId: status === 'connected' ? 's' : null,
  status,
  error: null,
})

test('a closing pane ends its main-page tabs and connecting SSH tabs, not its chat docks', () => {
  const state = createWorkspaceState({
    [MAIN_PAGE_BUCKET_KEY]: bucket([tab('node-shell', { active: 'k8s.node' })]),
    'session-a': bucket([
      tab('shell', { active: 'team.terminal' }),
      tab('ssh-live', { sshTerminal: ssh('connected') }),
      tab('ssh-pending', { sshTerminal: ssh('connecting') }),
    ]),
  })

  assert.deepEqual(tabsEndingWithPane(state), ['node-shell', 'ssh-pending'])
})

test('a pane with only chat docks ends nothing', () => {
  const state = createWorkspaceState({
    'session-a': bucket([tab('shell', { active: 'team.terminal' })]),
  })

  assert.deepEqual(tabsEndingWithPane(state), [])
})
