import { Popover } from '@base-ui/react/popover'
import { useQuery } from '@tanstack/react-query'

import { t } from '../../../i18n'
import { teamMembersQuery } from '../../../lib/query/team'
import { Avatar } from '../../Avatar'

import type { TeamMember } from '../../../types'
import type { ReactNode } from 'react'

function TeamMemberCard({
  teamId,
  userId,
  label,
}: {
  teamId: string
  userId: string
  label: string
}) {
  const { data: members } = useQuery(teamMembersQuery(teamId))
  // Undefined while loading or after a failed read; null once known not to be a member.
  const member = members && (members.find((entry) => entry.id === userId) ?? null)

  return <MemberCard member={member} label={label} />
}

function MemberCard({ member, label }: { member: TeamMember | null | undefined; label: string }) {
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
        className="inline rounded px-0.5 font-medium text-primary bg-state-selected hover:bg-state-selected cursor-pointer"
        data-mention-user-id={userId}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-[1000]">
          <Popover.Popup className="w-[260px] rounded-xl border border-line-control/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none">
            {teamId ? (
              <TeamMemberCard teamId={teamId} userId={userId} label={label} />
            ) : (
              <MemberCard member={null} label={label} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
