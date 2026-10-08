import { ChevronDown, Lock, Users } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'

import type { GeneralAccess, ParticipantRole } from '../../api/agent-types'

// The access controls in the Share card, modelled on Notion's: one team-wide
// grant, and a role per invited person that can raise it but not lower it.

const GENERAL_OPTIONS: { value: GeneralAccess; title: string; detail: string }[] = [
  { value: 'none', title: 'Only people invited', detail: 'Only you and the people you invite' },
  { value: 'view', title: 'Everyone in the team', detail: 'Can view' },
  { value: 'reply', title: 'Everyone in the team', detail: 'Can view and reply' },
]

const ROLE_LABEL: Record<ParticipantRole, string> = { reply: 'Can reply', view: 'Can view' }

const RANK: Record<GeneralAccess, number> = { none: 0, view: 1, reply: 2 }

const TRIGGER =
  'flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 disabled:pointer-events-none'

/** Who in the team can open the session without an invite. */
export function GeneralAccessRow({
  value,
  canManage,
  onChange,
}: {
  value: GeneralAccess
  canManage: boolean
  onChange: (value: GeneralAccess) => void
}) {
  const current = GENERAL_OPTIONS.find((option) => option.value === value) ?? GENERAL_OPTIONS[0]
  const Icon = value === 'none' ? Lock : Users
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
      <span className="min-w-0 flex-1 text-left leading-tight">
        <span className="block text-[12px] text-main">{current.title}</span>
        <span className="block text-[11px] text-tertiary">{current.detail}</span>
      </span>
    </>
  )

  if (!canManage) {
    return <div className="flex items-center gap-2 px-2.5 py-1.5">{body}</div>
  }

  return (
    <Menu>
      <MenuTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-zGray-800/40 data-[popup-open]:bg-zGray-800/40">
        {body}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={2} />
      </MenuTrigger>
      <MenuContent align="end" className="w-[240px]">
        {GENERAL_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === value}
            icon={
              option.value === 'none' ? (
                <Lock className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Users className="h-3.5 w-3.5" strokeWidth={2} />
              )
            }
            onClick={() => option.value !== value && onChange(option.value)}
          >
            <span className="block">{option.title}</span>
            <span className="block text-[11px] text-tertiary">{option.detail}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/**
 * A role picker. `floor` is the team-wide grant: a role below it would change
 * nothing, so it is offered disabled with the reason, the way Notion does.
 */
export function RoleMenu({
  value,
  floor = 'none',
  disabled,
  onChange,
  onRemove,
}: {
  value: ParticipantRole
  floor?: GeneralAccess
  disabled?: boolean
  onChange: (role: ParticipantRole) => void
  onRemove?: () => void
}) {
  const effective: ParticipantRole = RANK[floor] > RANK[value] ? (floor as ParticipantRole) : value

  return (
    <Menu>
      <MenuTrigger className={TRIGGER} disabled={disabled}>
        {ROLE_LABEL[effective]}
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </MenuTrigger>
      <MenuContent align="end" className="w-[200px]">
        {(['reply', 'view'] as const).map((role) => {
          const belowFloor = RANK[floor] > RANK[role]

          return (
            <MenuItem
              key={role}
              selected={role === effective}
              disabled={belowFloor}
              title={belowFloor ? 'Everyone in the team already has more access' : undefined}
              onClick={() => role !== value && onChange(role)}
            >
              {ROLE_LABEL[role]}
            </MenuItem>
          )
        })}
        {onRemove && (
          <>
            <MenuSeparator />
            <MenuItem destructive onClick={onRemove}>
              Remove
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
