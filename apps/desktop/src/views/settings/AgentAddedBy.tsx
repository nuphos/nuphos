import { useEffect } from 'react'

import { api } from '../../api'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Avatar } from '../../components/Avatar'
import { t } from '../../i18n'
import { memberDisplayName } from '../../lib/bindingAccess'
import { readSwrCache, useSwrCache, writeSwrCache } from '../../lib/swrCache'

import type { TeamMember } from '../../types'
import type { LocalRuntimeSummary } from '../../types/runtime'

// One request per team however many agents are opened; removed members say who left.
const loading = new Set<string>()

function useTeamRoster(teamId: string): TeamMember[] | undefined {
  const key = `team-members-with-removed:${teamId}`
  const members = useSwrCache<TeamMember[]>(key)

  useEffect(() => {
    if (readSwrCache(key) !== undefined || loading.has(key)) return
    loading.add(key)
    void api
      .atlasListTeamMembers(teamId, true)
      // Without the roster the line is left out; the next agent opened asks again.
      .then((items) => writeSwrCache(key, items))
      .catch(() => null)
      .finally(() => loading.delete(key))
  }, [key, teamId])

  return members
}

/** Who added a Box's agent and when; mounted only for agents that have it. */
export function AgentAddedBy({
  teamId,
  addedBy,
}: {
  teamId: string
  addedBy: NonNullable<LocalRuntimeSummary['addedBy']>
}) {
  const members = useTeamRoster(teamId)

  if (!members) return null
  const member = members.find((candidate) => candidate.id === addedBy.userId)
  const current = member && !member.removedAt ? member : undefined
  const name = current ? memberDisplayName(current) : t('a former member')

  return (
    <p
      className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-tertiary"
      title={new Date(addedBy.at).toLocaleString()}
    >
      {current && (
        <Avatar src={current.avatarURL} name={name} size={16} className="shrink-0 rounded-full" />
      )}
      <span className="truncate">
        {t('Added by {name} · {time}', { name, time: relativeTimeFromNow(addedBy.at) })}
      </span>
    </p>
  )
}
