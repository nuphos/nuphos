import { MAX_RESIDENT_SESSION_TAB_BUCKETS } from '../../workspaceTabState.ts'

import {
  MAIN_PAGE_BUCKET_KEY,
  currentSessionKey,
  isManagementTab,
  selectActiveTab,
  selectBucket,
  teamScopeOf,
} from './workspaceState.ts'

import type { WorkspaceStoreDeps } from './workspaceActions'
import type { TabBucket, WorkspaceState } from './workspaceState'
import type { WorkspaceTabState } from '../../workspaceTabState'

/** Repairs duplicate tab ids (a corrupted restored snapshot) so nothing
 *  downstream ever keys two tabs the same. */
function dedupeTabIds(tabs: WorkspaceTabState[]): WorkspaceTabState[] {
  const seen = new Set<string>()
  const repaired: WorkspaceTabState[] = []

  for (const tab of tabs) {
    let { id } = tab
    let copy = 2

    while (seen.has(id)) {
      id = `${tab.id}#${String(copy)}`
      copy += 1
    }
    seen.add(id)
    repaired.push(id === tab.id ? tab : { ...tab, id })
  }

  return repaired.every((tab, index) => tab === tabs[index]) ? tabs : repaired
}

function keepAliveSet(
  tabs: WorkspaceTabState[],
  activeTabId: string | null,
  previous: ReadonlySet<string>,
): ReadonlySet<string> {
  const mounted = new Set(
    tabs.filter((tab) => tab.id === activeTabId || previous.has(tab.id)).map((tab) => tab.id),
  )
  const unchanged = mounted.size === previous.size && [...mounted].every((id) => previous.has(id))

  return unchanged ? previous : mounted
}

/**
 * The per-bucket invariants, applied after every write:
 * - an open dock always has a tab when a team is known to seed one from;
 * - the active tab id names a tab in the strip;
 * - the keep-alive set holds only live tabs, plus the active one;
 * - a bucket with no tabs and a closed dock carries nothing, so it is dropped.
 */
export function normalizeBucket(
  bucket: TabBucket,
  teamId: string | null,
  deps: WorkspaceStoreDeps,
): TabBucket | null {
  let tabs = dedupeTabIds(bucket.tabs)
  let { activeTabId } = bucket

  if (bucket.dockOpen && tabs.length === 0 && teamId) {
    const seeded = deps.createTab(teamId)

    tabs = [seeded]
    activeTabId = seeded.id
  }
  if (tabs.length === 0 && !bucket.dockOpen) return null
  if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs.at(0)?.id ?? null
  const mountedTabIds = keepAliveSet(tabs, activeTabId, bucket.mountedTabIds)

  if (
    tabs === bucket.tabs &&
    activeTabId === bucket.activeTabId &&
    mountedTabIds === bucket.mountedTabIds
  ) {
    return bucket
  }

  return { ...bucket, tabs, activeTabId, mountedTabIds }
}

/**
 * A dock tab that lands on a management page is put back as it was (a new tab
 * is dropped, the dock keeps its open state) and the page opens in the main
 * pane instead.
 */
function divertManagementPages(
  prev: WorkspaceState,
  next: WorkspaceState,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  const buckets = { ...next.buckets }
  let diverted: WorkspaceTabState | null = null

  for (const [key, bucket] of Object.entries(next.buckets)) {
    if (key === MAIN_PAGE_BUCKET_KEY || bucket === prev.buckets[key]) continue
    if (!bucket.tabs.some(isManagementTab)) continue
    const before = selectBucket(prev, key)
    const tabs: WorkspaceTabState[] = []

    for (const tab of bucket.tabs) {
      const kept = before.tabs.find((item) => item.id === tab.id)

      if (!isManagementTab(tab)) tabs.push(tab)
      else if (kept && !isManagementTab(kept)) tabs.push(kept)
      if (isManagementTab(tab) && kept !== tab && (!diverted || tab.id === bucket.activeTabId)) {
        diverted = tab
      }
    }
    const activeTabId = tabs.some((tab) => tab.id === bucket.activeTabId)
      ? bucket.activeTabId
      : before.activeTabId

    buckets[key] = { ...bucket, tabs, activeTabId, dockOpen: before.dockOpen }
  }
  if (!diverted) return { ...next, buckets }
  const mainTab = { ...diverted, id: deps.createTab(diverted.scope.teamId).id }

  buckets[MAIN_PAGE_BUCKET_KEY] = {
    ...selectBucket(next, MAIN_PAGE_BUCKET_KEY),
    tabs: [mainTab],
    activeTabId: mainTab.id,
  }

  return { ...next, buckets, mainPageOpen: true }
}

function changedKeys(prev: WorkspaceState, next: WorkspaceState): string[] {
  return Object.keys(next.buckets).filter((key) => next.buckets[key] !== prev.buckets[key])
}

function evictionVictims(recent: string[], protectedKeys: ReadonlySet<string>): Set<string> {
  const overflow = recent.length - MAX_RESIDENT_SESSION_TAB_BUCKETS

  if (overflow <= 0) return new Set()

  return new Set(recent.filter((key) => !protectedKeys.has(key)).slice(0, overflow))
}

/**
 * Runs after every action: keeps management pages out of docks, normalizes
 * the buckets it touched, refreshes their
 * recency, enforces the resident cap (never evicting the visible session, the
 * main page or one just written), returns to chat once the main page has no
 * tab, and keeps the workspace's team in step with the visible active tab.
 */
export function finalizeWorkspaceState(
  prev: WorkspaceState,
  proposed: WorkspaceState,
  deps: WorkspaceStoreDeps,
): WorkspaceState {
  const next = divertManagementPages(prev, proposed, deps)
  const current = currentSessionKey(next)
  const touched = changedKeys(prev, next)
  const teamId = next.teamScope?.teamId ?? null
  const normalized = new Map(
    touched.map((key) => [key, normalizeBucket(next.buckets[key], teamId, deps)]),
  )

  if (prev.sessionId !== next.sessionId || prev.mainPageOpen !== next.mainPageOpen) {
    touched.push(current)
  }
  const isResident = (key: string) =>
    normalized.has(key) ? normalized.get(key) !== null : key in next.buckets
  const recentCandidates = [
    ...next.recentSessionKeys.filter((key) => !touched.includes(key)),
    ...touched,
  ].filter((key, index, all) => isResident(key) && all.indexOf(key) === index)
  const victims = evictionVictims(
    recentCandidates,
    new Set([current, MAIN_PAGE_BUCKET_KEY, ...touched]),
  )
  const buckets: Record<string, TabBucket> = {}

  for (const key of Object.keys(next.buckets)) {
    const bucket = normalized.has(key) ? normalized.get(key) : next.buckets[key]

    if (bucket && !victims.has(key)) buckets[key] = bucket
  }
  const settled: WorkspaceState = {
    ...next,
    mainPageOpen: next.mainPageOpen && MAIN_PAGE_BUCKET_KEY in buckets,
    buckets,
    recentSessionKeys: recentCandidates.filter((key) => !victims.has(key)),
  }
  const activeTeamId = selectActiveTab(settled)?.scope.teamId

  if (activeTeamId && activeTeamId !== settled.teamScope?.teamId) {
    return { ...settled, teamScope: teamScopeOf(activeTeamId) }
  }

  return settled
}
