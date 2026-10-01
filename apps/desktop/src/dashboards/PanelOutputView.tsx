import { memo, useMemo } from 'react'

import { tryParseChartPayload } from '../components/agent/chartPayload'
import { Table } from '../components/Table'

import { DashboardPanelChart } from './DashboardPanelChart'

import type { DashboardPanelOutput } from './schema'
import type { Column } from '../components/Table'

function formatValue(value: number, unit: 'usd' | 'count' | 'percent'): string {
  if (unit === 'usd')
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  if (unit === 'percent') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`

  return value.toLocaleString()
}

function ScalarView({ output }: { output: Extract<DashboardPanelOutput, { kind: 'scalar' }> }) {
  const up = (output.deltaPct ?? 0) > 0
  const down = (output.deltaPct ?? 0) < 0

  return (
    <div className="flex flex-col px-1 py-1">
      <div className="text-3xl font-semibold tabular-nums text-main">
        {formatValue(output.value, output.unit)}
      </div>
      {output.deltaPct !== undefined && (
        <div className="mt-1 text-[12px]">
          <span className={up ? 'text-orange-400' : down ? 'text-emerald-400' : 'text-tertiary'}>
            {up ? '▲' : down ? '▼' : ''} {Math.abs(output.deltaPct).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

type TableOutput = Extract<DashboardPanelOutput, { kind: 'table' }>
// The output contract is positional — rows carry no id of their own — so the
// emitted order is the identity the resize/sort state keys off.
type TableRow = { index: number; cells: TableOutput['rows'][number] }

function cellText(v: string | number | null | undefined): string {
  return v === null || v === undefined ? '—' : String(v)
}

// Rendered through the shared components/Table so a breakdown gets the same
// drag-to-resize columns as every other table in the app, persisted per panel.
// That is also what fixes the width: Table sizes each column to its own content
// and scrolls the pane sideways when the total overflows, instead of squeezing
// every column into the card and wrapping the text.
function TableView({ output, storageKey }: { output: TableOutput; storageKey?: string }) {
  const columns = useMemo<Column<TableRow>[]>(
    () =>
      output.columns.map((col) => ({
        key: col.key,
        header: col.label ?? col.key,
        // `.text-right` is emitted after `.text-left`, so this wins over the
        // header cell's own alignment without touching the shared component.
        className: col.numeric ? 'text-right tabular-nums' : 'text-secondary',
        render: (r) => cellText(r.cells[col.key]),
        sortAccessor: (r) => r.cells[col.key] ?? null,
      })),
    [output.columns],
  )
  const rows = useMemo<TableRow[]>(
    () => output.rows.map((cells, index) => ({ index, cells })),
    [output.rows],
  )

  return (
    // Table's root is `flex-1 overflow-auto`, so it needs a bounded flex parent
    // to scroll against rather than growing the card to the row count.
    <div className="flex max-h-72 flex-col">
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.index)}
        storageKey={storageKey}
        empty={<div className="p-3 text-[12px] text-tertiary">No rows.</div>}
      />
    </div>
  )
}

/** Render one panel's validated output. Chart output is ChartPayload-shaped so
 *  it can share the chart plot without inheriting the Agent card chrome. */
export const PanelOutputView = memo(
  ({ output, storageKey }: { output: DashboardPanelOutput; storageKey?: string }) => {
    if (output.kind === 'scalar') return <ScalarView output={output} />
    if (output.kind === 'table') return <TableView output={output} storageKey={storageKey} />
    // chart
    const payload = tryParseChartPayload(output)

    if (!payload)
      return (
        <div className="p-3 text-[12px] text-tertiary">Chart output could not be rendered.</div>
      )

    return <DashboardPanelChart payload={payload} />
  },
)

PanelOutputView.displayName = 'PanelOutputView'
