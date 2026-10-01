/**
 * Where a table's pinned columns sit — the layout `components/Table` hands to
 * its header and to every row. Widths come from `tableColumnWidths`; this only
 * decides which columns hold an edge and how far from it they sit.
 */

// Extension-qualified: this module is pulled in by the node test runner, which
// does not resolve extensionless specifiers the way the bundler does.
import { FALLBACK_WIDTH } from './tableColumnWidths.ts'

import type { ColumnWidthSpec } from './tableColumnWidths.ts'

export type StickyPin = {
  /** The pane edge this column holds. */
  edge: 'left' | 'right'
  /** Distance from that edge, once the columns pinned outside it are counted. */
  offset: number
  /**
   * Innermost column of its run — the one that casts the shade over whatever is
   * sliding past. Only one per run, or they would shade each other.
   */
  shade: boolean
}

/**
 * Where the pinned columns sit, shared by the header and every row.
 *
 * `spacerAt` is the index the spacer cell goes at — the widthless column that
 * swallows whatever the sized columns leave over, so a row's background still
 * spans the pane. It sits immediately *before* the trailing pinned run, which
 * is what keeps those columns flush with the right edge on the many tables that
 * size every column by hand and so never grow to fill the pane. With nothing
 * pinned to the right it lands at the end, where it has always been.
 */
export type StickyLayout = {
  spacerAt: number
  /** By column key; a column that is not pinned is absent. */
  pins: Record<string, StickyPin>
  /** A leading run exists, so the checkbox column has to pin along with it. */
  pinnedLead: boolean
}

/**
 * Only runs that reach an edge can pin: a column with an unpinned one between
 * it and its edge has no fixed distance to hold, so it is ignored. Within a run
 * the columns stack, the outermost flush with the edge.
 *
 * `leadingOffset` is what the left-pinned run starts after — the checkbox
 * column, when the table has one.
 */
export function stickyLayout(
  specs: ColumnWidthSpec[],
  widths: Readonly<Record<string, number>>,
  leadingOffset = 0,
): StickyLayout {
  const pins: Record<string, StickyPin> = {}
  const width = (i: number) => widths[specs[i].key] ?? FALLBACK_WIDTH
  let spacerAt = specs.length
  let offset = 0

  for (let i = specs.length - 1; i >= 0 && specs[i].pin === 'right'; i--) {
    pins[specs[i].key] = { edge: 'right', offset, shade: false }
    offset += width(i)
    spacerAt = i
  }
  if (spacerAt < specs.length) pins[specs[spacerAt].key].shade = true

  offset = leadingOffset
  let lead = 0

  // A run that swallowed the whole table would leave nothing to scroll under
  // it, and both runs would claim the same columns.
  for (let i = 0; i < specs.length && specs[i].pin === 'left' && i < spacerAt; i++) {
    pins[specs[i].key] = { edge: 'left', offset, shade: false }
    offset += width(i)
    lead = i + 1
  }
  if (lead > 0) pins[specs[lead - 1].key].shade = true

  return { spacerAt, pins, pinnedLead: lead > 0 }
}
