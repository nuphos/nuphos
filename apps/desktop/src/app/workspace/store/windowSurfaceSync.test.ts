import assert from 'node:assert/strict'
import { test } from 'node:test'

import { serializeWorkspace } from '../../workspacePersistence.ts'
import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import {
  applyPaneSurface,
  createWindowSurfaceReporter,
  paneSurfaceOf,
  restoredPaneBucketKeys,
  restoredPaneSeed,
  restoredWindowSurface,
  windowSurfaceOf,
} from './windowSurfaceSync.ts'
import { MAIN_PAGE_BUCKET_KEY, createWorkspaceState } from './workspaceState.ts'
import { createWorkspaceStore } from './workspaceStore.ts'
import { hydrateWorkspaceState } from './workspaceStorePersistence.ts'

import type { WorkspaceState } from './workspaceState'
import type { PaneSurface, WindowSurface } from '../../../api/window-shell'
import type { PersistedWorkspaceBySession } from '../../workspacePersistence'
import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TEAM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'

function setup(initial: WorkspaceState = createWorkspaceState()) {
  let seq = 0
  const createTab = (teamId: string): WorkspaceTabState => ({
    ...createWorkspaceTab(teamId),
    id: `tab-${String(++seq)}`,
  })

  return createWorkspaceStore(initial, { createTab })
}

function chat(sessionId: string, teamId = TEAM_A): PaneSurface {
  return { sessionId, readOnly: false, teamId, mainPageOpen: false, dockOpen: false }
}

function strip(): PersistedWorkspaceBySession[string] {
  const tab = { ...createWorkspaceTab(TEAM_A), active: 'team.browser' }
  const persisted = serializeWorkspace([tab], tab.id)

  assert.ok(persisted)

  return persisted
}

test('a saved conversation reopens in its team', () => {
  const store = setup()

  applyPaneSurface(store, chat('session-1', TEAM_B))
  store.actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)

  assert.deepEqual(paneSurfaceOf(store.getState()), chat('session-1', TEAM_B))
})

test('a saved main page reopens on its team', () => {
  const store = setup()

  applyPaneSurface(store, { ...chat('session-1', TEAM_B), sessionId: null, mainPageOpen: true })
  store.actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)

  assert.equal(store.getState().mainPageOpen, true)
  assert.equal(paneSurfaceOf(store.getState())?.teamId, TEAM_B)
})

test('a deep link that already opened a conversation wins over the saved one', () => {
  const store = setup()

  store.actions.selectSession('from-deep-link', { teamId: TEAM_A })
  applyPaneSurface(store, chat('session-1'))

  assert.equal(store.getState().sessionId, 'from-deep-link')
})

test('a team the account has left does not survive the restore', () => {
  const store = setup()

  applyPaneSurface(store, { ...chat('session-1', TEAM_B), sessionId: null })
  store.actions.retainTeams([TEAM_A], TEAM_A)

  assert.equal(paneSurfaceOf(store.getState())?.teamId, TEAM_A)
})

test('a conversation that no longer opens is reported as gone', () => {
  const store = setup()

  applyPaneSurface(store, chat('deleted'))
  store.actions.retainTeams([TEAM_A], TEAM_A)
  store.actions.forgetSession('deleted')

  assert.equal(paneSurfaceOf(store.getState())?.sessionId, null)
})

test('an open dock reopens with its tabs, and stays closed once they are gone', () => {
  const withTabs = setup(hydrateWorkspaceState({ 'session-1': strip() }))
  const empty = setup()

  applyPaneSurface(withTabs, { ...chat('session-1'), dockOpen: true })
  applyPaneSurface(empty, { ...chat('session-2'), dockOpen: true })
  withTabs.actions.retainTeams([TEAM_A], TEAM_A)
  empty.actions.retainTeams([TEAM_A], TEAM_A)

  assert.equal(paneSurfaceOf(withTabs.getState())?.dockOpen, true)
  assert.equal(paneSurfaceOf(empty.getState())?.dockOpen, false)
})

test('a window is reported only once every pane knows its teams', () => {
  const left = setup()
  const right = setup()
  const layout = { direction: 'row' as const, children: [{ id: 'primary' }, { id: 'right' }] }
  const stores = new Map([
    ['primary', left],
    ['right', right],
  ])

  left.actions.retainTeams([TEAM_A], TEAM_A)
  assert.equal(windowSurfaceOf(layout, 'right', stores), null)
  right.actions.retainTeams([TEAM_A], TEAM_A)
  right.actions.selectSession('session-2', { teamId: TEAM_A })

  assert.deepEqual(windowSurfaceOf(layout, 'right', stores), {
    layout,
    activeId: 'right',
    panes: {
      primary: { ...chat('x'), sessionId: null },
      right: chat('session-2'),
    },
  })
  assert.equal(windowSurfaceOf(layout, 'right', new Map([['primary', left]])), null)
})

test('the saved first pane takes the id of the pane already mounted', () => {
  const saved: WindowSurface = {
    layout: {
      direction: 'column',
      children: [{ id: 'a' }, { direction: 'row', children: [{ id: 'primary' }, { id: 'b' }] }],
    },
    activeId: 'a',
    panes: { a: chat('s-a'), primary: chat('s-p'), b: chat('s-b') },
  }

  assert.deepEqual(restoredWindowSurface(saved, 'primary'), {
    layout: {
      direction: 'column',
      children: [{ id: 'primary' }, { direction: 'row', children: [{ id: 'a' }, { id: 'b' }] }],
    },
    activeId: 'primary',
    panes: { primary: chat('s-a'), a: chat('s-p'), b: chat('s-b') },
  })
})

test('a restored split pane takes its dock over from the first pane, leaving one copy', () => {
  const first = setup(
    hydrateWorkspaceState({
      'session-1': strip(),
      'session-2': strip(),
      [MAIN_PAGE_BUCKET_KEY]: strip(),
    }),
  )
  const pane = chat('session-2', TEAM_B)
  const taken = first.getState().buckets['session-2'].tabs.map((tab) => tab.id)
  const seed = restoredPaneSeed(pane, first.getState())

  first.actions.releaseBuckets(restoredPaneBucketKeys(pane))

  assert.deepEqual(Object.keys(seed.buckets), ['session-2'])
  assert.deepEqual(
    seed.buckets['session-2'].tabs.map((tab) => tab.id),
    taken,
  )
  assert.deepEqual(seed.teamScope, { kind: 'team', teamId: TEAM_B })
  assert.equal(seed.sessionId, null)
  assert.deepEqual(
    Object.keys(first.getState().buckets).sort(),
    [MAIN_PAGE_BUCKET_KEY, 'session-1'].sort(),
  )
})

test('the reporter sends each distinct window surface once', () => {
  const reported: WindowSurface[] = []
  const report = createWindowSurfaceReporter({ reportWindowSurface: (s) => reported.push(s) })
  const surface: WindowSurface = {
    layout: { id: 'primary' },
    activeId: 'primary',
    panes: { primary: chat('s') },
  }

  report(surface)
  report({ ...surface })
  report({ ...surface, panes: { primary: chat('t') } })

  assert.equal(reported.length, 2)
})
