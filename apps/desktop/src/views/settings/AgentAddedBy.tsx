import { useQuery } from '@tanstack/react-query'

import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Avatar } from '../../components/Avatar'
import { t } from '../../i18n'
import { memberDisplayName } from '../../lib/bindingAccess'
import { teamRosterQuery } from '../../lib/query/team'

import type { LocalRuntimeSummary } from '../../types/runtime'

/** Who added a Box's agent, or signed it in, and when; mounted only for agents that have it. */
export function AgentAddedBy({
  teamId,
  addedBy,
  signedIn = false,
}: {
  teamId: string
  addedBy: NonNullable<LocalRuntimeSummary['addedBy']>
  /** The account the agent runs on is this member's, for everyone who uses the computer. */
  signedIn?: boolean
}) {
  // Without the roster the line is left out.
  const { data: members } = useQuery(teamRosterQuery(teamId))

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
        {signedIn
          ? t('Signed in by {name} · {time}', { name, time: relativeTimeFromNow(addedBy.at) })
          : t('Added by {name} · {time}', { name, time: relativeTimeFromNow(addedBy.at) })}
      </span>
    </p>
  )
}
