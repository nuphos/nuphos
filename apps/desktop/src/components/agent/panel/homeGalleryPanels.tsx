import clsx from 'clsx'
import { ChevronRight, LayoutDashboard } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { Checkbox } from '../../ui/checkbox'

import { panelKey } from './homeWidgetSettings'

import type { HomePanel } from './homeWidgetSettings'
import type { NuphosDashboard } from '../../../dashboards/schema'

type PanelOption = { id: string; title: string }

const rowClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-zGray-800/60 focus-visible:ring-2 focus-visible:ring-zViolet-accent'

function Skeleton() {
  return (
    <div className="space-y-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded-md bg-zGray-800/40 animate-pulse" />
      ))}
    </div>
  )
}

/** A dashboard that opens to its panels, each pinned or unpinned by its checkbox. */
function DashboardRow({
  teamId,
  dashboard,
  pinned,
  onToggle,
}: {
  teamId: string
  dashboard: NuphosDashboard
  pinned: Set<string>
  onToggle: (pin: HomePanel) => void
}) {
  const [open, setOpen] = useState(false)
  const [panels, setPanels] = useState<PanelOption[] | null>(null)
  const count = [...pinned].filter((key) => key.startsWith(`${dashboard.id}/`)).length
  const toggle = () => {
    setOpen(!open)
    if (panels) return
    api.dashboardsGet(teamId, dashboard.id).then(
      (detail) => setPanels(detail.panels.map((p) => ({ id: p.id, title: p.title }))),
      () => setPanels([]),
    )
  }

  return (
    <li>
      <button type="button" aria-expanded={open} onClick={toggle} className={rowClass}>
        <ChevronRight
          className={clsx(
            'h-3.5 w-3.5 flex-none text-tertiary transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          strokeWidth={2}
        />
        <LayoutDashboard className="h-3.5 w-3.5 flex-none text-secondary" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate text-main">{dashboard.name}</span>
        {count > 0 && (
          <span className="text-[11px] text-secondary tabular-nums">
            {count === 1 ? t('1 pinned') : t('{n} pinned', { n: count })}
          </span>
        )}
      </button>
      {open && (
        <div className="py-1 pl-7">
          {panels === null && <Skeleton />}
          {panels?.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-tertiary">{t('No panels')}</div>
          )}
          {panels?.map((p) => {
            const pin = { dashboardId: dashboard.id, panelId: p.id }

            return (
              <label key={p.id} className={clsx(rowClass, 'cursor-pointer')}>
                <Checkbox
                  checked={pinned.has(panelKey(pin))}
                  onCheckedChange={() => onToggle(pin)}
                  className="data-[checked]:border-zViolet-500 data-[checked]:bg-zViolet-500"
                />
                <span className="min-w-0 flex-1 truncate text-secondary">{p.title}</span>
              </label>
            )
          })}
        </div>
      )}
    </li>
  )
}

/** The gallery's dashboard panel picker: dashboards, each opening to its panels. */
export function GalleryPanelPicker({
  teamId,
  selected,
  onToggle,
}: {
  teamId: string
  selected: HomePanel[]
  onToggle: (pin: HomePanel) => void
}) {
  const [dashboards, setDashboards] = useState<NuphosDashboard[] | null>(null)
  const pinned = new Set(selected.map(panelKey))

  useEffect(() => {
    let alive = true

    api.dashboardsList(teamId).then(
      (list) => alive && setDashboards(list),
      () => alive && setDashboards([]),
    )

    return () => {
      alive = false
    }
  }, [teamId])

  if (dashboards === null) return <Skeleton />
  if (dashboards.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-[12.5px] text-tertiary">
        {t('No dashboards yet')}
      </div>
    )
  }

  return (
    <ul className="space-y-0.5">
      {dashboards.map((d) => (
        <DashboardRow
          key={d.id}
          teamId={teamId}
          dashboard={d}
          pinned={pinned}
          onToggle={onToggle}
        />
      ))}
    </ul>
  )
}
