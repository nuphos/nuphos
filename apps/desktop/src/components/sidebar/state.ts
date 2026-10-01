import { CONNECTOR_CATEGORIES } from '../../lib/connectorCategories'

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

function readGroupStateFile(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDEBAR_GROUP_STATE_KEY) ?? '{}')

    if (!parsed || typeof parsed !== 'object') return {}

    // Drop legacy flat entries ("Infra": "open") so they don't accumulate.
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value && typeof value === 'object'),
    )
  } catch {
    return {}
  }
}

export function loadGroupState(teamId: string): GroupState {
  const forTeam = readGroupStateFile()[teamId]

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

export function writeGroupState(teamId: string, state: GroupState): void {
  try {
    localStorage.setItem(
      SIDEBAR_GROUP_STATE_KEY,
      JSON.stringify({ ...readGroupStateFile(), [teamId]: state }),
    )
  } catch {
    // Best-effort persistence; in-memory state still works this session.
  }
}

export const AGENT_SESSIONS_POLL_MS = 4_000

// Archive rows collapse via `.t-collapse`, which reads --resize-dur; read the
// same token so the removal timing stays in sync with the CSS.
export function resizeDurationMs(): number {
  if (typeof window === 'undefined') return 300
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--resize-dur').trim()
  const parsed = parseFloat(raw)

  if (!Number.isFinite(parsed)) return 300

  return raw.endsWith('ms') ? parsed : parsed * 1000
}

export function agentSessionsCacheKey(teamId: string): string {
  return `sidebar-agent-sessions:${teamId}`
}

export function sharedSessionsCacheKey(teamId: string): string {
  return `sidebar-shared-sessions:${teamId}`
}

export function crdCacheKey(kubeconfigContext: string): string {
  return `sidebar-crds:${kubeconfigContext}`
}
