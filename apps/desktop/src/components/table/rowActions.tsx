import { MoreHorizontal } from 'lucide-react'

import { Button } from '../ui/button'

import type { Column } from './support'

/**
 * Key of the trailing "⋯" column `Table` appends on its own.
 *
 * Deliberately not `actions`: a handful of views already ship a hand-built
 * `actions` column of bare icon buttons (Cloudflare DNS, CloudFormation,
 * Observability home…), and colliding with it would produce duplicate React
 * keys and a shared width entry.
 */
export const ROW_ACTIONS_COLUMN_KEY = '__rowActions'

/**
 * 60px (not 48) so the 24px icon button clears the cell's `px-4` padding — a
 * narrower column clips the button and the shared cell's text-overflow paints
 * a stray "…" beside it. Pinned via `minWidth` because the column has no
 * content that a wider drag would reveal.
 */
const ROW_ACTIONS_COLUMN_WIDTH = 60

/**
 * The visible entry point to a table's row menu.
 *
 * Every table that accepts a right-click menu gets one of these, so the menu is
 * never discoverable by right-click alone. It reuses the very same
 * `onRowContextMenu` the view already passes — the click just synthesises a
 * position from the button's own box, anchoring the menu under the button
 * rather than at the cursor.
 */
export function buildRowActionsColumn<T>(
  onRowContextMenu: (row: T, e: { clientX: number; clientY: number }) => void,
): Column<T> {
  return {
    key: ROW_ACTIONS_COLUMN_KEY,
    header: '',
    width: ROW_ACTIONS_COLUMN_WIDTH,
    minWidth: ROW_ACTIONS_COLUMN_WIDTH,
    // A table wide enough to scroll sideways must never carry its menu button
    // off-screen. Any column a view pins right stacks to the left of this one.
    pin: 'right',
    render: (row) => (
      <Button
        variant="ghost"
        size="icon-sm"
        title="Actions"
        aria-label="Open row actions"
        onClick={(e) => {
          // Rows are commonly clickable (open a detail view); without this the
          // ⋯ would open the menu and navigate away at once.
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()

          onRowContextMenu(row, { clientX: rect.left, clientY: rect.bottom + 4 })
        }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" strokeWidth={1.8} />
      </Button>
    ),
  }
}
