import { faShareNodes } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { AdminOnlyHint } from './shared'

import type { TeamShareDefault } from '../../lib/bindingShare'
import type { AtlasTeam } from '../../types'

/** Whether connections members add from now on start shared with the whole team. */
export function BindingShareDefaultCard({
  team,
  onTeamUpdated,
}: {
  team: AtlasTeam & TeamShareDefault
  onTeamUpdated: (team: AtlasTeam) => void
}) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const shared = team.bindingShareDefault === 'team'
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    if (saving || !isAdmin) return
    setSaving(true)
    try {
      onTeamUpdated(await api.atlasSetTeamBindingShareDefault(team.id, next ? 'team' : 'private'))
    } catch (err) {
      toast.apiError(t('Could not update the default for new connections'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">{t('New connections')}</h2>
        <p className="mt-1 text-[13px] text-tertiary">
          {t(
            'New connections start private to the member who adds them. Turn this on to share them with everyone by default; cloud accounts, clusters and other high-privilege connections still start private.',
          )}
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
        <FontAwesomeIcon icon={faShareNodes} className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1 text-[12.5px] text-main">
          {t('Share new connections with everyone in the team')}
        </div>
        <Switch
          checked={shared}
          disabled={!isAdmin || saving}
          label={t('Share new connections with everyone in the team')}
          onChange={(next) => void toggle(next)}
        />
      </div>
      {!isAdmin && <AdminOnlyHint teamId={team.id} />}
    </div>
  )
}
