import assert from 'node:assert/strict'
import { test } from 'node:test'

import { serializeWorkspace } from '../../workspacePersistence.ts'
import { createWorkspaceTab } from '../../workspaceTabFactory.ts'
import { NO_SESSION_TAB_BUCKET_KEY } from '../../workspaceTabState.ts'

import {
  MAIN_PAGE_BUCKET_KEY,
  createWorkspaceState,
  currentSessionKey,
  selectActiveTab,
  selectBucket,
  selectScope,
  sidebarSurface,
} from './workspaceState.ts'
import { createWorkspaceStore } from './workspaceStore.ts'
import { hydrateWorkspaceState } from './workspaceStorePersistence.ts'

import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM_A = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TEAM_B = 'bbbbbbbbbbbbbbbbbbbbbbbb'

function setup() {
  let seq = 0
  const createTab = (teamId: string): WorkspaceTabState => ({
    ...createWorkspaceTab(teamId),
    id: `tab-${String(++seq)}`,
  })
  const store = createWorkspaceStore(createWorkspaceState(), { createTab })

  store.actions.retainTeams([TEAM_A, TEAM_B], TEAM_A)
  store.actions.selectSession('chat-1')
  store.actions.setDockOpen(true)

  return { store, actions: store.actions }
}

function openTriggers(actions: ReturnType<typeof setup>['actions'], teamId = TEAM_A) {
  actions.openMainPage(teamId)
  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.inbox' }))
}

test('a management page replaces the chat surface without touching its dock', () => {
  const { store, actions } = setup()
  const chatDock = selectBucket(store.getState(), 'chat-1')

  openTriggers(actions)
  const state = store.getState()

  assert.equal(state.mainPageOpen, true)
  assert.equal(currentSessionKey(state), MAIN_PAGE_BUCKET_KEY)
  assert.equal(selectActiveTab(state)?.active, 'team.inbox')
  assert.equal(selectBucket(state, 'chat-1'), chatDock)
  assert.equal(chatDock.dockOpen, true)
})

test('selecting a chat or New chat returns to the chat surface as it was', () => {
  const { store, actions } = setup()
  const chatDock = selectBucket(store.getState(), 'chat-1')

  openTriggers(actions)
  actions.selectSession('chat-1')
  assert.equal(store.getState().mainPageOpen, false)
  assert.equal(currentSessionKey(store.getState()), 'chat-1')
  assert.equal(selectBucket(store.getState(), 'chat-1'), chatDock)

  actions.selectSession(null)
  openTriggers(actions)
  actions.selectSession(null)
  assert.equal(store.getState().mainPageOpen, false)
})

test('a conversation starting in the background keeps the management page', () => {
  const { store, actions } = setup()

  actions.selectSession(null)
  openTriggers(actions)
  actions.selectSession('chat-new', { keepMainPage: true })

  assert.equal(store.getState().mainPageOpen, true)
  assert.equal(store.getState().sessionId, 'chat-new')
})

test('the main page is global: it keeps its page across chats and resets on a new team', () => {
  const { store, actions } = setup()

  openTriggers(actions)
  const tabId = selectActiveTab(store.getState())?.id

  actions.selectSession('chat-2')
  actions.openMainPage(TEAM_A)
  assert.equal(selectActiveTab(store.getState())?.id, tabId)
  assert.equal(selectActiveTab(store.getState())?.active, 'team.inbox')

  actions.openMainPage(TEAM_B)
  assert.notEqual(selectActiveTab(store.getState())?.id, tabId)
  assert.equal(selectActiveTab(store.getState())?.scope.teamId, TEAM_B)
})

test('a new tab opened from a management page lands in the chat’s dock', () => {
  const { store, actions } = setup()

  actions.setDockOpen(false)
  openTriggers(actions)
  actions.openTab({ ...createWorkspaceTab(TEAM_A), id: 'beside' })
  const state = store.getState()

  assert.equal(state.mainPageOpen, false)
  assert.equal(selectBucket(state, 'chat-1').activeTabId, 'beside')
  assert.equal(selectBucket(state, 'chat-1').dockOpen, true)
  assert.equal(selectBucket(state, MAIN_PAGE_BUCKET_KEY).tabs.length, 1)
})

