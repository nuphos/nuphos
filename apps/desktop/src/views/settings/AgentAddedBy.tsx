import { useQuery } from '@tanstack/react-query'

import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Avatar } from '../../components/Avatar'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { memberDisplayName } from '../../lib/bindingAccess'
import { teamRosterQuery } from '../../lib/query/team'

import { signedInAs } from './agentPresentation'

type MemberMark = { userId: string; at: string }

/** A line naming the member who did something to an agent, and when. */
function MemberLine({
  teamId,
  mark,
  text,
}: {
  teamId: string
  mark: MemberMark
  text: (name: string) => string
}) {
  // Without the roster the line is left out.
  const { data: members } = useQuery(teamRosterQuery(teamId))

  if (!members) return null
  const member = members.find((candidate) => candidate.id === mark.userId)
  const current = member && !member.removedAt ? member : undefined
  const name = current ? memberDisplayName(current) : t('a former member')

  return (
    <p
      className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-tertiary"
      title={new Date(mark.at).toLocaleString()}
    >
      {current && (
        <Avatar src={current.avatarURL} name={name} size={16} className="shrink-0 rounded-full" />
      )}
      <span className="truncate">{text(name)}</span>
    </p>
  )
}

/** Who added a Box's agent and when; mounted only for agents that have it. */
export function AgentAddedBy({ teamId, addedBy }: { teamId: string; addedBy: MemberMark }) {
  return (
    <MemberLine
      teamId={teamId}
      mark={addedBy}
      text={(name) =>
        t('Added by {name} · {time}', { name, time: relativeTimeFromNow(addedBy.at) })
      }
    />
  )
}

/** Whose account a computer's agent runs as; mounted only while someone signed it in. */
export function AgentSignedInBy({
  teamId,
  signedInBy,
}: {
  teamId: string
  signedInBy: MemberMark
}) {
  const viewerId = useCurrentUser()?.id

  return (
    <MemberLine
      teamId={teamId}
      mark={signedInBy}
      text={(name) => signedInAs(name, signedInBy.userId, viewerId)}
    />
  )
}
