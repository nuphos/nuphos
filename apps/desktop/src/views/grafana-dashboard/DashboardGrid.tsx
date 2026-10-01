import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useMemo } from 'react'

import { substituteVars } from '../../grafana/client'
import { expandRepeatedRows, groupPanels } from '../../grafana/layout'
import { GRID_COLS, columnsForWidth, reflowBlock } from '../../grafana/reflow'
import { useElementSize } from '../../grafana/useElementSize'

import { PanelHost } from './PanelHost'

import type { GrafanaTarget } from '../../grafana/client'
import type { PanelBlock } from '../../grafana/layout'
import type { Panel, RepeatValue } from '../../grafana/types'

export const DashboardGrid = memo(function DashboardGrid({
  target,
  panels,
  range,
  vars,
  datasourceVars,
  repeatValues,
  varTexts,
  openRows,
  onToggleRow,
  onPanelContextMenu,
}: {
  target: GrafanaTarget
  panels: Panel[]
  range: { from: number; to: number }
  vars: Record<string, string>
  datasourceVars: Record<string, string[]>
  repeatValues: Record<string, RepeatValue[]>
  varTexts: Record<string, string>
  openRows: Record<string, boolean>
  onToggleRow: (key: string, nextOpen: boolean) => void
  onPanelContextMenu: (panel: Panel, e: { clientX: number; clientY: number }) => void
}) {
  // Grafana grid is 24 columns wide, row height = 30 px (we use 36 for our
  // denser layout) with 8px gutters between panels.
  const ROW_H = 36
  const GAP = 8
  const { ref, width } = useElementSize<HTMLDivElement>()
  const columns = columnsForWidth(width)

  // Substitute titles inside the memo — PanelHost effects key off panel
  // object identity, so freshly spread panels on every render would refetch
  // on each parent re-render (the app polls the active tab every 5s).
  const sections = useMemo(
    () =>
      expandRepeatedRows(groupPanels(panels), repeatValues).map((section) => {
        const scopedVars = section.repeat
          ? { ...vars, [section.repeat.name]: section.repeat.queryValue }
          : vars
        const scopedDatasourceVars = section.repeat
          ? { ...datasourceVars, [section.repeat.name]: [section.repeat.value] }
          : datasourceVars
        const scopedTexts = section.repeat
          ? { ...varTexts, [section.repeat.name]: section.repeat.text }
          : varTexts

        return {
          ...section,
          scopedVars,
          scopedDatasourceVars,
          scopedTexts,
          block: {
            ...section.block,
            panels: section.block.panels.map((placed) => ({
              ...placed,
              panel: {
                ...placed.panel,
                title: substituteVars(placed.panel.title, scopedTexts),
              },
            })),
          },
        }
      }),
    [panels, repeatValues, vars, datasourceVars, varTexts],
  )

  const renderBlock = (
    block: PanelBlock,
    scopedVars: Record<string, string>,
    scopedDatasourceVars: Record<string, string[]>,
  ) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${String(GRID_COLS)}, minmax(0, 1fr))`,
        gridAutoRows: `${String(ROW_H)}px`,
        gap: `${String(GAP)}px`,
      }}
    >
      {reflowBlock(block, columns).panels.map(({ panel: p, pos }) => (
        <div
          key={p.id}
          style={{
            gridColumn: `${String(pos.x + 1)} / span ${String(pos.w)}`,
            gridRow: `${String(pos.y + 1)} / span ${String(pos.h)}`,
            minHeight: 0,
            minWidth: 0,
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onPanelContextMenu(p, e)
          }}
        >
          <PanelHost
            target={target}
            panel={p}
            range={range}
            vars={scopedVars}
            datasourceVars={scopedDatasourceVars}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div ref={ref} className="flex flex-col" style={{ gap: `${String(GAP)}px` }}>
      {sections.map((s) => {
        if (s.kind === 'panels') {
          return <div key={s.key}>{renderBlock(s.block, s.scopedVars, s.scopedDatasourceVars)}</div>
        }
        const rowStateKey = s.repeat ? s.key : String(s.row.id)
        const open = openRows[rowStateKey] ?? openRows[String(s.row.id)] ?? !s.row.collapsed

        return (
          <div key={s.key}>
            <div style={{ height: ROW_H }}>
              <RowHeader
                title={substituteVars(s.row.title, s.scopedTexts)}
                expandable={s.block.panels.length > 0}
                open={open}
                onToggle={() => onToggleRow(rowStateKey, !open)}
              />
            </div>
            {s.block.panels.length > 0 && (
              // Row panels stay mounted while collapsed (data loads once; no
              // refetch on expand) — the t-collapse grid-rows trick animates
              // the reveal to/from auto height.
              <div className="t-collapse" data-open={open ? 'true' : 'false'}>
                <div className="t-collapse-inner">
                  <div style={{ paddingTop: GAP }}>
                    {renderBlock(s.block, s.scopedVars, s.scopedDatasourceVars)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

function RowHeader({
  title,
  expandable,
  open,
  onToggle,
}: {
  title: string
  expandable?: boolean
  open?: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={expandable ? onToggle : undefined}
      disabled={!expandable}
      className={`w-full h-full flex items-center gap-1.5 px-3 text-[11.5px] uppercase tracking-wider text-tertiary outline outline-1 outline-zGray-800/60 bg-zGray-950/40 ${
        expandable ? 'hover:text-secondary hover:bg-zGray-900/60' : ''
      }`}
    >
      {expandable &&
        (open ? (
          <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.8} />
        ))}
      {title}
    </button>
  )
}
