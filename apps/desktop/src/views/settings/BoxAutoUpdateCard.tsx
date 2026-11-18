import { RefreshCw as RefreshIcon } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { UiIcon } from '../../components/ui/ui-icon'
import { t } from '../../i18n'

import { AdminOnlyHint } from './shared'

import type { AtlasTeam } from '../../types'

// Whether the team's cloud computers update Nuphos on their own once their agents are idle.
// On unless an administrator turned it off; a computer too old to run conversations updates
// either way (the backend's box-update).
export function BoxAutoUpdateCard({
  team,
  onTeamUpdated,
}: {
  team: AtlasTeam
  onTeamUpdated: (team: AtlasTeam) => void
}) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const enabled = team.boxAutoUpdate !== false
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    if (saving || !isAdmin) return
    setSaving(true)
    try {
      onTeamUpdated(await api.atlasSetTeamBoxAutoUpdate(team.id, next))
    } catch (err) {
      toast.apiError(t('Could not change automatic updates'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">{t('Cloud computer updates')}</h2>
        <p className="mt-1 text-[13px] text-tertiary">
          {t(
            "Update Nuphos on this workspace's cloud computers when a new release is out and their agents have been idle for 10 minutes. The update restarts Nuphos on the computer, which also stops terminals and programs open on it.",
          )}
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
        <UiIcon size={14} icon={RefreshIcon} className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-main">{t('Update automatically when idle')}</div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {enabled
              ? t('Cloud computers stay on the newest release.')
              : t(
                  'Administrators update each cloud computer from its card. One too old to run conversations still updates.',
                )}
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={!isAdmin || saving}
          label={enabled ? t('Turn off automatic updates') : t('Turn on automatic updates')}
          onChange={(next) => void toggle(next)}
        />
      </div>
      {!isAdmin && <AdminOnlyHint teamId={team.id} />}
    </div>
  )
}
