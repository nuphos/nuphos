import clsx from 'clsx'
import { Users } from 'lucide-react'

import { Avatar } from '../../components/Avatar'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'

import type { TeamMember } from '../../types'

export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'h-7 rounded-md px-2.5 text-[12px] transition-colors',
            value === tab.value
              ? 'bg-zGray-800 text-main'
              : 'text-tertiary hover:bg-zGray-800/50 hover:text-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Narrow the list to one execution principal — the "Runs as" column.
 *
 * A menu rather than more chips: a team has as many members as it has, and the
 * two chip groups beside it already fill the row. Only principals that own
 * something are offered; see rowPrincipalIds.
 */
export function PrincipalFilter({
  members,
  principalIds,
  value,
  onChange,
}: {
  members: TeamMember[]
  /** Owners present in the list, in list order. */
  principalIds: string[]
  value: string | null
  onChange: (next: string | null) => void
}) {
  const owners = principalIds.map(
    (id) => members.find((member) => member.id === id) ?? { id, name: id, email: '' },
  )
  const selected = owners.find((member) => member.id === value)
  const label = selected ? `Runs as ${selected.name || selected.email}` : 'Runs as anyone'

  return (
    <Menu>
      <MenuTrigger
        className={clsx(
          'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors',
          'data-[popup-open]:bg-zGray-800 data-[popup-open]:text-main',
          value ? 'bg-zGray-800 text-main' : 'text-tertiary hover:bg-zGray-800/50',
        )}
        title={label}
      >
        {selected ? (
          <Avatar
            src={'avatarURL' in selected ? selected.avatarURL : undefined}
            name={selected.name}
            size={16}
            className="rounded-full"
          />
        ) : (
          <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        <span className="max-w-[120px] truncate">
          {selected ? selected.name || selected.email : 'Anyone'}
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="w-[220px]">
        <MenuItem
          icon={<Users className="h-3.5 w-3.5" strokeWidth={1.8} />}
          selected={!value}
          onClick={() => onChange(null)}
        >
          Anyone
        </MenuItem>
        {owners.map((member) => (
          <MenuItem
            key={member.id}
            icon={
              <Avatar
                src={'avatarURL' in member ? member.avatarURL : undefined}
                name={member.name}
                size={16}
                className="rounded-full"
              />
            }
            selected={value === member.id}
            onClick={() => onChange(member.id)}
          >
            <span className="truncate">{member.name || member.email}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
