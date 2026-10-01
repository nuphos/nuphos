import { useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'

import { QueryError } from '../grafana/components/QueryError'
import { useToolbarSlot } from '../hooks/useToolbarControls'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { DashboardGrid } from './grafana-dashboard/DashboardGrid'
import { TimeRangePicker } from './grafana-dashboard/TimeRangePicker'
import { useGrafanaDashboard } from './grafana-dashboard/useGrafanaDashboard'
import { VariablePicker } from './grafana-dashboard/VariablePicker'

import type { GrafanaTarget } from '../grafana/client'
import type { Panel } from '../grafana/types'

type Props = {
  target: GrafanaTarget
  uid: string
}

export function GrafanaDashboardView({ target: targetProp, uid }: Props) {
  // Keep-alive keeps inactive tabs mounted; passing isActive gates the portal
  // (and occupancy) so only the active tab drives the shared toolbar row.
  const { refreshKey, pollTick, isActive } = useWorkspaceTab()
  const controlsSlot = useToolbarSlot('right', isActive)
  // The parent recreates the target object on every render (and it re-renders
  // on a 5s tab poll); pin its identity so panels don't refetch spuriously.
  const target = useMemo(
    () => ({ teamId: targetProp.teamId, instanceId: targetProp.instanceId }),
    [targetProp.teamId, targetProp.instanceId],
  )
  const {
    dashboard,
    loadError,
    timeSel,
    setTimeSel,
    range,
    vars,
    datasourceVars,
    repeatValues,
    varTexts,
    sel,
    setSel,
    setSelTexts,
    openRows,
    setOpenRows,
  } = useGrafanaDashboard(target, uid, refreshKey, pollTick)

  const { linkForRow } = useWorkspaceRowLink()
  const getPanelLink = useCallback(
    (p: Panel) => {
      const teamSeg = encodeURIComponent(target.teamId)
      const instanceSeg = encodeURIComponent(target.instanceId)
      const uidSeg = encodeURIComponent(uid)

      return linkForRow({
        path: `/teams/${teamSeg}/observability/grafana/${instanceSeg}/dashboards/${uidSeg}?viewPanel=${encodeURIComponent(String(p.id))}`,
      })
    },
    [linkForRow, target.teamId, target.instanceId, uid],
  )
  const { onRowContextMenu: onPanelContextMenu, menu: panelMenu } =
    useLinkOnlyRowMenu<Panel>(getPanelLink)
  const onToggleRow = useCallback(
    (key: string, nextOpen: boolean) => setOpenRows((cur) => ({ ...cur, [key]: nextOpen })),
    [setOpenRows],
  )

  if (loadError) {
    return (
      <div className="flex-1 min-h-0 overflow-auto px-4 py-10 scrollbar-thin">
        <div className="mx-auto max-w-lg">
          <QueryError message={loadError} />
        </div>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading dashboard…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {panelMenu}
      {/* Variable / time-range pickers live on the global toolbar's filter
          row — the breadcrumb already carries the title, so the view renders
          no header bar of its own. */}
      {controlsSlot &&
        createPortal(
          <>
            {dashboard.variables.map((v) => (
              <VariablePicker
                key={v.name}
                target={target}
                variable={v}
                selected={sel[v.name] ?? []}
                displayText={varTexts[v.name] ?? ''}
                vars={vars}
                range={range}
                onChange={(nextValues, nextTexts) => {
                  setSel((cur) => ({ ...cur, [v.name]: nextValues }))
                  setSelTexts((cur) => ({ ...cur, [v.name]: nextTexts }))
                }}
              />
            ))}
            <TimeRangePicker sel={timeSel} range={range} onChange={setTimeSel} />
          </>,
          controlsSlot,
        )}

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-4">
        <DashboardGrid
          target={target}
          panels={dashboard.panels}
          range={range}
          vars={vars}
          datasourceVars={datasourceVars}
          repeatValues={repeatValues}
          varTexts={varTexts}
          openRows={openRows}
          onToggleRow={onToggleRow}
          onPanelContextMenu={onPanelContextMenu}
        />
      </div>
    </div>
  )
}
