import { ChevronDown, Lock, Users } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useTeamRole } from '../../hooks/useTeamRole'
import { t } from '../../i18n'

import { isPersonal, moveTarget } from './visibility'

import type { DashboardVisibility, NuphosDashboard, NuphosDashboardDetail } from '../schema'

type Props = {
  teamId: string
  detail: NuphosDashboardDetail | null
  onSaved: (dashboard: NuphosDashboard) => void
}

/** Who can see the dashboard, as its label's tooltip says. */
function visibilityTitle(personal: boolean, tookOver: boolean) {
  if (tookOver) return t('Its creator is no longer in the team. Only Administrators can see it.')

  return personal
    ? t('Only you can see this dashboard.')
    : t('Everyone in the team can see this dashboard.')
}

// Sized like the time-range picker beside it in the dashboard's toolbar.
const CHIP =
  'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-control bg-surface-sheet px-2.5 text-[12.5px] text-main outline-none'

/**
 * Who sees the open dashboard, Personal or Team. Its creator moves it from here;
 * everyone else sees the label only.
 */
export function VisibilityMenu({ teamId, detail, onSaved }: Props) {
  const [saving, setSaving] = useState(false)
  const role = useTeamRole(teamId)
  const userId = useCurrentUser()?.id

  if (!detail) return null
  const { dashboard } = detail
  const personal = isPersonal(dashboard)
  const Icon = personal ? Lock : Users
  const label = personal ? t('Personal') : t('Team')

  // Editable yet another member's personal dashboard: one an Administrator took over
  // because its creator is no longer in the team.
  const tookOver = personal && dashboard.createdBy !== userId && detail.canEdit === true
  const target = moveTarget(dashboard, userId, role, !tookOver)
  const title = visibilityTitle(personal, tookOver)

  if (!target) {
    return (
      <span title={title} className={CHIP}>
        <Icon className="h-3.5 w-3.5 text-tertiary" />
        {label}
      </span>
    )
  }

  const save = async (visibility: DashboardVisibility) => {
    setSaving(true)
    try {
      onSaved(await api.dashboardsUpdate(teamId, dashboard.id, { visibility }))
    } catch (err) {
      toast.apiError(t('Could not move dashboard'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            title={title}
            disabled={saving}
            className={`${CHIP} hover:bg-state-hover focus:border-line-focus disabled:opacity-50`}
          >
            <Icon className="h-3.5 w-3.5 text-tertiary" />
            {label}
            <ChevronDown className="h-3.5 w-3.5 text-tertiary" />
          </button>
        }
      />
      <MenuContent align="start">
        <MenuItem
          selected={personal}
          onClick={() => void (personal ? undefined : save('personal'))}
        >
          {t('Personal')}
        </MenuItem>
        <MenuItem selected={!personal} onClick={() => void (personal ? save(target) : undefined)}>
          {t('Team')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