test('closing the management page’s tab returns to chat', () => {
  const { store, actions } = setup()

  openTriggers(actions)
  const tabId = selectActiveTab(store.getState())?.id

  assert.ok(tabId)
  actions.closeTab(tabId)

  assert.equal(store.getState().mainPageOpen, false)
  assert.equal(currentSessionKey(store.getState()), 'chat-1')
})

test('switching team from a management page switches the chat surface', () => {
  const { store, actions } = setup()

  openTriggers(actions)
  actions.switchTeam(TEAM_B)

  assert.equal(store.getState().mainPageOpen, false)
  assert.equal(selectActiveTab(store.getState())?.scope.teamId, TEAM_B)
})

test('the sidebar highlights the main page, or the chat when the chat surface shows', () => {
  assert.deepEqual(sidebarSurface(true, false, 'team.inbox'), {
    dynamicNavigation: false,
    active: 'team.inbox',
    chatShown: false,
  })
  assert.deepEqual(sidebarSurface(false, false, 'team.integrations'), {
    dynamicNavigation: false,
    active: '',
    chatShown: true,
  })
  assert.deepEqual(sidebarSurface(false, true, 'aws.s3'), {
    dynamicNavigation: true,
    active: 'aws.s3',
    chatShown: true,
  })
  assert.equal(sidebarSurface(true, true, 'team.inbox').dynamicNavigation, false)
})

test('a dock tab navigating to a management page stays put; the page opens in the main pane', () => {
  const { store, actions } = setup()

  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.architecture' }))
  const dockTab = selectActiveTab(store.getState())

  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.plans', filter: 'plan=3' }))
  const state = store.getState()
  const chatDock = selectBucket(state, 'chat-1')

  assert.equal(state.mainPageOpen, true)
  assert.equal(selectActiveTab(state)?.active, 'team.plans')
  assert.equal(selectActiveTab(state)?.filter, 'plan=3')
  assert.notEqual(selectActiveTab(state)?.id, dockTab?.id)
  assert.deepEqual(chatDock.tabs, [dockTab])
  assert.equal(chatDock.dockOpen, true)
})

test('a management tab opened into a dock is dropped there and shown in the main pane', () => {
  const { store, actions } = setup()

  actions.setDockOpen(false)
  const before = selectBucket(store.getState(), 'chat-1')

  actions.openTab(
    { ...createWorkspaceTab(TEAM_A), id: 'reopened', active: 'team.inbox' },
    { openDock: true },
  )
  const state = store.getState()

  assert.equal(state.mainPageOpen, true)
  assert.equal(selectActiveTab(state)?.active, 'team.inbox')
  assert.deepEqual(selectBucket(state, 'chat-1').tabs, before.tabs)
  assert.equal(selectBucket(state, 'chat-1').dockOpen, false)
})

test('a dock tab navigating to Connectors stays put and opens the dialog on its connector', () => {
  const { store, actions } = setup()

  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.architecture' }))
  const dockTab = selectActiveTab(store.getState())

  actions.updateActiveTab((tab) => ({
    ...tab,
    active: 'team.integrations',
    connectorDetail: { provider: 'aws', connectorId: 'c-1', name: 'Prod' },
  }))
  const state = store.getState()

  assert.equal(state.mainPageOpen, false)
  assert.equal(selectActiveTab(state), dockTab)
  assert.equal(selectBucket(state, 'chat-1').dockOpen, true)
  assert.deepEqual(state.connectorsDialog, {
    detail: { provider: 'aws', connectorId: 'c-1', name: 'Prod' },
    addIntegrationOpen: false,
  })
  assert.equal(dockTab?.navHistory.at(-1)?.active, 'team.architecture')

  actions.setConnectorsDialog(null)
  assert.equal(store.getState().connectorsDialog, null)
  assert.equal(selectActiveTab(store.getState()), dockTab)
})

test('opening Connectors as a main page from a chat keeps the chat and opens the dialog', () => {
  const { store, actions } = setup()
  const before = store.getState()

  actions.openMainPage(TEAM_A, (tab) => ({ ...tab, active: 'team.accounts' }))
  const state = store.getState()

  assert.equal(state.mainPageOpen, false)
  assert.equal(state.sessionId, 'chat-1')
  assert.equal(MAIN_PAGE_BUCKET_KEY in state.buckets, false)
  assert.equal(state.surfaceHistory, before.surfaceHistory)
  assert.deepEqual(state.connectorsDialog, { detail: null, addIntegrationOpen: false })
})

