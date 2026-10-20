import { CONNECTOR_CATEGORIES } from '../../lib/connectorCategories.ts'

export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 380
export const DEFAULT_SIDEBAR_WIDTH = 248
export const SIDEBAR_WIDTH_KEY = 'nuphos.sidebarWidth'
// Storage: { [teamId]: { [title]: 'open' | 'closed' } } explicit user
// overrides, PER TEAM — but only for groups outside DEFAULT_COLLAPSED_GROUPS;
// the integration groups below are ALWAYS folded at rest and their expansion
// is deliberately ephemeral (never persisted). A flat pre-per-team shape
// parses as no overrides.
const SIDEBAR_GROUP_STATE_KEY = 'nuphos.sidebarGroupState'

// Derived, never hand-listed: a copy of the labels here would silently stop
// matching the moment a category is renamed in the shared table, and the group
// would quietly start expanded — which is the bug #574 had just finished
// fixing for Databases when this list was still written by hand.
export const DEFAULT_COLLAPSED_GROUPS = new Set(
  CONNECTOR_CATEGORIES.filter((category) => category.foldedAtRest).map(
    (category) => category.label,
  ),
)

// Titles older builds persisted collapse state under: the pre-rename connector
// groups and the top nav's former heading. Ignored on read so a stale entry
// can't resurrect a group that is folded-at-rest now, or apply to a section
// title that no longer exists.
const LEGACY_GROUP_TITLES = new Set(['Infra', 'Repo', 'Overview'])

export type GroupState = Record<string, 'open' | 'closed'>

// localStorage is the only copy of this state. Every sidebar — one per window,
// remounted on pane, scope and team switches — reads it directly, and a toggle
// writes only the one entry it changed. An in-memory copy written back whole
// would let a window that never saw a fold reopen it.
function parseGroupStateFile(raw: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? '{}')

    if (!parsed || typeof parsed !== 'object') return {}

    // Drop legacy flat entries ("Infra": "open") so they don't accumulate.
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value && typeof value === 'object'),
    )
  } catch {
    return {}
  }
}

export function readGroupStateRaw(): string | null {
  try {
    return localStorage.getItem(SIDEBAR_GROUP_STATE_KEY)
  } catch {
    return null
  }
}

const groupStateListeners = new Set<() => void>()

export function subscribeGroupState(onChange: () => void): () => void {
  // `storage` reports writes from other windows; this window's own writes
  // notify the set directly.
  groupStateListeners.add(onChange)
  window.addEventListener('storage', onChange)

  return () => {
    groupStateListeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function loadGroupState(teamId: string, raw = readGroupStateRaw()): GroupState {
  const forTeam = parseGroupStateFile(raw)[teamId]

  if (!forTeam || typeof forTeam !== 'object') return {}

  return Object.fromEntries(
    Object.entries(forTeam).filter(
      (entry): entry is [string, 'open' | 'closed'] =>
        // Integration-group entries persisted by older builds must not
        // resurrect — those groups are always-folded-at-rest now.
        (entry[1] === 'open' || entry[1] === 'closed') &&
        !DEFAULT_COLLAPSED_GROUPS.has(entry[0]) &&
        !LEGACY_GROUP_TITLES.has(entry[0]),
    ),
  )
}

export function writeGroupFold(teamId: string, title: string, value: 'open' | 'closed'): void {
  const raw = readGroupStateRaw()

  try {
    localStorage.setItem(
      SIDEBAR_GROUP_STATE_KEY,
      JSON.stringify({
        ...parseGroupStateFile(raw),
        [teamId]: { ...loadGroupState(teamId, raw), [title]: value },
      }),
    )
  } catch {
    // Without storage there is nowhere to keep a fold; the toggle is a no-op.
  }
  for (const listener of groupStateListeners) listener()
}

export const AGENT_SESSIONS_POLL_MS = 4_000

export function agentSessionsCacheKey(teamId: string): string {
  return `sidebar-agent-sessions:${teamId}`
}

export function sharedSessionsCacheKey(teamId: string): string {
  return `sidebar-shared-sessions:${teamId}`
}

export function crdCacheKey(kubeconfigContext: string): string {
  return `sidebar-crds:${kubeconfigContext}`
}
