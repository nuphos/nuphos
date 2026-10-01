import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useMemo } from 'react'

import { FALLBACK_WIDTH } from '../lib/tableColumnWidths'
import { stickyLayout } from '../lib/tableStickyLayout'

import { TableRow } from './table/cells'
import { TableHead } from './table/head'
import { primaryActionColumnKey } from './table/primaryAction'
import { buildRowActionsColumn } from './table/rowActions'
import { CHECKBOX_COL_WIDTH, ROW_HEIGHT_ESTIMATE, markHorizontalScroll } from './table/support'
import { useTableKeyboardNav, useTableSelection } from './table/useTableSelection'
import { useTableSort } from './table/useTableSort'
import { useTableColumnFit, useTableColumnWidths } from './table/useTableWidths'
import { TableSkeletonRows } from './TableSkeleton'

import type { Column, SortState } from './table/support'
import type { ReactNode } from 'react'

export type { Column, SortState } from './table/support'

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Opens the row's primary resource from its identifier cell. */
  onPrimaryAction?: (row: T) => void
  // Row menu handler. Receives the row plus the position to anchor a
  // ContextMenu at. Fires on right-click anywhere in the row, and on the
  // trailing "⋯" button the table appends whenever this prop is present —
  // views get the visible entry point for free.
  onRowContextMenu?: (row: T, e: { clientX: number; clientY: number }) => void
  selectedKey?: string | null
  loading?: boolean
  empty?: ReactNode
  storageKey?: string
  defaultSort?: SortState
  // Set of `${rowKey}:${columnKey}` tokens for cells that should briefly flash
  // (e.g. because their value just changed in a polled refresh). The animation
  // is one-shot — clear the set after FLASH_MS to retrigger.
  changedCells?: Set<string>
  // Opt-in row multi-select: renders a leading checkbox column (header
  // select-all + shift-range). Controlled — the parent owns the selected set
  // and renders the bulk-action UI. Selection is by rowKey.
  selectable?: boolean
  selectedKeys?: Set<string>
  onSelectedKeysChange?: (next: Set<string>) => void
}

