import { Age } from '../../components/Age'
import { MemberCell } from '../../components/MemberCell'

import { Toggle } from './parts'
import { executionPrincipalLabel } from './shared'
import { NameCell } from './triggerCells'
import {
  rowActive,
  rowLastRunAt,
  rowName,
  rowPrincipalUserId,
  rowScheduleText,
  rowTypeLabel,
} from './triggerRows'

import type { TriggerListRow } from './triggerRows'
import type { Column } from '../../components/Table'
import type { TeamMember } from '../../types'

/**
 * The Triggers table.
 *
 * Name carries the row's identity and anything wrong with it (paused, mid-
 * removal, cleanup owed); every other column is one fact, sortable. Editing and
 * test-firing live in the row menu rather than as columns — they are actions on
 * the row, not properties of it, and a table that renders them inline has no
 * room left for the facts.
 */
export function buildTriggerColumns({
  members,
  canManage,
  togglingKey,
  onToggle,
}: {
  members: TeamMember[]
  canManage: boolean
  /** The row whose toggle is mid-flight; groups take a moment to fan out. */
  togglingKey: string | null
  onToggle: (row: TriggerListRow, enabled: boolean) => void
}): Column<TriggerListRow>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      minWidth: 220,
      // Which trigger a row *is*. Scrolled sideways past Schedule and Runs as,
      // an unpinned name leaves a row you can act on but cannot identify.
      // Pinning also hands the slack it used to absorb to Schedule below: a
      // column that never scrolls away cannot be the one that grows.
      pin: 'left',
      sortAccessor: (row) => rowName(row).toLowerCase(),
      render: (row) => <NameCell row={row} />,
    },
    {
      key: 'type',
      header: 'Type',
      width: 110,
      sortAccessor: rowTypeLabel,
      render: (row) => <span className="text-secondary">{rowTypeLabel(row)}</span>,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      width: 260,
      grow: 1,
      sortAccessor: rowScheduleText,
      render: (row) => (
        <span className="truncate text-secondary" title={rowScheduleText(row)}>
          {rowScheduleText(row)}
        </span>
      ),
    },
    {
      key: 'lastRun',
      header: 'Last run',
      width: 110,
      // Sort by the raw timestamp, not the rendered "3d". Never-run rows sort
      // to one end together, which an empty string gives us for free.
      sortAccessor: (row) => rowLastRunAt(row) ?? '',
      render: (row) => {
        const lastRunAt = rowLastRunAt(row)

        return lastRunAt ? <Age value={lastRunAt} /> : <span className="text-quaternary">—</span>
      },
    },
    {
      key: 'principal',
      header: 'Runs as',
      width: 180,
      // Sorted by the same text the cell shows, so a removed member still sorts
      // under their own name rather than a raw id.
      sortAccessor: (row) => executionPrincipalLabel(members, rowPrincipalUserId(row)),
      render: (row) => (
        <MemberCell
          compact
          member={members.find((m) => m.id === rowPrincipalUserId(row)) ?? null}
        />
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      width: 90,
      sortAccessor: rowActive,
      render: (row) => (
        <Toggle
          enabled={rowActive(row)}
          disabled={!canManage || togglingKey === row.key || !isTogglable(row)}
          ariaLabel={`${rowActive(row) ? 'Disable' : 'Enable'} ${rowName(row)}`}
          onChange={(enabled) => onToggle(row, enabled)}
        />
      ),
    },
  ]
}

/** Provisioning and half-failed groups have nothing coherent to toggle yet. */
function isTogglable(row: TriggerListRow): boolean {
  if (row.kind === 'trigger') return !row.trigger.cleanupStatus

  return row.group.state !== 'provisioning' && row.group.state !== 'partial'
}
