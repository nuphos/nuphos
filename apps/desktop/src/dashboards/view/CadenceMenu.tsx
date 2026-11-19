import { ChevronDown, Clock } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { CADENCE_LABELS, describeCadence, describeNextRefresh } from './cadence'

import type { DashboardCadence, NuphosDashboard, NuphosDashboardDetail } from '../schema'

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
      toast.apiError(t('Could not update auto-refresh'), err)
    } finally {
      setSaving(false)
    }
  }

  // A narrow toolbar hides the "Auto-refresh:" prefix, so the name and tooltip keep it.
  const title = cadence
    ? [
        `${t('Auto-refresh:')} ${describeCadence(cadence)}`,
        nextRefreshAt && describeNextRefresh(nextRefreshAt),
      ]
        .filter(Boolean)
        .join('\n')
    : t('Auto-refresh is off')
  const name = cadence ? `${t('Auto-refresh:')} ${CADENCE_LABELS[cadence]}` : title

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            title={title}
            aria-label={name}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-control px-2.5 text-[12.5px] text-secondary outline-none hover:bg-state-hover hover:text-main focus:border-line-focus disabled:opacity-50"
          >
            <Clock className="h-3.5 w-3.5 text-tertiary" />
            <span className="hidden @xl:inline">{t('Auto-refresh:')}</span>
            {cadence ? CADENCE_LABELS[cadence] : t('Off')}
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
          </button>
        }
      />
      <MenuContent align="end">
        <MenuItem selected={!cadence} onClick={() => void save(null)}>
          {t('Off')}
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
