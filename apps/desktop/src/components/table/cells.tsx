import clsx from 'clsx'
import { Fragment, memo, useEffect, useRef } from 'react'

import { TABLE_CELL_ACTION_CLASS } from './primaryAction'

import type { Column, StickyLayout } from './support'
import type { CSSProperties, ReactNode } from 'react'

type TableRowProps<T> = {
  row: T
  index: number
  columns: Column<T>[]
  sticky: StickyLayout
  selectable: boolean
  isSel: boolean
  isChecked: boolean
  // The row under the cursor / keyboard cursor — drawn with a subtle border.
  isFocused: boolean
  // Comma-delimited column keys currently flashing for this row ('' when none).
  flashTokens: string
  measureRef: (el: Element | null) => void
  onPrimaryAction?: (row: T) => void
  primaryActionKey: string | null
  onRowContextMenu?: (row: T, e: { clientX: number; clientY: number }) => void
  onCheck: (index: number, shiftKey: boolean) => void
  onHover: (index: number) => void
}

/** Row rule. On the cells, not the row: `border-separate` ignores `tr` borders. */
const ROW_RULE = 'border-b border-zGray-850'

/**
 * A pinned cell has to stay unclipped so its edge shade can hang outside it, so
 * the clipping moves in here — a name column can still truncate while the cell
 * around it lets the shade through.
 */
function stickyCell(content: ReactNode): ReactNode {
  return <span className="block overflow-hidden text-ellipsis">{content}</span>
}

/**
 * The row's background, as a custom property rather than a `bg-*` class: a
 * pinned cell paints its own opaque backdrop (it cannot show the row's
 * through), so it has to repaint the identical tint on top — see
 * `.table-row-tint` / `.table-sticky-end` in index.css.
 *
 * Hover lives in CSS. Setting these inline is what keeps the old
 * checked > selected > hover precedence: an inline custom property outranks the
 * `:hover` rule.
 */
function rowTint(isChecked: boolean, isSel: boolean): CSSProperties | undefined {
  if (isChecked) return { '--row-tint': 'rgba(var(--color-zViolet-500), 0.15)' } as CSSProperties
  if (isSel) return { '--row-tint': 'rgba(var(--color-zViolet-500), 0.1)' } as CSSProperties

  return undefined
}

function TableRowInner<T>({
  row,
  index,
  columns,
  sticky,
  selectable,
  isSel,
  isChecked,
  isFocused,
  flashTokens,
  measureRef,
  onPrimaryAction,
  primaryActionKey,
  onRowContextMenu,
  onCheck,
  onHover,
}: TableRowProps<T>) {
  return (
    <tr
      // data-index + measureRef let the virtualizer learn the real row height
      // (estimateSize is just a first guess).
      data-index={index}
      ref={measureRef}
      onMouseEnter={() => onHover(index)}
      onContextMenu={
        onRowContextMenu
          ? (e) => {
              e.preventDefault()
              onRowContextMenu(row, { clientX: e.clientX, clientY: e.clientY })
            }
          : undefined
      }
      style={rowTint(isChecked, isSel)}
      className={clsx(
        'group table-row-tint h-[30px] transition-colors',
        // Subtle inset border marks the focused row without shifting layout.
        // `relative z-[1]` lifts it over the neighbours' bottom borders.
        isFocused && 'relative z-[1] outline outline-1 -outline-offset-1 outline-zViolet-400/50',
      )}
    >
      {selectable && (
        <td
          // Pins with the leading run: it sits outside those columns, so a
          // checkbox left behind would slide under them.
          style={sticky.pinnedLead ? { left: 0 } : undefined}
          className={clsx(
            'table-checkbox-cell select-none px-3 align-middle',
            ROW_RULE,
            sticky.pinnedLead && 'table-sticky-end',
          )}
          // The whole cell is the hit target — the 14px input alone is too
          // fiddly. stopPropagation so it never opens the detail view.
          onClick={(e) => {
            e.stopPropagation()
            onCheck(index, e.shiftKey)
          }}
        >
          <Checkbox
            checked={isChecked}
            onToggle={(shiftKey) => onCheck(index, shiftKey)}
            ariaLabel="Select row"
            // Hidden unless the row is hovered or this row itself is checked.
            className={clsx(
              'transition-opacity',
              isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          />
        </td>
      )}
      {columns.map((col, i) => {
        const flashing = flashTokens !== '' && `,${flashTokens},`.includes(`,${col.key},`)
        const pin = sticky.pins[col.key]
        const candidate =
          col.onActivate ?? (col.key === primaryActionKey ? onPrimaryAction : undefined)
        const activate = col.canActivate?.(row) === false ? undefined : candidate
        const content = col.render(row)
        const displayedContent = activate ? (
          <button
            type="button"
            className={TABLE_CELL_ACTION_CLASS}
            aria-label={col.activationLabel?.(row)}
            onClick={(event) => {
              event.stopPropagation()
              activate(row)
            }}
          >
            {content}
          </button>
        ) : (
          content
        )

        return (
          <Fragment key={col.key}>
            {i === sticky.spacerAt && <td aria-hidden="true" className={ROW_RULE} />}
            <td
              // The animation restarts because the flash timer clears the set
              // (dropping `cell-flash`) before the next flash re-adds it.
              data-flash={flashing ? '' : undefined}
              data-sticky-edge={pin?.shade ? pin.edge : undefined}
              style={pin && { [pin.edge]: pin.offset }}
              className={clsx(
                'px-2 py-0.5 text-main whitespace-nowrap',
                ROW_RULE,
                // A pinned cell must not clip — the edge shade is a pseudo
                // hanging outside it, and `overflow: hidden` would cut it away.
                // Its content clips one level in instead (`stickyCell`).
                pin ? 'table-sticky-end' : 'overflow-hidden text-ellipsis',
                flashing && 'cell-flash',
                col.className,
              )}
            >
              {pin ? stickyCell(displayedContent) : displayedContent}
            </td>
          </Fragment>
        )
      })}
      {sticky.spacerAt === columns.length && <td aria-hidden="true" className={ROW_RULE} />}
    </tr>
  )
}

// Memoized so the virtualizer's per-scroll-event re-renders only mount the
// rows entering the window; rows already on screen bail out (their props are
// all primitives or identity-stable).
export const TableRow = memo(TableRowInner) as typeof TableRowInner

export function Checkbox({
  checked,
  indeterminate,
  onToggle,
  ariaLabel,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  // shiftKey is passed so row checkboxes can do range-select; ignored by header.
  onToggle: (shiftKey: boolean) => void
  ariaLabel: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onChange={() => {}}
      // Don't let a click move keyboard focus onto the checkbox: it would show a
      // focus ring and (pre-fix) swallow Shift+Arrow. The click still fires, so
      // toggling and shift-range-click are unaffected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(e.shiftKey)
      }}
      className={clsx('table-checkbox h-3.5 w-3.5 align-middle', className)}
    />
  )
}
