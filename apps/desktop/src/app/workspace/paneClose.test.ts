import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../workspaceTabFactory.ts'

import { closeOtherPanes, tabsEndingWithPane } from './paneClose.ts'
import { MAIN_PAGE_BUCKET_KEY, createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'

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

test('a team switch closes every other pane and hands their chat docks to the one kept', () => {
  const kept = createWorkspaceStore(createWorkspaceState({ 'session-a': bucket([tab('a')]) }))
  const other = createWorkspaceStore(
    createWorkspaceState({
      [MAIN_PAGE_BUCKET_KEY]: bucket([tab('page', { active: 'k8s.node' })]),
      'session-b': bucket([tab('b', { active: 'team.terminal' })]),
    }),
  )
  const layout = {
    direction: 'row' as const,
    children: [
      { id: 'kept' },
      { direction: 'column' as const, children: [{ id: 'x' }, { id: 'y' }] },
    ],
  }

  const closed = closeOtherPanes(
    layout,
    'kept',
    new Map([
      ['kept', kept],
      ['x', other],
    ]),
  )

  assert.deepEqual(closed, ['x', 'y'])
  assert.deepEqual(other.getState().buckets[MAIN_PAGE_BUCKET_KEY]?.tabs ?? [], [])
  assert.deepEqual(
    kept.getState().buckets['session-b']?.tabs.map((item) => item.id),
    ['b'],
  )
})