test('a main page leaving for Connectors stays on its page under the dialog', () => {
  const { store, actions } = setup()

  openTriggers(actions)
  const mainTab = selectActiveTab(store.getState())

  actions.updateActiveTab((tab) => ({
    ...tab,
    active: 'team.integrations',
    addIntegrationOpen: true,
  }))
  const state = store.getState()

  assert.equal(state.mainPageOpen, true)
  assert.equal(selectActiveTab(state), mainTab)
  assert.deepEqual(state.connectorsDialog, { detail: null, addIntegrationOpen: true })
})

test('connector scopes may still live in a dock', () => {
  const { store, actions } = setup()

  actions.updateActiveTab((tab) => ({
    ...tab,
    scope: { kind: 'aws-account', teamId: TEAM_A, accountId: 'acct' },
    active: 'aws.overview',
  }))

  assert.equal(store.getState().mainPageOpen, false)
  assert.equal(selectActiveTab(store.getState())?.scope.kind, 'aws-account')
})

test('restoring drops management tabs from docks but keeps the main page', () => {
  const tabs = ['team.architecture', 'team.inbox'].map((active) => {
    const tab = createWorkspaceTab(TEAM_A)

    return { ...tab, active, navHistory: [{ ...tab.navHistory[0], active }] }
  })
  const strip = serializeWorkspace(tabs, tabs[1].id)
  const managementOnly = serializeWorkspace([tabs[1]], tabs[1].id)

  assert.ok(strip && managementOnly)
  const state = hydrateWorkspaceState({
    'chat-1': strip,
    'chat-2': managementOnly,
    [MAIN_PAGE_BUCKET_KEY]: managementOnly,
  })

  assert.deepEqual(
    state.buckets['chat-1'].tabs.map((tab) => tab.active),
    ['team.architecture'],
  )
  assert.equal('chat-2' in state.buckets, false)
  assert.equal(state.buckets[MAIN_PAGE_BUCKET_KEY].tabs[0].active, 'team.inbox')
})

test('restored tabs load nothing until the teams arrive, then a team the account left is dropped', () => {
  const gone = 'dddddddddddddddddddddddd'
  const opened = createWorkspaceTab(gone)
  const management = {
    ...opened,
    active: 'team.inbox',
    navHistory: [{ ...opened.navHistory[0], active: 'team.inbox' }],
  }
  const dock = createWorkspaceTab(gone)
  const main = serializeWorkspace([management], management.id)
  const strip = serializeWorkspace([dock], dock.id)

  assert.ok(main && strip)
  let seq = 0
  const store = createWorkspaceStore(
    hydrateWorkspaceState({ [NO_SESSION_TAB_BUCKET_KEY]: strip, [MAIN_PAGE_BUCKET_KEY]: main }),
    { createTab: (teamId) => ({ ...createWorkspaceTab(teamId), id: `tab-${String(++seq)}` }) },
  )

  assert.equal(selectScope(store.getState()), null)
  store.actions.retainTeams([TEAM_A], TEAM_A)
  const state = store.getState()

  assert.deepEqual(selectScope(state), { kind: 'team', teamId: TEAM_A })
  assert.equal(
    Object.values(state.buckets).some((bucket) =>
      bucket.tabs.some((tab) => tab.scope.teamId === gone),
    ),
    false,
  )
})

test('Plans opens in the main pane without replacing the current chat or dock', () => {
  const { store, actions } = setup()
  const dock = selectBucket(store.getState(), 'chat-1')

  actions.updateActiveTab((tab) => ({ ...tab, active: 'team.plans' }))

  assert.equal(store.getState().mainPageOpen, true)
  assert.equal(store.getState().sessionId, 'chat-1')
  assert.equal(selectActiveTab(store.getState())?.active, 'team.plans')
  assert.deepEqual(selectBucket(store.getState(), 'chat-1'), dock)

  actions.selectSession('chat-1')
  assert.equal(store.getState().mainPageOpen, false)
  assert.deepEqual(selectBucket(store.getState(), 'chat-1'), dock)
})
