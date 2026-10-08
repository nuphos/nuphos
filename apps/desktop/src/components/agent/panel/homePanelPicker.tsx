import { ChevronRight, LayoutDashboard } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
} from '../../ui/menu'

import { panelKey } from './homeWidgetSettings'

import type { HomePanel } from './homeWidgetSettings'
import type { NuphosDashboard } from '../../../dashboards/schema'

const chevron = <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />

type PanelOption = { id: string; title: string }

function DashboardSubmenu({
  teamId,
  dashboard,
  selected,
  onToggle,
}: {
  teamId: string
  dashboard: NuphosDashboard
  selected: Set<string>
  onToggle: (pin: HomePanel) => void
}) {
  const [panels, setPanels] = useState<PanelOption[] | null>(null)
  const load = () => {
    if (panels) return
    api.dashboardsGet(teamId, dashboard.id).then(
      (detail) => setPanels(detail.panels.map((p) => ({ id: p.id, title: p.title }))),
      () => setPanels([]),
    )
  }

  return (
    <MenuSubmenu onOpenChange={(open) => open && load()}>
      <MenuSubmenuTrigger chevron={chevron}>
        <span className="block min-w-0 flex-1 truncate">{dashboard.name}</span>
      </MenuSubmenuTrigger>
      <MenuContent side="inline-end" align="start" className="w-[260px]">
        {panels === null && <MenuItem disabled>Loading panels…</MenuItem>}
        {panels?.length === 0 && <MenuItem disabled>No panels</MenuItem>}
        {panels?.map((p) => {
          const pin = { dashboardId: dashboard.id, panelId: p.id }

          return (
            <MenuCheckboxItem
              key={p.id}
              checked={selected.has(panelKey(pin))}
              onCheckedChange={() => onToggle(pin)}
            >
              <span className="block truncate">{p.title}</span>
            </MenuCheckboxItem>
          )
        })}
      </MenuContent>
    </MenuSubmenu>
  )
}

/** "Dashboard panels" in Customize: dashboards, then the panels of the one hovered. */
export function DashboardPanelsSubmenu({
  teamId,
  selected,
  onToggle,
}: {
  teamId: string
  selected: HomePanel[]
  onToggle: (pin: HomePanel) => void
}) {
  const [dashboards, setDashboards] = useState<NuphosDashboard[] | null>(null)
  const selectedKeys = new Set(selected.map(panelKey))
  const load = () => {
    if (dashboards) return
    api.dashboardsList(teamId).then(setDashboards, () => setDashboards([]))
  }

  return (
    <MenuSubmenu onOpenChange={(open) => open && load()}>
      <MenuSubmenuTrigger
        icon={<LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.8} />}
        chevron={chevron}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-1">Dashboard panels</span>
          <span className="text-[10.5px] text-tertiary tabular-nums">
            {selected.length || 'Off'}
          </span>
        </span>
      </MenuSubmenuTrigger>
      <MenuContent side="inline-end" align="start" className="w-[240px]">
        {dashboards === null && <MenuItem disabled>Loading dashboards…</MenuItem>}
        {dashboards?.length === 0 && <MenuItem disabled>No dashboards yet</MenuItem>}
        {dashboards?.map((d) => (
          <DashboardSubmenu
            key={d.id}
            teamId={teamId}
            dashboard={d}
            selected={selectedKeys}
            onToggle={onToggle}
          />
        ))}
      </MenuContent>
    </MenuSubmenu>
  )
}
