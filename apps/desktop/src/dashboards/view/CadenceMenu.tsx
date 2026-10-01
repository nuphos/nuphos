import { ChevronDown, Clock } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'

import { CADENCE_LABELS, describeCadence, describeNextRefresh } from './cadence'

import type { DashboardCadence } from './cadence'
import type { NuphosDashboard, NuphosDashboardDetail } from '../schema'

type Props = {
  teamId: string
  detail: NuphosDashboardDetail | null
  onSaved: (dashboard: NuphosDashboard) => void
}

const CADENCES = Object.keys(CADENCE_LABELS) as DashboardCadence[]

export function CadenceMenu({ teamId, detail, onSaved }: Props) {
  const [saving, setSaving] = useState(false)

  if (!detail) return null
  const { id, cadence, nextRefreshAt } = detail.dashboard

  const save = async (next: DashboardCadence | null) => {
    if (next === cadence) return
    setSaving(true)
    try {
      onSaved(await api.dashboardsUpdate(teamId, id, { cadence: next }))
    } catch (err) {
      toast.apiError('Could not update auto-refresh', err)
    } finally {
      setSaving(false)
    }
  }

  const title = cadence
    ? [describeCadence(cadence), nextRefreshAt && describeNextRefresh(nextRefreshAt)]
        .filter(Boolean)
        .join('\n')
    : 'Auto-refresh is off'

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            title={title}
            disabled={saving}
            className="flex h-7 items-center gap-1.5 rounded-md border border-zGray-800 px-2 text-[12px] text-secondary outline-none hover:bg-zGray-800 hover:text-main focus:border-zViolet-500 disabled:opacity-50"
          >
            <Clock className="h-3.5 w-3.5 text-tertiary" />
            Auto-refresh: {cadence ? CADENCE_LABELS[cadence] : 'Off'}
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
          </button>
        }
      />
      <MenuContent align="end">
        <MenuItem selected={!cadence} onClick={() => void save(null)}>
          Off
        </MenuItem>
        {CADENCES.map((c) => (
          <MenuItem key={c} selected={cadence === c} onClick={() => void save(c)}>
            {describeCadence(c)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
