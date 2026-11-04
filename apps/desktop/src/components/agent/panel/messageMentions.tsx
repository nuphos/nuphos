import { Popover } from '@base-ui/react/popover'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { Avatar } from '../../Avatar'

import type { TeamMember } from '../../../types'
import type { ReactNode } from 'react'

const membersByTeam = new Map<string, Promise<TeamMember[]>>()

/** One fetch per team for every chip a transcript shows; a failure is retried next time. */
function teamMembers(teamId: string): Promise<TeamMember[]> {
  let members = membersByTeam.get(teamId)

  if (!members) {
    members = api.atlasListTeamMembers(teamId).catch(() => {
      membersByTeam.delete(teamId)

      return []
    })
    membersByTeam.set(teamId, members)
  }

  return members
}

function MemberCard({ teamId, userId, label }: { teamId?: string; userId: string; label: string }) {
  const [found, setFound] = useState<{ key: string; member: TeamMember | null } | null>(null)
  const key = `${teamId ?? ''}/${userId}`

  useEffect(() => {
    let alive = true

    if (teamId)
      void teamMembers(teamId).then((members) => {
        if (alive) setFound({ key, member: members.find((entry) => entry.id === userId) ?? null })
      })

    return () => {
      alive = false
    }
  }, [key, teamId, userId])
  // Undefined while loading; null once known not to be a member.
  let member: TeamMember | null | undefined = teamId ? undefined : null

  if (found?.key === key) member = found.member
  const name = member?.name || member?.username || label

  return (
    <div className="flex min-w-0 items-center gap-2.5 p-3">
      <Avatar src={member?.avatarURL} name={name} size={36} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-main">{name}</div>
        {member?.email && member.email !== name && (
          <div className="truncate text-[12px] text-tertiary">{member.email}</div>
        )}
        {member === null && (
          <div className="text-[12px] text-tertiary">{t('No longer in this team')}</div>
        )}
      </div>
    </div>
  )
}

export function MemberMention({
  teamId,
  userId,
  children,
}: {
  teamId?: string
  userId: string
  children: ReactNode
}) {
  const label = typeof children === 'string' ? children.replace(/^@/, '') : userId

  return (
    <Popover.Root>
      <Popover.Trigger
        className="inline rounded px-0.5 font-medium text-zViolet-accent bg-zViolet-accent/15 hover:bg-zViolet-accent/25 cursor-pointer"
        data-mention-user-id={userId}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup className="w-[260px] rounded-xl border border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none">
            <MemberCard teamId={teamId} userId={userId} label={label} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
