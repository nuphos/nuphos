import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import clsx from 'clsx'
import { Check, Search, ShieldCheck, UserCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { Checkbox } from '../../components/ui/checkbox'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import type { AccessMode } from './boxAccessPresentation'
import type { useBoxAccessChoice } from './useBoxAccessChoice'
import type { TeamMember } from '../../types'

/** Past this many members the list gets a search field. */
const SEARCH_FROM = 6
/** Avatars shown in a stack before "+N". */
const STACK = 4

const MODES: { mode: AccessMode; icon: typeof Users; title: string }[] = [
  { mode: 'admins', icon: ShieldCheck, title: 'Admins only' },
  { mode: 'everyone', icon: Users, title: 'Everyone' },
  { mode: 'members', icon: UserCheck, title: 'Specific people' },
]

function AvatarStack({ members }: { members: TeamMember[] }) {
  const extra = members.length - STACK

  return (
    <span className="flex items-center" title={members.map(memberDisplayName).join(', ')}>
      {members.slice(0, STACK).map((member) => (
        <Avatar
          key={member.id}
          src={member.avatarURL}
          name={memberDisplayName(member)}
          size={22}
          className="-ml-1.5 rounded-full ring-2 ring-zGray-900 first:ml-0"
        />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-zGray-800 px-1 text-[10.5px] font-medium text-secondary ring-2 ring-zGray-900">
          +{extra}
        </span>
      )}
    </span>
  )
}

function MemberRow({
  member,
  checked,
  onToggle,
}: {
  member: TeamMember
  checked: boolean
  onToggle: () => void
}) {
  const name = memberDisplayName(member)

  return (
    <li>
      <label
        className={clsx(
          'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
          checked ? 'bg-zViolet-accent/10' : 'hover:bg-zGray-800/50',
        )}
      >
        <Avatar src={member.avatarURL} name={name} size={26} className="rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-main">{name}</span>
          {member.email && member.email !== name && (
            <span className="block truncate text-[11.5px] text-tertiary">{member.email}</span>
          )}
        </span>
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Allow ${name}`} />
      </label>
    </li>
  )
}

/** Who may use a Box: its admins only, everyone in the team, or specific people picked here. */
export function BoxAccessFields({
  teamId,
  choice,
}: {
  teamId: string
  choice: ReturnType<typeof useBoxAccessChoice>
}) {
  const members = useTeamMembers(teamId)
  const admins = members.filter((member) => member.role === 'ADMINISTRATOR')
  // Admins always use and manage a Box, so they are never picked.
  const others = members.filter((member) => member.role !== 'ADMINISTRATOR')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? others.filter((member) =>
        `${memberDisplayName(member)} ${member.email}`.toLowerCase().includes(needle),
      )
    : others
  const picked = others.filter((member) => choice.chosen.has(member.id)).length
  const { settle } = choice
  const loaded = members.length > 0

  useEffect(() => {
    if (loaded) settle(new Set(others.map((member) => member.id)))
    // Once, when the members arrive: settling again would undo the caller's own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const descriptions: Record<AccessMode, string> = {
    admins: 'Only team admins',
    everyone: loaded ? `All ${String(members.length)} in the team` : 'The whole team',
    members: 'Pick who can use it',
  }

  return (
    <div className="space-y-2">
      <RadioGroup
        value={choice.mode}
        onValueChange={(next: string) => choice.setMode(next as AccessMode)}
        aria-label="Who can use it"
        className="grid grid-cols-3 gap-2"
      >
        {MODES.map(({ mode, icon: Icon, title }) => {
          const selected = choice.mode === mode

          return (
            <Radio.Root
              key={mode}
              value={mode}
              className={clsx(
                'relative flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zViolet-accent',
                selected
                  ? 'border-zViolet-accent bg-zViolet-accent/10'
                  : 'border-zGray-800 bg-zGray-900 hover:border-zGray-700',
              )}
            >
              <Icon
                className={clsx('h-4 w-4', selected ? 'text-zViolet-accent' : 'text-tertiary')}
                aria-hidden="true"
              />
              <span className="text-[13px] font-semibold text-main">{title}</span>
              <span className="text-[11.5px] leading-4 text-tertiary">{descriptions[mode]}</span>
              <Radio.Indicator
                keepMounted
                className={clsx(
                  'absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full',
                  selected ? 'bg-zViolet-accent text-white' : 'border border-zGray-700',
                )}
              >
                {selected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </Radio.Indicator>
            </Radio.Root>
          )
        })}
      </RadioGroup>
      <div className="rounded-xl border border-zGray-800">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[12px] text-secondary">
            {choice.mode === 'everyone'
              ? 'Everyone can use it, including people who join later. Only admins manage it.'
              : 'Admins always use and manage it.'}
          </span>
          <AvatarStack members={choice.mode === 'everyone' ? members : admins} />
        </div>
        {choice.mode === 'members' && (
          <div className="border-t border-zGray-800 px-1.5 pb-1.5 pt-2">
            <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
                Members
              </span>
              <span className="text-[11.5px] tabular-nums text-tertiary">
                {picked} of {others.length} selected
              </span>
            </div>
            {others.length > SEARCH_FROM && (
              <InputGroup
                render={<label />}
                className="mx-1.5 mb-1.5 flex h-8 items-center gap-2 rounded-md border border-zGray-800 bg-surface px-2.5 text-tertiary"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <InputGroupInput
                  aria-label="Search members"
                  placeholder="Search by name or email"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-w-0 flex-1 text-[12.5px] text-main placeholder:text-tertiary"
                />
              </InputGroup>
            )}
            <ul className="max-h-52 space-y-0.5 overflow-y-auto">
              {shown.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  checked={choice.chosen.has(member.id)}
                  onToggle={() => choice.toggle(member.id)}
                />
              ))}
              {loaded && others.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-tertiary">
                  Everyone else in the team is an admin.
                </li>
              )}
              {others.length > 0 && shown.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-tertiary">No one matches.</li>
              )}
            </ul>
            {others.length > 0 && picked === 0 && (
              <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-tertiary">
                No one picked yet, so only admins can use it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
