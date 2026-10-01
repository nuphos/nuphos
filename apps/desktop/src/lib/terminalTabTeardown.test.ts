import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectExecScopes,
  collectLiveSshTabs,
  collectLocalTerminalTabIds,
  execScope,
  execScopeForTab,
  execSessionKey,
  planExecTeardown,
  planSshTeardown,
  planSshTeardownForLogout,
} from './terminalTabTeardown.ts'

import type { SshTabSnapshot } from './terminalTabTeardown.ts'

/** A tab holding an SSH terminal. `sessionId: null` = PTY still being opened. */
function sshTab(id: string, sessionId: string | null): SshTabSnapshot {
  return { id, sshTerminal: { sessionId } }
}

/** Any tab that is not an SSH terminal — a resource page, the agent, etc. */
function pageTab(id: string): SshTabSnapshot {
  return { id, sshTerminal: null }
}

/** What the observer does: diff the previous live map against the new tab list. */
function observe(prev: readonly SshTabSnapshot[], next: readonly SshTabSnapshot[]) {
  return planSshTeardown(collectLiveSshTabs(prev), collectLiveSshTabs(next))
}

test('collectLiveSshTabs keeps only SSH tabs, in tab order', () => {
  assert.deepEqual(
    [...collectLiveSshTabs([pageTab('a'), sshTab('b', 's-b'), pageTab('c'), sshTab('d', null)])],
    [
      ['b', 's-b'],
      ['d', null],
    ],
  )
})

test('a tab with a live SSH session disappearing closes its session and marks the tab', () => {
  assert.deepEqual(observe([sshTab('a', 's-a'), pageTab('b')], [pageTab('b')]), {
    closedTabIds: ['a'],
    sessionIdsToClose: ['s-a'],
  })
})

test('a departing tab whose session another live tab still holds is NOT closed', () => {
  // The render-time duplicate-id repair re-keys a tab: the id changes, the
  // terminal does not. Closing here would kill a session still on screen.
  assert.deepEqual(observe([sshTab('dupe', 's-1')], [sshTab('repaired', 's-1')]), {
    closedTabIds: ['dupe'],
    sessionIdsToClose: [],
  })
})

test('the session-id guard only spares the session that is actually still held', () => {
  // Two tabs leave; one of the two sessions was re-keyed onto a surviving tab.
  assert.deepEqual(
    observe(
      [sshTab('dupe', 's-1'), sshTab('gone', 's-2')],
      [sshTab('repaired', 's-1'), pageTab('other')],
    ),
    { closedTabIds: ['dupe', 'gone'], sessionIdsToClose: ['s-2'] },
  )
})

test('the session-id guard ignores a surviving tab that has no session yet', () => {
  // A surviving tab with sessionId null holds nothing, so it cannot vouch for a
  // departing tab that also has no session — and neither is closable anyway.
  assert.deepEqual(observe([sshTab('a', null), sshTab('b', 's-b')], [sshTab('a', null)]), {
    closedTabIds: ['b'],
    sessionIdsToClose: ['s-b'],
  })
})

test('a surviving tab whose sshTerminal goes null closes its session (deep-link retarget)', () => {
  // retargetWorkspaceTabToNavigation keeps the tab and clears its terminal.
  assert.deepEqual(observe([sshTab('a', 's-a')], [pageTab('a')]), {
    closedTabIds: ['a'],
    sessionIdsToClose: ['s-a'],
  })
})

test('a surviving tab with an unchanged session closes nothing', () => {
  assert.deepEqual(
    observe([sshTab('a', 's-a'), pageTab('b')], [sshTab('a', 's-a'), pageTab('b')]),
    { closedTabIds: [], sessionIdsToClose: [] },
  )
})

test('emptying the tab list closes every live session (team switch)', () => {
  assert.deepEqual(observe([sshTab('a', 's-a'), pageTab('b'), sshTab('c', 's-c')], []), {
    closedTabIds: ['a', 'c'],
    sessionIdsToClose: ['s-a', 's-c'],
  })
})

test('several tabs vanishing at once close all of their distinct sessions', () => {
  assert.deepEqual(
    observe([sshTab('a', 's-a'), sshTab('b', 's-b'), sshTab('c', 's-c')], [sshTab('b', 's-b')]),
    { closedTabIds: ['a', 'c'], sessionIdsToClose: ['s-a', 's-c'] },
  )
})

test('a tab that left is not torn down twice on the next observation', () => {
  // The observer advances its ref to the map it just diffed against, so the
  // second pass over the same tab list has nothing left to close.
  const before = collectLiveSshTabs([sshTab('a', 's-a'), sshTab('b', 's-b')])
  const after = collectLiveSshTabs([sshTab('b', 's-b')])

  assert.deepEqual(planSshTeardown(before, after), {
    closedTabIds: ['a'],
    sessionIdsToClose: ['s-a'],
  })
  assert.deepEqual(planSshTeardown(after, after), { closedTabIds: [], sessionIdsToClose: [] })
})

test('a departing tab whose PTY never arrived is marked but closes nothing', () => {
  assert.deepEqual(observe([sshTab('a', null)], []), {
    closedTabIds: ['a'],
    sessionIdsToClose: [],
  })
})

