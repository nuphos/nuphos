import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openDockTerminal } from './openDockTerminal.ts'
import { createWorkspaceState, selectBucket, selectCurrentBucket } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'

const request = { id: 'agent-terminal', teamId: 'team-a', sessionId: 'background-chat' }

test('opens the originating dock while another team, read-only chat or management page is visible', async () => {
  for (const mainPage of [false, true]) {
    const store = createWorkspaceStore(createWorkspaceState())

    store.actions.retainTeams(['team-a', 'team-b'], 'team-b')
    store.actions.selectSession('visible-chat', { teamId: 'team-b', readOnly: true })
    if (mainPage) store.actions.openMainPage('team-b')
    const before = store.getState()
    const visible = selectCurrentBucket(before)

    await openDockTerminal(store, request, async () => true)
    const after = store.getState()
    const dock = selectBucket(after, request.sessionId)

    assert.equal(after.sessionId, before.sessionId)
    assert.equal(after.mainPageOpen, before.mainPageOpen)
    assert.equal(after.teamScope?.teamId, before.teamScope?.teamId)
    assert.equal(selectCurrentBucket(after), visible)
    assert.equal(dock.dockOpen, true)
    assert.equal(dock.tabs[0]?.id, request.id)
    assert.equal(dock.tabs[0]?.scope.teamId, request.teamId)
    assert.equal(dock.tabs[0]?.active, 'team.terminal')
  }
})

test('opens from the home screen without any selected conversation', async () => {
  const store = createWorkspaceStore(createWorkspaceState())

  store.actions.retainTeams(['team-a'], 'team-a')
  await openDockTerminal(store, request, async () => true)
  assert.equal(store.getState().sessionId, null)
  assert.equal(selectBucket(store.getState(), request.sessionId).tabs[0]?.id, request.id)
})

test('another window that loses the claim does not create a duplicate tab', async () => {
  const store = createWorkspaceStore(createWorkspaceState())

  store.actions.retainTeams(['team-a'], 'team-a')
  await openDockTerminal(store, request, async () => false)
  assert.equal(selectBucket(store.getState(), request.sessionId).tabs.length, 0)
})
