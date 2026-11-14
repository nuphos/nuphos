import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import clsx from 'clsx'
import { Check, Lock, Search, UserCheck, Users } from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { Checkbox } from '../../components/ui/checkbox'
import { InputGroup, InputGroupInput } from '../../components/ui/input-group'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { t } from '../../i18n'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import type { AccessMode } from './boxAccessPresentation'
import type { useBoxAccessChoice } from './useBoxAccessChoice'
import type { TeamMember } from '../../types'

/** Past this many members the list gets a search field. */
const SEARCH_FROM = 6
/** Avatars shown in a stack before "+N". */
const STACK = 4

const MODES: { mode: AccessMode; icon: typeof Users; title: string }[] = [
  { mode: 'private', icon: Lock, title: t('Private') },
  { mode: 'everyone', icon: Users, title: t('Everyone') },
  { mode: 'members', icon: UserCheck, title: t('Specific people') },
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
          className="-ml-1.5 rounded-full ring-2 ring-line-control first:ml-0"
        />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface-sunken px-1 text-[10.5px] font-medium text-secondary ring-2 ring-line-control">
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
          checked ? 'bg-state-selected' : 'hover:bg-state-hover',
        )}
      >
        <Avatar src={member.avatarURL} name={name} size={26} className="rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-main">{name}</span>
          {member.email && member.email !== name && (
            <span className="block truncate text-[11.5px] text-tertiary">{member.email}</span>
          )}
        </span>
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={t('Allow {name}', { name })}
        />
      </label>
    </li>
  )
}

/** Who may use a Box besides its owner and managers: no one, the whole team, or people picked here. */
export function BoxAccessFields({
  teamId,
  ownerUserId,
  choice,
}: {
  teamId: string
  /** The Box's owner; left out while it is being created, when that is the viewer. */
  ownerUserId?: string
  choice: ReturnType<typeof useBoxAccessChoice>
}) {
  const currentUserId = useCurrentUser()?.id
  const ownerId = ownerUserId ?? currentUserId
  const members = useTeamMembers(teamId)
  // The owner always uses their own Box, so they are never picked.
  const others = members.filter((member) => member.id !== ownerId)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? others.filter((member) =>
        `${memberDisplayName(member)} ${member.email}`.toLowerCase().includes(needle),
      )
    : others
  const picked = others.filter((member) => choice.chosen.has(member.id)).length
  const loaded = members.length > 0

  const descriptions: Record<AccessMode, string> = {
    private: t('Owner and managers only'),
    everyone: loaded ? t('All {n} in the team', { n: members.length }) : t('The whole team'),
    members: t('Pick who can use it'),
  }

  return (
    <div className="space-y-2">
      <RadioGroup
        value={choice.mode}
        onValueChange={(next: string) => choice.setMode(next as AccessMode)}
        aria-label={t('Who can use it')}
        className="grid grid-cols-3 gap-2"
      >
        {MODES.map(({ mode, icon: Icon, title }) => {
          const selected = choice.mode === mode

          return (
            <Radio.Root
              key={mode}
              value={mode}
              className={clsx(
                'relative flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-line-focus',
                selected
                  ? 'border-action-primary bg-state-selected'
                  : 'border-line-control bg-surface-sheet hover:border-line-control',
              )}
            >
              <Icon
                className={clsx('h-4 w-4', selected ? 'text-primary' : 'text-tertiary')}
                aria-hidden="true"
              />
              <span className="text-[13px] font-semibold text-main">{title}</span>
              <span className="text-[11.5px] leading-4 text-tertiary">{descriptions[mode]}</span>
              <Radio.Indicator
                keepMounted
                className={clsx(
                  'absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full',
                  selected ? 'bg-action-primary text-inverse' : 'border border-line-control',
                )}
              >
                {selected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </Radio.Indicator>
            </Radio.Root>
          )
        })}
      </RadioGroup>
      <div className="rounded-xl border border-line-control">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[12px] text-secondary">
            {choice.mode === 'everyone'
              ? t('Everyone can use it, including people who join later.')
              : t('Its owner and managers can always use it.')}
          </span>
          {choice.mode === 'everyone' && <AvatarStack members={members} />}
        </div>
        {choice.mode === 'members' && (
          <div className="border-t border-line-control px-1.5 pb-1.5 pt-2">
            <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary">
                {t('Members')}
              </span>
              <span className="text-[11.5px] tabular-nums text-tertiary">
                {t('{picked} of {total} selected', { picked, total: others.length })}
              </span>
            </div>
            {others.length > SEARCH_FROM && (
              <InputGroup
                render={<label />}
                className="mx-1.5 mb-1.5 flex h-8 items-center gap-2 rounded-md border border-line-control bg-surface px-2.5 text-tertiary"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <InputGroupInput
                  aria-label={t('Search members')}
                  placeholder={t('Search by name or email')}
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
                  {t('No one else is in this team yet.')}
                </li>
              )}
              {others.length > 0 && shown.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-tertiary">{t('No one matches.')}</li>
              )}
            </ul>
            {others.length > 0 && picked === 0 && (
              <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-tertiary">
                {t('No one picked yet, so it stays private.')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