export function Table<T>({
  columns: declaredColumns,
  rows,
  rowKey,
  onPrimaryAction,
  onRowContextMenu,
  selectedKey,
  loading,
  empty,
  storageKey,
  defaultSort = null,
  changedCells,
  selectable = false,
  selectedKeys,
  onSelectedKeysChange,
}: Props<T>) {
  // Memoized so the appended column does not hand `TableRow` a fresh `columns`
  // array on every render and defeat its memo.
  const columns = useMemo(
    () =>
      onRowContextMenu
        ? [...declaredColumns, buildRowActionsColumn(onRowContextMenu)]
        : declaredColumns,
    [declaredColumns, onRowContextMenu],
  )
  const primaryActionKey = useMemo(() => primaryActionColumnKey(columns), [columns])
  const columnSig = columns.map((c) => c.key).join('|')
  const { scrollRef, tableRef, setUserWidths, setMeasured, widths } = useTableColumnWidths({
    columns,
    columnSig,
    storageKey,
    selectable,
  })
  const { sort, sortedRows, toggleSort } = useTableSort({
    columns,
    storageKey,
    defaultSort,
    rows,
    rowKey,
  })
  const selection = useTableSelection({
    selectable,
    selectedKeys,
    onSelectedKeysChange,
    sortedRows,
    rowKey,
  })
  const {
    selected,
    focusedIndex,
    allSelected,
    someSelected,
    toggleAll,
    onRowCheck,
    onRowHover,
    onContainerMouseMove,
    onContainerMouseLeave,
  } = selection

  // Total columns spanned by the loading / empty placeholder rows.
  const placeholderColSpan = columns.length + (selectable ? 1 : 0) + 1
  // Identity-stable so it never defeats the row memo; the widths it reads only
  // change on a resize or a re-fit.
  const sticky = useMemo(
    () => stickyLayout(columns, widths, selectable ? CHECKBOX_COL_WIDTH : 0),
    [columns, widths, selectable],
  )

  // Whether the table overflows is decided by the column widths and the pane,
  // not only by scrolling, so the edge flags are refreshed after every layout
  // pass that could have changed either.
  useLayoutEffect(() => {
    markHorizontalScroll(scrollRef.current)
  }, [sticky, scrollRef])

  // Only the rows near the viewport get DOM nodes; spacer rows above/below
  // preserve the scroll height so the scrollbar and scroll position behave as
  // if every row were rendered. Sorting/filtering/selection all operate on the
  // full data arrays above and are unaffected. `scrollRef` is declared with the
  // width state above, which needs it to observe the pane.
  //
  // Keyed by row identity (not index) so the measurement cache survives
  // sort/filter reorders without briefly applying a cached size to the
  // wrong row.
  const getItemKey = useCallback((index: number) => rowKey(sortedRows[index]), [rowKey, sortedRows])
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getItemKey,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 10,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const padTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const padBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0

  const { fitting, autoFitColumn } = useTableColumnFit({
    columns,
    columnSig,
    rowCount: sortedRows.length,
    virtualRowCount: virtualRows.length,
    tableRef,
    setMeasured,
    setUserWidths,
  })

  useTableKeyboardNav({
    selectable,
    selection,
    onSelectedKeysChange,
    virtualizer,
    scrollRef,
  })

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto scrollbar-thin"
      onScroll={(e) => markHorizontalScroll(e.currentTarget)}
      onMouseMove={onContainerMouseMove}
      onMouseLeave={onContainerMouseLeave}
    >
      <table
        ref={tableRef}
        // `border-separate` (with no spacing) rather than the preflight's
        // `collapse`: collapsed borders are painted by the table, so a pinned
        // cell — which `position: sticky` lifts above that layer — would blank
        // out the run of every rule it covers. Separate borders belong to the
        // cells and travel with them.
        className="text-[13px] border-separate border-spacing-0"
        style={
          fitting
            ? { tableLayout: 'auto', width: 'max-content' }
            : {
                tableLayout: 'fixed',
                width:
                  columns.reduce((s, c) => s + (widths[c.key] ?? FALLBACK_WIDTH), 0) +
                  (selectable ? CHECKBOX_COL_WIDTH : 0),
                minWidth: '100%',
              }
        }
      >
        <TableHead
          columns={columns}
          widths={widths}
          sticky={sticky}
          fitting={fitting}
          selectable={selectable}
          sort={sort}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleAll={toggleAll}
          onSort={toggleSort}
          onResize={(key, width) => setUserWidths((w) => ({ ...w, [key]: width }))}
          onAutoFit={autoFitColumn}
        />
        <tbody className="selectable">
          {loading && sortedRows.length === 0 && (
            <tr>
              <td colSpan={placeholderColSpan} className="p-0">
                <TableSkeletonRows />
              </td>
            </tr>
          )}
          {!loading && sortedRows.length === 0 && (
            <tr>
              <td colSpan={placeholderColSpan} className="px-4 py-12 text-center text-tertiary">
                {empty || 'No items'}
              </td>
            </tr>
          )}
          {padTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={placeholderColSpan} style={{ height: padTop, padding: 0 }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const index = virtualRow.index
            const row = sortedRows[index]
            const k = rowKey(row)
            // Comma-delimited so the prop stays a primitive — a fresh array
            // every render would defeat the row memo.
            const flashTokens =
              changedCells && changedCells.size > 0
                ? columns
                    .filter((c) => changedCells.has(`${k}:${c.key}`))
                    .map((c) => c.key)
                    .join(',')
                : ''

            return (
              <TableRow<T>
                key={k}
                row={row}
                index={index}
                columns={columns}
                sticky={sticky}
                selectable={selectable}
                isSel={selectedKey === k}
                isChecked={selectable && selected.has(k)}
                isFocused={selectable && focusedIndex === index}
                flashTokens={flashTokens}
                measureRef={virtualizer.measureElement}
                onPrimaryAction={onPrimaryAction}
                primaryActionKey={primaryActionKey}
                onRowContextMenu={onRowContextMenu}
                onCheck={onRowCheck}
                onHover={onRowHover}
              />
            )
          })}
          {padBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={placeholderColSpan} style={{ height: padBottom, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
