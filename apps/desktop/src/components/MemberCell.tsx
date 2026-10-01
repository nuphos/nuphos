import clsx from 'clsx'

import { memberDisplayName } from '../lib/bindingAccess'

import { Avatar } from './Avatar'

import type { TeamMember } from '../types'

/**
 * A team member as a table cell: avatar, name, and the email beneath it.
 *
 * Shared so every "who" column in the app reads the same — a person is the same
 * person whether they created a plan or a trigger runs as them.
 */
export function MemberCell({
  member,
  compact = false,
}: {
  member: TeamMember | null
  /**
   * One line: avatar and name only, with the email in the tooltip. For tables
   * whose other columns are single-line — a two-line cell there sets the row
   * height for every row, including the ones that had nothing to say.
   */
  compact?: boolean
}) {
  if (!member) {
    return compact ? (
      <div className="flex items-center gap-2 min-w-0 text-tertiary text-[12px]">
        <div className="h-5 w-5 flex-shrink-0 rounded-[5px] bg-zGray-850" />
        <span className="truncate">Unknown member</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 min-w-0 text-tertiary text-[12px]">
        <div className="w-6 h-6 rounded-[5px] bg-zGray-850 flex-shrink-0" />
        <div className="min-w-0">
          <div className="truncate">Unknown member</div>
          <div className="truncate text-[11px]">Not in current team</div>
        </div>
      </div>
    )
  }
  const name = memberDisplayName(member)
  // A removed teammate still owns what they created, and a trigger can still be
  // running as them — show their identity, dimmed, with a "Former member" tag
  // instead of the second line's email.
  const isFormer = Boolean(member.removedAt)
  const title = `${name} <${member.email}>${isFormer ? ' · Former member' : ''}`

  if (compact) {
    // The email and the Former-member note live in the tooltip here; keeping
    // them visible is what makes the two-line variant tall.
    return (
      <div
        className={clsx('flex min-w-0 items-center gap-2', isFormer && 'opacity-60')}
        title={title}
      >
        <Avatar
          src={member.avatarURL}
          name={name}
          size={20}
          className="rounded-[5px] !shadow-none flex-shrink-0"
        />
        <span className="truncate text-[12.5px] text-secondary">{name}</span>
      </div>
    )
  }

  return (
    <div
      className={clsx('flex items-center gap-2 min-w-0', isFormer && 'opacity-60')}
      title={title}
    >
      <Avatar
        src={member.avatarURL}
        name={name}
        size={24}
        className="rounded-[5px] !shadow-none flex-shrink-0"
      />
      <div className="min-w-0">
        <div className="text-secondary text-[12.5px] truncate">{name}</div>
        <div className="text-tertiary text-[11.5px] truncate">
          {isFormer ? 'Former member' : member.email}
        </div>
      </div>
    </div>
  )
}
