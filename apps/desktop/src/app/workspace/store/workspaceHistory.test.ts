import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { createWorkspaceState, selectHistoryStep, selectMainPageTab } from './workspaceState.ts'
import { createWorkspaceStore } from './workspaceStore.ts'

import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'

function setup() {
  let seq = 0
  const createTab = (teamId: string): WorkspaceTabState => ({
    ...createWorkspaceTab(teamId),
    id: `tab-${String(++seq)}`,
  })
  const store = createWorkspaceStore(createWorkspaceState(), { createTab })

  store.actions.retainTeams([TEAM_A], TEAM_A)

  return { store, actions: store.actions }
}

const page = (active: string) => (tab: WorkspaceTabState) => ({ ...tab, active })

function shown(state: ReturnType<ReturnType<typeof setup>['store']['getState']>) {
  return state.mainPageOpen ? selectMainPageTab(state)?.active : state.sessionId
}

test('Back from a page opened in a chat returns to that chat, not an earlier page', () => {
  const { store, actions } = setup()

  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.selectSession('chat-1')
  actions.openMainPage(TEAM_A, page('team.agents'))
  assert.equal(selectHistoryStep(store.getState(), -1), 'surface')
  actions.stepSurface(-1)

  assert.equal(store.getState().mainPageOpen, false)
  assert.equal(store.getState().sessionId, 'chat-1')
})

test('chats and pages share one timeline in the order they were seen', () => {
  const { store, actions } = setup()

  actions.selectSession('chat-1')
  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.selectSession('chat-2')
  actions.openMainPage(TEAM_A, page('team.agents'))

  const seen = [shown(store.getState())]

  while (selectHistoryStep(store.getState(), -1)) {
    actions.stepSurface(-1)
    seen.push(shown(store.getState()))
  }
  assert.deepEqual(seen, ['team.agents', 'chat-2', 'team.inbox', 'chat-1'])

  actions.stepSurface(1)
  assert.equal(shown(store.getState()), 'team.inbox')
})

test('moving between pages records each page; Back restores the earlier page', () => {
  const { store, actions } = setup()

  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.openMainPage(TEAM_A, page('team.agents'))
  actions.stepSurface(-1)

  assert.equal(shown(store.getState()), 'team.inbox')
  actions.stepSurface(1)
  assert.equal(shown(store.getState()), 'team.agents')
})

test('a replace update (typing in a search box) does not add an entry', () => {
  const { store, actions } = setup()

  actions.openMainPage(TEAM_A, page('team.inbox'))
  const length = store.getState().surfaceHistory.length

  actions.updateActiveTab(page('team.inbox-search'), { history: 'replace' })
  assert.equal(store.getState().surfaceHistory.length, length)
})

test('jumping to an entry from the history menu shows it and keeps the rest', () => {
  const { store, actions } = setup()

  actions.selectSession('chat-1')
  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.selectSession('chat-2')
  const { surfaceHistory } = store.getState()
  const target = surfaceHistory.findIndex((entry) => entry.sessionId === 'chat-1')

  actions.goToSurface(target)
  assert.equal(shown(store.getState()), 'chat-1')
  assert.equal(store.getState().surfaceHistory.length, surfaceHistory.length)

  actions.openMainPage(TEAM_A, page('team.agents'))
  assert.equal(selectHistoryStep(store.getState(), 1), null)
})

test('updating the current page in place keeps Forward: A → B → Back → replace A → Forward is B', () => {
  const { store, actions } = setup()

  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.openMainPage(TEAM_A, page('team.agents'))
  actions.stepSurface(-1)
  assert.equal(shown(store.getState()), 'team.inbox')

  actions.updateActiveTab(page('team.inbox-search'), { history: 'replace' })
  assert.equal(shown(store.getState()), 'team.inbox-search')
  assert.equal(selectHistoryStep(store.getState(), 1), 'surface')
  actions.stepSurface(1)
  assert.equal(shown(store.getState()), 'team.agents')
  // Back now returns to the refined page, not the one it replaced.
  actions.stepSurface(-1)
  assert.equal(shown(store.getState()), 'team.inbox-search')
})

test('a new navigation from an earlier entry still drops the Forward entries', () => {
  const { store, actions } = setup()

  actions.openMainPage(TEAM_A, page('team.inbox'))
  actions.openMainPage(TEAM_A, page('team.agents'))
  actions.stepSurface(-1)
  actions.openMainPage(TEAM_A, page('team.runtimes'))
  assert.equal(selectHistoryStep(store.getState(), 1), null)
})
