import assert from 'node:assert/strict'
import test from 'node:test'

import { desktopTabId, planDesktopTabs } from './sessionDesktops.ts'

const tabsOf = (tabs: Record<string, { id: string; active: string }[]>) => (sessionId: string) =>
  tabs[sessionId] ?? []

test('opens a tab per desktop a session holds and closes the ones it lost', () => {
  const sessions = new Map([
    ['s1', { teamId: 't', displays: [2, 4] }],
    ['s2', { teamId: 't', displays: [] }],
  ])
  const plan = planDesktopTabs(
    sessions,
    tabsOf({
      s1: [
        { id: desktopTabId('s1', 2), active: 'team.desktop' },
        { id: desktopTabId('s1', 3), active: 'team.desktop' },
        // Navigated elsewhere by the user: no longer a desktop tab, so left alone.
        { id: desktopTabId('s1', 5), active: 'team.files' },
      ],
      s2: [{ id: desktopTabId('s2', 2), active: 'team.desktop' }],
      // Not published (its chat is off screen): untouched even though it has a desktop tab.
      s3: [{ id: desktopTabId('s3', 2), active: 'team.desktop' }],
    }),
  )

  assert.deepEqual(plan, {
    open: [{ sessionId: 's1', teamId: 't', display: 4 }],
    close: [desktopTabId('s1', 3), desktopTabId('s2', 2)],
  })
})
