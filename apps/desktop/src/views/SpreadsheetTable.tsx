import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'

import { t } from '../i18n'
import { columnName } from '../lib/xlsxXml'

import type { XlsxSheet } from '../lib/xlsxXml'

/** Virtual rows with Excel column/row coordinates. */
export function SpreadsheetTable({ sheet }: { sheet: XlsxSheet }) {
  const scroller = useRef<HTMLDivElement>(null)
  const widths = useMemo(() => columnWidths(sheet.rows, sheet.columns), [sheet])
  const virtualizer = useVirtualizer({
    count: sheet.rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 28,
    overscan: 10,
  })
  const items = virtualizer.getVirtualItems()
  const top = items[0]?.start ?? 0
  const bottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0
  const cell = 'truncate whitespace-nowrap border-b border-r border-line-control px-2 text-left'

  if (!sheet.rows.length) return <p className="p-4 text-sm text-tertiary">{t('No data')}</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto scrollbar-thin"
        tabIndex={0}
        aria-label={sheet.name}
      >
        <table
          className="table-fixed border-separate border-spacing-0 font-mono text-xs text-secondary"
          style={{ width: `${String(6 + widths.reduce((a, b) => a + b, 0))}ch` }}
        >
          <colgroup>
            <col style={{ width: '6ch' }} />
            {widths.map((width, i) => (
              <col key={i} style={{ width: `${String(width)}ch` }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface-sunken text-main">
            <tr style={{ height: 28 }}>
              <th className={cell}>#</th>
              {widths.map((_, i) => (
                <th key={i} className={cell} scope="col">
                  {columnName(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top > 0 && <tr style={{ height: top }} aria-hidden />}
            {items.map((item) => (
              <tr key={item.key} style={{ height: 28 }} className="hover:bg-state-hover">
                <th scope="row" className={`${cell} bg-surface-sunken text-tertiary`}>
                  {item.index + 1}
                </th>
                {widths.map((_, column) => (
                  <td key={column} className={cell} title={sheet.rows[item.index][column]}>
                    {sheet.rows[item.index][column] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            {bottom > 0 && <tr style={{ height: bottom }} aria-hidden />}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-control px-3 py-1.5 text-xs text-tertiary">
        {t('{rows} rows · {columns} columns', {
          rows: String(sheet.rows.length),
          columns: String(sheet.columns),
        })}
      </div>
    </div>
  )
}

/** Sample bounded rows to size columns without measuring every cell in the DOM. */
function columnWidths(rows: readonly string[][], columns: number): number[] {
  const widths = Array.from({ length: columns }, () => 4)

  for (const row of rows.slice(0, 200)) {
    row.forEach((cell, i) => {
      widths[i] = Math.min(40, Math.max(widths[i], cell.length))
    })
  }

  return widths.map((width) => width + 4)
}
