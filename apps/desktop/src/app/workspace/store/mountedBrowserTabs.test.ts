import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceTab } from '../../workspaceTabFactory.ts'

import { selectMountedBrowserTabs } from './workspaceState.ts'

import type { TabBucket } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'

const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa'

function tab(id: string, active: string): WorkspaceTabState {
  return { ...createWorkspaceTab(TEAM), id, active }
}

function bucket(
  tabs: WorkspaceTabState[],
  activeTabId: string | null,
  mounted: string[],
): TabBucket {
  return { tabs, activeTabId, mountedTabIds: new Set(mounted), dockOpen: true }
}

test('browser panes are collected from every session, not just the visible one', () => {
  const buckets = {
    s1: bucket([tab('t1', 'team.browser')], 't1', ['t1']),
    s2: bucket([tab('t2', 'team.browser'), tab('t3', 'team.terminal')], 't2', ['t2', 't3']),
  }

  assert.deepEqual(
    selectMountedBrowserTabs(buckets).map((t) => t.id),
    ['t1', 't2'],
  )
})

test('a browser tab nobody has opened yet is left alone', () => {
  // Restored from disk: in the strip, never activated, so it has no webview and
  // mounting it here would load a page the user has not asked for.
  const buckets = {
    s1: bucket([tab('t1', 'team.browser'), tab('t2', 'team.browser')], 't2', ['t2']),
  }

  assert.deepEqual(
    selectMountedBrowserTabs(buckets).map((t) => t.id),
    ['t2'],
  )
})

test('the active tab counts as mounted even before the keep-alive set catches up', () => {
  const buckets = { s1: bucket([tab('t1', 'team.browser')], 't1', []) }

  assert.deepEqual(
    selectMountedBrowserTabs(buckets).map((t) => t.id),
    ['t1'],
  )
})
