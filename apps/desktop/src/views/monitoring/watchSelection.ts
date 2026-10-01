import type { MonitoringOverviewRow } from '../../types'

// Provisioning a Watch Group stays reviewable when it's bounded; larger
// selections should be split into separate groups.
export const MAX_WATCH_GROUP_MEMBERS = 50

/**
 * Mirrors `trigger_group_create`'s `memberKeys.min(2)`. A group exists to give
 * several monitored items ONE shared provider ingress; with a single member
 * there is nothing to share, and the agent would be handed an instruction its
 * own tool rejects.
 */
export const MIN_WATCH_GROUP_MEMBERS = 2

export type WatchSelectionPlan =
  | { kind: 'none' }
  | { kind: 'single'; row: MonitoringOverviewRow }
  | { kind: 'group'; rows: MonitoringOverviewRow[]; truncated: boolean }

/**
 * What "Watch selected" should actually do, given what is selected.
 *
 * Selecting one row and asking for a group is not an error to refuse — it is a
 * request to watch that one thing, which the single-item flow already handles.
 * Routing it there is both what the user meant and the only form the backend
 * accepts.
 */
export function planWatchSelection(selected: MonitoringOverviewRow[]): WatchSelectionPlan {
  if (selected.length === 0) return { kind: 'none' }
  if (selected.length < MIN_WATCH_GROUP_MEMBERS) return { kind: 'single', row: selected[0]! }

  return {
    kind: 'group',
    rows: selected.slice(0, MAX_WATCH_GROUP_MEMBERS),
    truncated: selected.length > MAX_WATCH_GROUP_MEMBERS,
  }
}
