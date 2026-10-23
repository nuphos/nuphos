import { useState } from 'react'

import { api } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'

import {
  CEILING_DESCRIPTION,
  SHARE_LEVEL_LABEL,
  SHARE_LEVELS,
} from './localAgentSharingPresentation'

import type { LocalShareLevel } from '../../api/device-types'
import type { AtlasTeam } from '../../types'

const CEILING_LABEL: Record<LocalShareLevel, string> = {
  off: 'Off',
  approve: SHARE_LEVEL_LABEL.approve,
  full: SHARE_LEVEL_LABEL.full,
}

/** The most a member may grant when sharing their own computer's local runtime; set by administrators. */
export function LocalAgentSharingCeilingCard({
  team,
  onTeamUpdated,
}: {
  team: AtlasTeam
  onTeamUpdated: (team: AtlasTeam) => void
}) {
  const isAdmin = team.role === 'ADMINISTRATOR'
  const value = team.localAgentSharing ?? 'approve'
  const [saving, setSaving] = useState(false)
  const save = async (level: LocalShareLevel) => {
    setSaving(true)
    try {
      onTeamUpdated(await api.atlasSetTeamLocalAgentSharing(team.id, level))
    } catch (error) {
      toast.apiError('Could not change computer sharing', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-main">Sharing members’ own computers</h2>
        <p className="mt-1 text-[13px] text-tertiary">
          Members can let chosen teammates run agents on their own computer’s local runtime. Those
          agents run as the computer’s owner, with every sign-in on it. Turning this off closes
          teammates’ open connections at once.
        </p>
      </div>
      <div className="flex items-center gap-4 rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5">
        <div className="min-w-0 flex-1 text-[12px] text-tertiary">{CEILING_DESCRIPTION[value]}</div>
        <span title={isAdmin ? undefined : 'Only workspace administrators can change this'}>
          <AppSelect
            size="sm"
            ariaLabel="The most a member may share"
            value={value}
            disabled={!isAdmin || saving}
            onValueChange={(next) => void save(next as LocalShareLevel)}
            options={SHARE_LEVELS.map((level) => ({ value: level, label: CEILING_LABEL[level] }))}
          />
        </span>
      </div>
    </div>
  )
}
