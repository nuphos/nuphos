import assert from 'node:assert/strict'
import test from 'node:test'

import { serializeWorkspace } from '../../workspacePersistence.ts'
import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { agentTabSession, dockBrowserTabs } from './dockBrowserTabs.ts'
import { createWorkspaceState } from './workspaceState.ts'
import { hydrateWorkspaceState } from './workspaceStorePersistence.ts'

import type { TabBucket } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'

/** A browser tab on `url`, as one the user opened from New Tab is once it navigated. */
function browserTab(id: string, url: string, title: string): WorkspaceTabState {
  const tab = createWorkspaceTab(TEAM)
  const snapshot = { ...tab.navHistory[0], active: 'team.browser', browserUrl: url }

  return {
    ...tab,
    id,
    active: 'team.browser',
    browserUrl: url,
    navHistory: [snapshot],
    navHistoryIndex: 0,
    restoredTitle: title,
  } as WorkspaceTabState
}

const bucket = (tabs: WorkspaceTabState[]): TabBucket => ({
  tabs,
  activeTabId: tabs[0]?.id ?? null,
  mountedTabIds: new Set(),
  dockOpen: true,
})

test("lists a tab the user opened, and only the conversation's browser tabs", () => {
  const state = createWorkspaceState({
    mine: bucket([
      browserTab('b1', 'https://user.test/', 'Opened by hand'),
      createWorkspaceTab(TEAM),
    ]),
    other: bucket([browserTab('b2', 'https://other.test/', 'Not mine')]),
  })

  assert.deepEqual(dockBrowserTabs(state, 'mine'), [
    { id: 'b1', url: 'https://user.test/', title: 'Opened by hand' },
  ])
  assert.deepEqual(dockBrowserTabs(state, 'missing'), [])
})

test('lists a tab restored after a restart, from the persisted dock', () => {
  const persisted = serializeWorkspace(
    [browserTab('b1', 'https://restored.test/a', 'Restored page')],
    'b1',
  )

  assert.ok(persisted)
  const [tab] = dockBrowserTabs(hydrateWorkspaceState({ mine: persisted }), 'mine')

  assert.equal(tab?.url, 'https://restored.test/a')
  assert.equal(tab?.title, 'Restored page')
})

const channelAgents = (sessionId: string) => (sessionId === 'channel-1' ? ['agent-a'] : [])

test("an agent's browser tab opens in the channel on screen that the agent is in", () => {
  const showing = (sessionId: string, mainPageOpen = false) => ({
    ...createWorkspaceState(),
    sessionId,
    mainPageOpen,
  })

  assert.equal(agentTabSession(showing('channel-1'), 'agent-a', channelAgents), 'channel-1')
  // An agent outside that channel never puts its tab in front of the user.
  assert.equal(agentTabSession(showing('channel-1'), 'agent-b', channelAgents), 'agent-b')
  assert.equal(agentTabSession(showing('chat-2'), 'agent-a', channelAgents), 'agent-a')
  assert.equal(agentTabSession(showing('agent-a'), 'agent-a', channelAgents), 'agent-a')
  // A page in the main pane hides the channel, so the tab stays in the agent's dock.
  assert.equal(agentTabSession(showing('channel-1', true), 'agent-a', channelAgents), 'agent-a')
})
