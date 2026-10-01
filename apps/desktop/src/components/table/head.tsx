import clsx from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Fragment, useRef } from 'react'

import { FALLBACK_WIDTH, clampResized } from '../../lib/tableColumnWidths'

import { Checkbox } from './cells'
import { CHECKBOX_COL_WIDTH } from './support'

import type { Column, SortState, StickyLayout, StickyPin } from './support'

/**
 * Fill and bottom rule of the header row, on the cells rather than the `thead`.
 * The rule for the same reason the rows' is (`ROW_RULE`); the fill because a
 * row group's background is painted by the table and stays behind when the
 * group is `position: sticky` — a header backed only by `thead` turns
 * see-through the moment it sticks.
 */
const HEADER_RULE = 'bg-main border-b border-zGray-800'

type Props<T> = {
  columns: Column<T>[]
  widths: Record<string, number>
  sticky: StickyLayout
  /** The one-frame pass that lets the columns size themselves. */
  fitting: boolean
  selectable: boolean
  sort: SortState
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
  onSort: (col: Column<T>) => void
  onResize: (key: string, width: number) => void
  onAutoFit: (key: string) => void
}

/**
 * Everything above the table body: the column sizing and the sticky header row.
 *
 * Both have to place the spacer — the widthless column that swallows whatever
 * the sized columns leave over — at the same index, which is why they live
 * together here rather than inline in `Table`.
 */
export function TableHead<T>({
  columns,
  widths,
  sticky,
  fitting,
  selectable,
  sort,
  allSelected,
  someSelected,
  onToggleAll,
  onSort,
  onResize,
  onAutoFit,
}: Props<T>) {
  const { spacerAt } = sticky

  return (
    <>
      <colgroup>
        {selectable && <col style={{ width: CHECKBOX_COL_WIDTH }} />}
        {columns.map((c, i) => (
          <Fragment key={c.key}>
            {i === spacerAt && <col />}
            {/* No width during a fitting pass — a specified one would be
                exactly the guess the pass exists to replace. */}
            <col style={fitting ? undefined : { width: widths[c.key] ?? FALLBACK_WIDTH }} />
          </Fragment>
        ))}
        {spacerAt === columns.length && <col />}
      </colgroup>
      <thead className="sticky top-0 bg-main z-10">
        <tr className="text-secondary text-[13px]">
          {selectable && (
            <th
              // Pins with the leading run — see the matching row cell.
              style={sticky.pinnedLead ? { left: 0 } : undefined}
              className={clsx(
                'group table-checkbox-cell select-none px-3 py-1.5 align-middle',
                HEADER_RULE,
                sticky.pinnedLead && 'table-sticky-end',
              )}
              // Whole-cell hit target, same as the row cells.
              onClick={onToggleAll}
            >
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onToggle={onToggleAll}
                ariaLabel="Select all rows"
                // Hidden until hovered so the column reads as whitespace;
                // stays visible while it has state to show (all/some).
                className={clsx(
                  'transition-opacity',
                  allSelected || someSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              />
            </th>
          )}
          {columns.map((col, i) => (
            <Fragment key={col.key}>
              {i === spacerAt && <th className={HEADER_RULE} aria-hidden="true" />}
              <HeaderCell
                col={col}
                sort={sort}
                pin={sticky.pins[col.key]}
                width={widths[col.key] ?? FALLBACK_WIDTH}
                minWidth={clampResized(col, 0)}
                onSort={() => onSort(col)}
                onResize={(newWidth) => onResize(col.key, newWidth)}
                onAutoFit={() => onAutoFit(col.key)}
              />
            </Fragment>
          ))}
          {spacerAt === columns.length && <th className={HEADER_RULE} aria-hidden="true" />}
        </tr>
      </thead>
    </>
  )
}

export function HeaderCell<T>({
  col,
  sort,
  pin,
  width,
  minWidth,
  onSort,
  onResize,
  onAutoFit,
}: {
  col: Column<T>
  sort: SortState
  /** Where this column is pinned; undefined when it is not. */
  pin?: StickyPin
  width: number
  minWidth: number
  onSort: () => void
  onResize: (newWidth: number) => void
  onAutoFit: () => void
}) {
  const sortable = !!col.sortAccessor
  const sortDir = sort?.key === col.key ? sort.dir : null
  const atTrailingEdge = pin?.edge === 'right' && pin.offset === 0
  const draggedRef = useRef(false)

  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    draggedRef.current = false
    const startX = e.clientX
    const startWidth = width

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let raf = 0
    let lastX = startX

    function apply() {
      raf = 0
      const dx = lastX - startX

      if (!draggedRef.current && Math.abs(dx) > 1) draggedRef.current = true
      onResize(Math.max(minWidth, startWidth + dx))
    }

    function move(ev: PointerEvent) {
      ev.preventDefault()
      lastX = ev.clientX
      if (raf === 0) raf = requestAnimationFrame(apply)
    }
    function up() {
      if (raf !== 0) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function onHeaderClick() {
    if (draggedRef.current) {
      draggedRef.current = false

      return
    }
    if (sortable) onSort()
  }

  return (
    <th
      // Read by the fitting pass to map header widths back to columns.
      data-col-key={col.key}
      data-sticky-edge={pin?.shade ? pin.edge : undefined}
      onClick={onHeaderClick}
      style={pin && { [pin.edge]: pin.offset }}
      className={clsx(
        // `isolate` contains the resize handle's z-index. Without it the handle
        // sits at z-30 in the *header row's* stacking context, so the divider
        // of a column scrolled under a pinned one still paints on top of it.
        'text-left font-medium px-2 py-1.5 relative isolate select-none',
        HEADER_RULE,
        pin && 'table-sticky-end',
        col.className,
        sortable && 'cursor-default hover:text-secondary',
      )}
    >
      <div className="flex items-center gap-1 overflow-hidden">
        <span className="truncate">{col.header}</span>
        {sortDir === 'asc' && (
          <ChevronUp className="w-3.5 h-3.5 text-zViolet-accent flex-shrink-0" strokeWidth={2.4} />
        )}
        {sortDir === 'desc' && (
          <ChevronDown
            className="w-3.5 h-3.5 text-zViolet-accent flex-shrink-0"
            strokeWidth={2.4}
          />
        )}
      </div>
      {/* No handle on the column flush with the trailing edge: its right edge
          is the pane's, not a boundary between two columns, so the divider
          reads as a stray border over the table's own — and the column that
          ends up there is the fixed-width row-actions one, which has nothing
          a drag could reveal. */}
      {!atTrailingEdge && (
        <div
          onPointerDown={startResize}
          onClick={(e) => e.stopPropagation()}
          // Double-click re-fits the column to its content and forgets whatever
          // width was dragged onto it — the standard escape hatch from a resize.
          onDoubleClick={(e) => {
            e.stopPropagation()
            onAutoFit()
          }}
          title="Drag to resize, double-click to fit"
          style={{ touchAction: 'none', pointerEvents: 'auto' }}
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-30 group flex items-stretch justify-end"
        >
          <div className="table-col-divider w-px group-hover:w-0.5 bg-zGray-800 group-hover:bg-zViolet-accent transition-all pointer-events-none" />
        </div>
      )}
    </th>
  )
}
