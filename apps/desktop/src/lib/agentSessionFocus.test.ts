import assert from 'node:assert/strict'
import test from 'node:test'

import { findTabShowingSession, resolveAgentSessionFocus } from './agentSessionFocus.ts'

import type { FocusableTab } from './agentSessionFocus.ts'

function tab(
  id: string,
  teamId: string,
  agentSessionId: string | null = null,
  active = 'team.agent',
): FocusableTab {
  return { id, active, agentSessionId, scope: { kind: 'team', teamId } }
}

test('a tab showing the conversation full-page is activated', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1'), tab('b', 't1', 's1')],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    { kind: 'activate-tab', tabId: 'b' },
  )
})

test('a full-page tab wins over the sidebar holding the same session', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('b', 't1', 's1')],
      activeTabId: 'b',
      sidebarSessionId: 's1',
    }),
    { kind: 'activate-tab', tabId: 'b' },
  )
})

test('the tab in front wins when two tabs show the same conversation', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1', 's1'), tab('b', 't1', 's1')],
      activeTabId: 'b',
      sidebarSessionId: null,
    }),
    { kind: 'activate-tab', tabId: 'b' },
  )
})

test('a tab that navigated off the agent page does not absorb the focus', () => {
  // The tab keeps agentSessionId so Back returns to the chat, but it is showing
  // a resource page — activating it would leave the conversation off screen.
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1', 's1', 'team.pods'), tab('b', 't1', 's1')],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    { kind: 'activate-tab', tabId: 'b' },
  )
})

test('a stale session id on a navigated-away tab reopens instead of jumping there', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1', 's1', 'team.pods')],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    { kind: 'reopen', sessionId: 's1', teamId: 't1' },
  )
})

test('a tab holding the session under a non-team scope is not the agent page', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [
        {
          id: 'a',
          active: 'team.agent',
          agentSessionId: 's1',
          scope: { kind: 'cluster', teamId: 't1' },
        },
      ],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    { kind: 'reopen', sessionId: 's1', teamId: 't1' },
  )
})

test('a sidebar session leaves the tab in front alone when it is already in the team', () => {
  // One sidebar serves every tab of a team, so switching tabs would only throw
  // the user off whatever they were looking at.
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1'), tab('b', 't1', null, 'team.pods'), tab('c', 't1')],
      activeTabId: 'b',
      sidebarSessionId: 's1',
    }),
    { kind: 'open-sidebar', tabId: null },
  )
})

test('a sidebar session switches to its own team tab first', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't2',
      tabs: [tab('a', 't1'), tab('b', 't2')],
      activeTabId: 'a',
      sidebarSessionId: 's1',
    }),
    { kind: 'open-sidebar', tabId: 'b' },
  )
})

test('a sidebar session whose team has no tab left is reopened, not mis-scoped', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't9',
      tabs: [tab('a', 't1')],
      activeTabId: 'a',
      sidebarSessionId: 's1',
    }),
    { kind: 'reopen', sessionId: 's1', teamId: 't9' },
  )
})

test('a sidebar session with no team in the payload opens the sidebar in place', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      tabs: [tab('a', 't1')],
      activeTabId: 'a',
      sidebarSessionId: 's1',
    }),
    { kind: 'open-sidebar', tabId: null },
  )
})

test('a session mounted nowhere is reopened as its own tab', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1'), tab('b', 't1', 's2')],
      activeTabId: 'a',
      sidebarSessionId: 's3',
    }),
    { kind: 'reopen', sessionId: 's1', teamId: 't1' },
  )
})

test('a tab whose conversation was closed does not absorb the focus', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1', null), tab('b', 't1', null)],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    { kind: 'reopen', sessionId: 's1', teamId: 't1' },
  )
})

test('an unknown active tab id falls back to the first tab of the team', () => {
  assert.deepEqual(
    resolveAgentSessionFocus({
      sessionId: 's1',
      teamId: 't1',
      tabs: [tab('a', 't1'), tab('b', 't1')],
      activeTabId: null,
      sidebarSessionId: 's1',
    }),
    { kind: 'open-sidebar', tabId: 'a' },
  )
})

test('a missing session id resolves to nothing', () => {
  assert.equal(
    resolveAgentSessionFocus({
      sessionId: '',
      teamId: 't1',
      tabs: [tab('a', 't1')],
      activeTabId: 'a',
      sidebarSessionId: null,
    }),
    null,
  )
})

test('findTabShowingSession prefers the active tab and ignores tabs that left the agent page', () => {
  const tabs = [tab('a', 't1', 's1', 'team.overview'), tab('b', 't1', 's1'), tab('c', 't1', 's1')]

  assert.equal(findTabShowingSession(tabs, 's1', 'c')?.id, 'c')
  assert.equal(findTabShowingSession(tabs, 's1', 'a')?.id, 'b')
  assert.equal(findTabShowingSession(tabs, 's2', 'b'), undefined)
  assert.equal(findTabShowingSession(tabs, '', 'b'), undefined)
})
