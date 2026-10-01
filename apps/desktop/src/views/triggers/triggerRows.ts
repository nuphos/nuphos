import { scheduleSummary } from './cron.ts'

import type { AgentTrigger, AgentTriggerGroup } from '../../api'

/**
 * One row of the Triggers table.
 *
 * Watch groups and standalone triggers share the table because they are the
 * same thing to the reader — an automation that runs on its own — and keeping
 * them apart meant you could not see all of them, or search them, at once. The
 * Type column is what tells them apart, which the old list had no way to say.
 */
export type TriggerListRow =
  | { key: string; kind: 'trigger'; trigger: AgentTrigger }
  | { key: string; kind: 'group'; group: AgentTriggerGroup }

export type TriggerTypeFilter = 'all' | 'cron' | 'webhook'
export type TriggerStatusFilter = 'all' | 'active' | 'paused'

/**
 * Groups lead, then the triggers that stand on their own.
 *
 * A group's partition triggers are deliberately dropped: one of them serves
 * every monitored item behind a provider's shared ingress, so listing it beside
 * its group would read as a second, separate automation. A trigger whose group
 * is missing from `groups` is kept — it is the only place that row can appear.
 */
export function buildTriggerRows(
  triggers: AgentTrigger[],
  groups: AgentTriggerGroup[],
): TriggerListRow[] {
  const groupIds = new Set(groups.map((group) => group.id))

  return [
    ...groups.map((group): TriggerListRow => ({ key: group.id, kind: 'group', group })),
    ...triggers
      .filter((trigger) => !trigger.watchGroupId || !groupIds.has(trigger.watchGroupId))
      .map((trigger): TriggerListRow => ({ key: trigger.id, kind: 'trigger', trigger })),
  ]
}

export function rowName(row: TriggerListRow): string {
  return row.kind === 'group' ? row.group.name : row.trigger.name
}

/**
 * How this row fires — and only that.
 *
 * A Watch group is a container over partition triggers, not a third way of
 * firing: every one of those partitions is webhook-driven. Naming the container
 * here would put two different questions in one column and hide the answer to
 * the one it asks. Being a group is said in the Name cell instead, beside the
 * other things a row *is* (Agent, Paused).
 */
export function rowTypeLabel(row: TriggerListRow): string {
  if (row.kind === 'group') return 'Webhook'

  return row.trigger.triggerType === 'cron' ? 'Cron' : 'Webhook'
}

/** The row's kind, where it is worth saying. Empty for a plain trigger. */
export function rowKindLabel(row: TriggerListRow): string {
  return row.kind === 'group' ? 'Group' : ''
}

/** What makes this row fire — or, for a group, how far its build-out has got. */
export function rowScheduleText(row: TriggerListRow): string {
  if (row.kind === 'trigger') return scheduleSummary(row.trigger)
  const { expectedMemberCount, readyPartitionCount, partitionCount } = row.group
  const items = `${String(expectedMemberCount)} item${expectedMemberCount === 1 ? '' : 's'}`

  return `${items} · ${String(readyPartitionCount)}/${String(partitionCount)} ingresses ready`
}

/** Groups have no run of their own — their partition triggers do the firing. */
export function rowLastRunAt(row: TriggerListRow): string | undefined {
  return row.kind === 'trigger' ? row.trigger.lastRunAt : undefined
}

export function rowPrincipalUserId(row: TriggerListRow): string {
  return row.kind === 'group'
    ? (row.group.executionPrincipalUserId ?? row.group.createdByUserId ?? row.group.userId)
    : (row.trigger.executionPrincipalUserId ?? row.trigger.createdByUserId ?? row.trigger.userId)
}

/**
 * Whether this row is actually firing.
 *
 * For a group that is its `state`, not its `enabled` flag: a group can be
 * enabled and still not running — mid-provisioning, or with a failed ingress —
 * and an Active filter that listed those would be lying about what is live.
 */
export function rowActive(row: TriggerListRow): boolean {
  return row.kind === 'group' ? row.group.state === 'active' : row.trigger.enabled
}

/** Everything the toolbar's search box should match on. */
export function rowSearchText(row: TriggerListRow): string {
  return `${rowName(row)} ${rowTypeLabel(row)} ${rowKindLabel(row)} ${rowScheduleText(row)}`
}

/**
 * The principals worth offering as a filter: those that actually own a row.
 *
 * Derived from the rows rather than from team membership, for two reasons. A
 * member who owns nothing can only ever produce an empty list, and offering
 * them reads as a broken filter. And building the options from the same
 * `rowPrincipalUserId` the "Runs as" column renders makes it impossible for the
 * two to disagree about who owns what.
 */
export function rowPrincipalIds(rows: TriggerListRow[]): string[] {
  return [...new Set(rows.map(rowPrincipalUserId))]
}

export function filterTriggerRows(
  rows: TriggerListRow[],
  filters: {
    type: TriggerTypeFilter
    status: TriggerStatusFilter
    /** A team member id, matched against "Runs as". Null lists everyone. */
    principalId: string | null
  },
): TriggerListRow[] {
  return rows.filter((row) => {
    if (filters.principalId && rowPrincipalUserId(row) !== filters.principalId) return false
    if (
      filters.type === 'cron' &&
      !(row.kind === 'trigger' && row.trigger.triggerType === 'cron')
    ) {
      return false
    }
    // Groups are in the webhook set by construction — their partitions are
    // webhook triggers.
    if (filters.type === 'webhook' && rowTypeLabel(row) !== 'Webhook') return false
    if (filters.status === 'active' && !rowActive(row)) return false
    if (filters.status === 'paused' && rowActive(row)) return false

    return true
  })
}

/**
 * Toolbar chip sets for the two filters above.
 *
 * Type has exactly the two ways a trigger fires. Being a Watch group is a
 * property of the row, said with a tag beside its name the way Agent and Paused
 * are — and reachable from search, which matches rowKindLabel.
 */
export const TYPE_TABS: { value: TriggerTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cron', label: 'Cron' },
  { value: 'webhook', label: 'Webhook' },
]

export const STATUS_TABS: { value: TriggerStatusFilter; label: string }[] = [
  { value: 'all', label: 'Any' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
]