test('a tab gaining an SSH terminal is not a teardown', () => {
  assert.deepEqual(observe([pageTab('a')], [sshTab('a', 's-a')]), {
    closedTabIds: [],
    sessionIdsToClose: [],
  })
})

test('a tab swapping one session for another is not a departure', () => {
  // Same tab id, new terminal: the id survives, so the observer sees nothing
  // leave — the tab's own start path is what ends the PTY it replaced.
  assert.deepEqual(observe([sshTab('a', 's-old')], [sshTab('a', 's-new')]), {
    closedTabIds: [],
    sessionIdsToClose: [],
  })
})

test('logout tears down every SSH tab and leaves page tabs alone', () => {
  assert.deepEqual(
    planSshTeardownForLogout([
      sshTab('a', 's-a'),
      pageTab('b'),
      sshTab('c', null),
      sshTab('d', 's-d'),
    ]),
    { closedTabIds: ['a', 'c', 'd'], sessionIdsToClose: ['s-a', 's-d'] },
  )
})

test('logout with no SSH tabs plans nothing', () => {
  assert.deepEqual(planSshTeardownForLogout([pageTab('a'), pageTab('b')]), {
    closedTabIds: [],
    sessionIdsToClose: [],
  })
})

test('local terminal tabs are named by their own tab id', () => {
  assert.deepEqual(
    [
      ...collectLocalTerminalTabIds([
        { id: 'a', active: 'team.terminal' },
        { id: 'b', active: 'team.browser' },
        { id: 'c', active: 'team.terminal' },
      ]),
    ],
    ['a', 'c'],
  )
})

test('a tab that navigated off the terminal page is no longer a terminal tab', () => {
  const before = collectLocalTerminalTabIds([{ id: 'a', active: 'team.terminal' }])
  const after = collectLocalTerminalTabIds([{ id: 'a', active: 'team.agent' }])

  assert.deepEqual([...before], ['a'])
  assert.deepEqual([...after], [])
})

/** A tab with a pod/node detail open. */
function detailTab(
  id: string,
  context: string | null,
  kind: string | null,
  namespace: string | null,
  name = 'x',
) {
  return { id, kubeconfigContext: context, target: kind ? { kind, namespace, name } : null }
}

test('an exec scope names the pod or node a tab has open', () => {
  assert.equal(
    execScopeForTab(detailTab('t1', 'ctx', 'Pod', 'ns', 'web-0')),
    execScope('ctx', 'Pod', 'ns', 'web-0'),
  )
  assert.equal(
    execScopeForTab(detailTab('t1', 'ctx', 'Node', null, 'node-a')),
    execScope('ctx', 'Node', null, 'node-a'),
  )
})

test('a tab with nothing execable open has no scope', () => {
  // No detail open at all, a detail that has no shell, and a tab whose cluster
  // credential has not resolved yet.
  assert.equal(execScopeForTab(detailTab('t1', 'ctx', null, null)), null)
  assert.equal(execScopeForTab(detailTab('t1', 'ctx', 'Deployment', 'ns')), null)
  assert.equal(execScopeForTab(detailTab('t1', null, 'Pod', 'ns')), null)
})

test('two pods with a shared name prefix do not share a scope', () => {
  assert.notEqual(execScope('ctx', 'Pod', 'ns', 'web'), execScope('ctx', 'Pod', 'ns', 'web-0'))
  assert.notEqual(execScope('ctx', 'Pod', 'ns', 'web'), execScope('ctx', 'Pod', 'ns-2', 'web'))
})

test('a session key splits back into its tab and scope', () => {
  const scope = execScope('ctx', 'Pod', 'ns', 'web-0')

  assert.deepEqual(execSessionKey('tab-1', scope, 'app').split('\0'), ['tab-1', scope, 'app'])
})

test('an unchanged tab list plans no exec teardown', () => {
  const scopes = collectExecScopes([detailTab('t1', 'ctx', 'Pod', 'ns')])

  assert.deepEqual(
    planExecTeardown(scopes, collectExecScopes([detailTab('t1', 'ctx', 'Pod', 'ns')])),
    [],
  )
})

test('a tab that navigated to another pod tears down the old scope', () => {
  const before = collectExecScopes([detailTab('t1', 'ctx', 'Pod', 'ns', 'web-0')])
  const after = collectExecScopes([detailTab('t1', 'ctx', 'Pod', 'ns', 'web-1')])

  assert.deepEqual(planExecTeardown(before, after), [
    { tabId: 't1', scope: execScope('ctx', 'Pod', 'ns', 'web-1') },
  ])
})

test('a tab that closed its detail, or closed entirely, tears everything down', () => {
  const before = collectExecScopes([
    detailTab('t1', 'ctx', 'Pod', 'ns'),
    detailTab('t2', 'ctx', 'Node', null),
  ])
  const after = collectExecScopes([detailTab('t1', 'ctx', null, null)])

  assert.deepEqual(planExecTeardown(before, after), [
    { tabId: 't2', scope: null },
    { tabId: 't1', scope: null },
  ])
})
