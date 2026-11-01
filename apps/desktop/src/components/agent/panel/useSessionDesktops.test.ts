import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectBucket, createWorkspaceState } from '../../../app/workspace/store/workspaceState.ts'
import { createWorkspaceStore } from '../../../app/workspace/store/workspaceStore.ts'
import { syncDesktopTabs } from '../../../app/workspace/syncDesktopTabs.ts'
import { createWorkspaceTabFromNavigation } from '../../../app/workspaceTabFactory.ts'
import { navigationFromAppPath } from '../../../lib/appRoutes.ts'
import { publishSessionDesktops, subscribeSessionDesktops } from '../../../lib/sessionDesktops.ts'

import { surfaceAgentDesktop } from './useSessionDesktops.ts'

import type { Message } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

const holding = {
  state: 'active',
  tools: [{ id: 'd', status: 'running', desktop: { display: 3 } }],
} as RuntimeExecution
const ask = (id: string): Message => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: 'open a browser' }],
})
const reply = (toolName: string): Message => ({
  id: `a-${toolName}`,
  role: 'assistant',
  parts: [{ type: 'tool', toolCallId: toolName, toolName, state: 'output-available' }],
})

function desktopDock() {
  const store = createWorkspaceStore(createWorkspaceState())
  const unsubscribe = subscribeSessionDesktops(() => syncDesktopTabs(store))

  store.actions.retainTeams(['team-a'], 'team-a')
  publishSessionDesktops('chat', {
    teamId: 'team-a',
    desktops: [{ display: 3, title: 'Box 1 · :3' }],
  })

  return {
    store,
    dock: () => selectBucket(store.getState(), 'chat'),
    done: () => {
      unsubscribe()
      publishSessionDesktops('chat', null)
    },
  }
}

test('the dock opens and focuses the desktop when a running turn starts driving it', () => {
  const { dock, done } = desktopDock()
  const tab = { sessionId: 'chat', streaming: true, runtimeState: holding }

  surfaceAgentDesktop({ ...tab, messages: [ask('u1'), reply('Bash')] })
  assert.deepEqual(dock().tabs, [])
  surfaceAgentDesktop({ ...tab, messages: [ask('u1'), reply('mcp__nuphos-desktop__click')] })
  assert.equal(dock().dockOpen, true)
  assert.equal(dock().activeTabId, 'desktop:chat:3')
  done()
})

test('a desktop tab the user closed stays closed for the rest of that turn', () => {
  const { store, dock, done } = desktopDock()
  const turn = { sessionId: 'chat', streaming: true, runtimeState: holding }
  const messages = [ask('u2'), reply('mcp__nuphos-desktop__list_apps')]

  surfaceAgentDesktop({ ...turn, messages })
  store.actions.closeTab('desktop:chat:3')
  surfaceAgentDesktop({ ...turn, messages: [...messages, reply('mcp__nuphos-desktop__type_text')] })
  assert.deepEqual(dock().tabs, [])
  // The next turn that drives the desktop brings it back.
  surfaceAgentDesktop({
    ...turn,
    messages: [...messages, ask('u3'), reply('nuphos-desktop.click')],
  })
  assert.equal(dock().activeTabId, 'desktop:chat:3')
  done()
})

test('reopening a chat whose turn already ended, or someone else’s chat, opens nothing', () => {
  const { dock, done } = desktopDock()
  const messages = [ask('u4'), reply('mcp__nuphos-desktop__click')]

  surfaceAgentDesktop({ sessionId: 'chat', streaming: false, runtimeState: holding, messages })
  surfaceAgentDesktop({
    sessionId: 'chat',
    streaming: true,
    runtimeState: holding,
    foreign: true,
    messages,
  })
  surfaceAgentDesktop({ sessionId: 'chat', streaming: true, runtimeState: undefined, messages })
  assert.deepEqual(dock().tabs, [])
  done()
})

test('a local_browser tab opens a closed dock and takes focus, like the desktop does', () => {
  const { store, dock, done } = desktopDock()
  // The path browser-tabs.ts hands the app for local_browser "open".
  const navigation = navigationFromAppPath(
    '/teams/team-a/browser?url=https%3A%2F%2Fdash.cloudflare.com%2Fsign-up',
  )

  assert.ok(navigation)
  assert.equal(dock().dockOpen, false)
  store.actions.openTabInSession('chat', createWorkspaceTabFromNavigation(navigation))
  const [browser] = dock().tabs

  assert.equal(dock().dockOpen, true)
  assert.equal(browser.active, 'team.browser')
  assert.equal(dock().activeTabId, browser.id)
  done()
})
