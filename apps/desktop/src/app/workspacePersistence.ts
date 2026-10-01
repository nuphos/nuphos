import { CONNECTOR_INFO_PROVIDERS } from '../lib/appRoutes.ts'
import { isTeamId } from '../lib/teamId.ts'
import { renamedTeamNavKey } from '../lib/teamOverviewNav.ts'

import { readLocalStorage, writeLocalStorage } from './localStorage.ts'
import { createWorkspaceTab, restoreNavigation } from './workspaceTabFactory.ts'
import {
  LEGACY_WORKSPACE_TABS_STORAGE_KEY,
  NO_SESSION_TAB_BUCKET_KEY,
  WORKSPACE_TABS_STORAGE_KEY,
} from './workspaceTabState.ts'

import type { WorkspaceTabState } from './workspaceTabState'
import type { NavigationSnapshot, NuphosDashboardRef } from '../lib/appRoutes.ts'

// Each tab persists only its navigation history (a list of plain-data
// snapshots) plus the cursor and a label hint. Runtime-only fields — live SSH
// PTYs, ephemeral kubeconfig contexts, in-flight loading flags — are
// deliberately dropped and rebuilt lazily when the restored tab is activated.
export type PersistedWorkspaceTab = {
  navHistory: NavigationSnapshot[]
  navHistoryIndex: number
  title?: string
}

export type PersistedWorkspace = {
  tabs: PersistedWorkspaceTab[]
  activeIndex: number
}

export function serializeWorkspace(
  tabs: WorkspaceTabState[],
  activeTabId: string | null,
): PersistedWorkspace | null {
  // Live SSH terminal tabs can't survive a restart (the PTY is gone), and their
  // bare account-scope snapshot would restore as a misleading list view — skip
  // them so only restorable tabs are remembered.
  const persistable = tabs.filter((tab) => tab.sshTerminal === null)

  if (persistable.length === 0) return null
  const activeId = tabs.find((tab) => tab.id === activeTabId)?.id ?? null
  const activeIndex = Math.max(
    0,
    persistable.findIndex((tab) => tab.id === activeId),
  )

  return {
    tabs: persistable.map((tab) => ({
      navHistory: tab.navHistory,
      navHistoryIndex: Math.min(
        Math.max(0, tab.navHistoryIndex),
        Math.max(0, tab.navHistory.length - 1),
      ),
      // pageMeta carries the live, mounted title; restoredTitle carries it for
      // a tab that was restored but never activated this session.
      title: tab.pageMeta?.title ?? tab.restoredTitle,
    })),
    activeIndex,
  }
}

/** Reads the pre-per-session (single global tab strip) format. Only used as
 *  the migration source for `readPersistedWorkspaceBySession` now. */
export function readPersistedWorkspace(): PersistedWorkspace | null {
  const raw = readLocalStorage(LEGACY_WORKSPACE_TABS_STORAGE_KEY)

  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedWorkspace

    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/** One workspace dock tab strip per chat session (or `NO_SESSION_TAB_BUCKET_KEY`
 *  for dock tabs opened with no session selected). */
export type PersistedWorkspaceBySession = Record<string, PersistedWorkspace>

function isPersistedWorkspace(value: unknown): value is PersistedWorkspace {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PersistedWorkspace).tabs) &&
    (value as PersistedWorkspace).tabs.length > 0
  )
}

function parseWorkspaceBySession(raw: string): PersistedWorkspaceBySession | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const result: PersistedWorkspaceBySession = {}

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isPersistedWorkspace(value)) result[key] = value
  }

  return result
}

/**
 * Reads every session's persisted dock tab strip. A build before per-session
 * tabs existed kept one global strip under `LEGACY_WORKSPACE_TABS_STORAGE_KEY`,
 * not associated with any chat session — on first read after upgrade (the new
 * key is absent, the old one isn't) that strip is adopted as the "no session"
 * bucket so it isn't silently dropped. The legacy key itself is left alone: an
 * unused key from then on, not worth adding a remove-key helper to clear.
 */
export function readPersistedWorkspaceBySession(): PersistedWorkspaceBySession {
  const raw = readLocalStorage(WORKSPACE_TABS_STORAGE_KEY)
  const parsed = raw ? parseWorkspaceBySession(raw) : null

  if (parsed) return parsed

  const legacy = readPersistedWorkspace()

  return legacy ? { [NO_SESSION_TAB_BUCKET_KEY]: legacy } : {}
}

/** Writes every session's persisted dock tab strip in one shot. The store
 *  keeps at most `MAX_RESIDENT_SESSION_TAB_BUCKETS` sessions resident, so this
 *  mirrors that cap rather than enforcing its own. */
export function writePersistedWorkspaceBySession(bySession: PersistedWorkspaceBySession) {
  writeLocalStorage(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(bySession))
}

// A snapshot saved by an older build can name a connector this build no longer
// ships; drop the detail ref so the tab restores on the Connectors list.
function withKnownConnectorDetail(snapshot: NavigationSnapshot): NavigationSnapshot {
  const provider = snapshot.connectorDetail?.provider

  if (!provider || CONNECTOR_INFO_PROVIDERS.some((item) => item === provider)) return snapshot

  return { ...snapshot, connectorDetail: null }
}

type LegacyNavigationSnapshot = NavigationSnapshot & {
  costDashboard?: NuphosDashboardRef | null
  linearIssue?: { bindingId: string; identifier: string; title?: string } | null
}

// Dashboards was called Cost Management, with its open dashboard in `costDashboard`;
// the Linear page was an issue-only `team.linear-issue` page carrying `linearIssue`.
export function withRenamedPage(snapshot: LegacyNavigationSnapshot): NavigationSnapshot {
  const { costDashboard, linearIssue, ...rest } = snapshot
  const active = renamedTeamNavKey(snapshot.active)

  if (active === snapshot.active && costDashboard === undefined && linearIssue === undefined) {
    return snapshot
  }

  return {
    ...rest,
    active,
    nuphosDashboard: rest.nuphosDashboard ?? costDashboard ?? null,
    linearNav: rest.linearNav ?? (linearIssue ? { view: 'issue', ...linearIssue } : null),
  }
}

const RENAMED_PAGE_TITLES: Record<string, string> = { 'Cost Management': 'Dashboards' }

export function restorePersistedTab(persisted: PersistedWorkspaceTab): WorkspaceTabState | null {
  const navHistory = (Array.isArray(persisted.navHistory) ? persisted.navHistory : [])
    .map(withRenamedPage)
    .map(withKnownConnectorDetail)

  if (navHistory.length === 0) return null
  const index = Math.min(Math.max(0, persisted.navHistoryIndex ?? 0), navHistory.length - 1)
  const snapshot = navHistory[index]
  const teamId = snapshot?.scope?.teamId

  // Drops tabs persisted with a non-team-id scope — they restore as an
  // unnamed "?" workspace whose every request 400s, with no way back.
  if (!isTeamId(teamId)) return null
  const base = createWorkspaceTab(teamId)

  return {
    ...restoreNavigation(base, snapshot, index),
    navHistory,
    restoredTitle: persisted.title && (RENAMED_PAGE_TITLES[persisted.title] ?? persisted.title),
  }
}
