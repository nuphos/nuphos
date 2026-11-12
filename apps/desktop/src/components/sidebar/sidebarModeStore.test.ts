import assert from 'node:assert/strict'
import { test } from 'node:test'

import { setSidebarMode, sidebarMode, subscribeSidebarMode } from './sidebarModeStore.ts'

test('sidebar and main pane share one mode even when neither has a conversation', () => {
  const team = 'empty-mode-test'
  let notifications = 0
  const off = subscribeSidebarMode(() => {
    notifications += 1
  })

  assert.equal(sidebarMode(team, 0), 0)
  setSidebarMode(team, 1)
  assert.equal(sidebarMode(team, 0), 1)
  setSidebarMode(team, 0)
  assert.equal(
    sidebarMode(team, 1),
    0,
    'a stale session fallback cannot override explicit Bots mode',
  )
  assert.equal(sidebarMode('another-empty-team', 1), 1)
  assert.equal(notifications, 2)
  off()
  setSidebarMode(team, 1)
  assert.equal(notifications, 2)
})
