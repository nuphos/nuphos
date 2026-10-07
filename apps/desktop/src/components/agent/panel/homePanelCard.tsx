import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { LayoutDashboard, PinOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { PanelOutputView } from '../../../dashboards/PanelOutputView'

import type { HomePanel } from './homeWidgetSettings'
import type { DashboardPanel } from '../../../dashboards/schema'

const REFRESH_MS = 60_000

type Loaded = { dashboardName: string; panel: DashboardPanel | null }

function lastOutput(panel: DashboardPanel) {
  const snapshot =
    panel.lastSuccessfulSnapshot ??
    (panel.currentSnapshot?.status === 'complete' ? panel.currentSnapshot : null)

  return snapshot?.output ?? null
}

/**
 * A dashboard panel pinned to the home page. It shows the panel's last stored
 * result and never runs the script: refreshing stays the dashboard's job, so
 * opening home costs a read, not a run on the team's runtime.
 */
export function DashboardPanelCard({
  teamId,
  pin,
  onUnpin,
}: {
  teamId: string
  pin: HomePanel
  /** Also the only way out for a pin whose panel was deleted, which Customize no longer lists. */
  onUnpin: () => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () =>
      void api.dashboardsGet(teamId, pin.dashboardId).then(
        (detail) => {
          if (!alive) return
          setLoaded({
            dashboardName: detail.dashboard.name,
            panel: detail.panels.find((p) => p.id === pin.panelId) ?? null,
          })
        },
        // A failed read keeps whatever was already showing.
        () => {
          if (alive) setLoaded((prev) => prev ?? { dashboardName: '', panel: null })
        },
      )

    refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [teamId, pin.dashboardId, pin.panelId])

  const panel = loaded?.panel ?? null
  const output = panel ? lastOutput(panel) : null
  let body = <div className="h-24 rounded-md bg-zGray-800/40 animate-pulse" />

  if (loaded && !panel) {
    body = (
      <div className="px-1 py-1.5 text-[12px] text-tertiary">This panel is no longer available</div>
    )
  } else if (panel && output) {
    body = <PanelOutputView output={output} />
  } else if (panel) {
    body = <div className="px-1 py-1.5 text-[12px] text-tertiary">No data yet</div>
  }

  return (
    <section
      className={clsx(
        'min-w-0 rounded-lg border border-zGray-800/60 p-3',
        // Charts and tables need the width; a single number does not.
        output?.kind !== 'scalar' && 'home-card-wide',
      )}
    >
      <div className="group mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <LayoutDashboard className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
        <span className="truncate">{panel?.title ?? 'Dashboard panel'}</span>
        {loaded?.dashboardName && (
          <span className="truncate text-tertiary">· {loaded.dashboardName}</span>
        )}
        <BaseButton
          onClick={onUnpin}
          aria-label="Unpin from home"
          title="Unpin from home"
          className="ml-auto flex-shrink-0 rounded p-0.5 text-tertiary opacity-0 outline-none transition-opacity hover:text-main focus-visible:opacity-100 group-hover:opacity-100"
        >
          <PinOff className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BaseButton>
      </div>
      {body}
    </section>
  )
}
