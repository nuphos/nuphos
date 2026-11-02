import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { applyWindowSurface, syncWindowSurface, windowSurfaceOf } from './windowSurfaceSync.ts'
import { createWorkspaceState } from './workspaceState.ts'
import { createWorkspaceStore } from './workspaceStore.ts'

import type { WindowSurface } from '../../../api/window-shell'
import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TEAM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'

function setup() {
  let seq = 0
  const createTab = (teamId: string): WorkspaceTabState => ({
    ...createWorkspaceTab(teamId),
    id: `tab-${String(++seq)}`,
  })

  return createWorkspaceStore(createWorkspaceState(), { createTab })
}

function chat(sessionId: string, teamId = TEAM_A): WindowSurface {
  return { sessionId, readOnly: false, teamId, mainPageOpen: false }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a saved conversation reopens in its team', () => {
  const store = setup()

  applyWindowSurface(store, chat('session-1', TEAM_B))
  store.actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)

  assert.deepEqual(windowSurfaceOf(store.getState()), chat('session-1', TEAM_B))
})

test('a saved main page reopens on its team', () => {
  const store = setup()

  applyWindowSurface(store, {
    sessionId: null,
    readOnly: false,
    teamId: TEAM_B,
    mainPageOpen: true,
  })
  store.actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)

  assert.equal(store.getState().mainPageOpen, true)
  assert.equal(windowSurfaceOf(store.getState())?.teamId, TEAM_B)
})

test('a deep link that already opened a conversation wins over the saved one', () => {
  const store = setup()

  store.actions.selectSession('from-deep-link', { teamId: TEAM_A })
  applyWindowSurface(store, chat('session-1'))

  assert.equal(store.getState().sessionId, 'from-deep-link')
})

test('a team the account has left does not survive the restore', () => {
  const store = setup()

  applyWindowSurface(store, {
    sessionId: null,
    readOnly: false,
    teamId: TEAM_B,
    mainPageOpen: false,
  })
  store.actions.retainTeams([TEAM_A], TEAM_A)

  assert.equal(windowSurfaceOf(store.getState())?.teamId, TEAM_A)
})

test('nothing is reported until the teams arrive, then each change once', async () => {
  const store = setup()
  const reported: WindowSurface[] = []

  syncWindowSurface(store, {
    takeWindowSurface: () => Promise.resolve(chat('session-1')),
    reportWindowSurface: (surface) => reported.push(surface),
  })
  await settle()
  assert.deepEqual(reported, [])

  store.actions.retainTeams([TEAM_A], TEAM_A)
  store.actions.setDockOpen(true)
  store.actions.selectSession('session-2', { teamId: TEAM_A })

  assert.deepEqual(reported, [chat('session-1'), chat('session-2')])
})

test('a conversation that no longer opens is reported as gone', async () => {
  const store = setup()
  const reported: WindowSurface[] = []

  syncWindowSurface(store, {
    takeWindowSurface: () => Promise.resolve(chat('deleted')),
    reportWindowSurface: (surface) => reported.push(surface),
  })
  await settle()
  store.actions.retainTeams([TEAM_A], TEAM_A)
  store.actions.forgetSession('deleted')

  assert.equal(reported.at(-1)?.sessionId, null)
})

test('a workspace unmounted before the saved surface arrives leaves the store alone', async () => {
  const store = setup()
  const reported: WindowSurface[] = []
  const stop = syncWindowSurface(store, {
    takeWindowSurface: () => Promise.resolve(chat('session-1')),
    reportWindowSurface: (surface) => reported.push(surface),
  })

  stop()
  await settle()
  store.actions.retainTeams([TEAM_A], TEAM_A)

  assert.equal(store.getState().sessionId, null)
  assert.deepEqual(reported, [])
})
