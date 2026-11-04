import { ChevronDown, Lock, Users } from 'lucide-react'

import { t } from '../../i18n'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'

import type { GeneralAccess } from '../../api/agent-types'

// Who may open the session without an invite. Replying takes an invite and
// the computer the session runs on, so the team as a whole can only read. A
// chat has no computer: the whole team may post in it too.

const GENERAL_OPTIONS: { value: GeneralAccess; title: string; detail: string }[] = [
  {
    value: 'none',
    title: t('Only people invited'),
    detail: t('Only you and the people you invite'),
  },
  { value: 'view', title: t('Everyone in the team'), detail: t('Can view') },
  { value: 'reply', title: t('Everyone in the team'), detail: t('Can view and reply') },
]

/** Who in the team can read the session without an invite. */
export function GeneralAccessRow({
  value,
  canManage,
  chat,
  onChange,
}: {
  value: GeneralAccess
  canManage: boolean
  chat?: boolean
  onChange: (value: GeneralAccess) => void
}) {
  const options = GENERAL_OPTIONS.filter((option) => chat || option.value !== 'reply')
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
        {options.map((option) => (
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

const TRIGGER =
  'flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[12px] text-secondary transition-colors hover:bg-zGray-800/60 hover:text-main data-[popup-open]:bg-zGray-800/60 disabled:pointer-events-none'

/**
 * What one participant may do, for the owner to act on. Someone who reads only
 * cannot use the session's computer yet; letting them reply offers it to them.
 */
export function ParticipantMenu({
  canReply,
  disabled,
  onAllowReply,
  onRemove,
}: {
  canReply: boolean
  disabled?: boolean
  onAllowReply: () => void
  onRemove: () => void
}) {
  return (
    <Menu>
      <MenuTrigger className={TRIGGER} disabled={disabled}>
        {canReply ? t('Can reply') : t('Can view')}
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </MenuTrigger>
      <MenuContent align="end" className="w-[220px]">
        {!canReply && (
          <>
            <MenuItem onClick={onAllowReply}>
              <span className="block">{t('Let them reply')}</span>
              <span className="block text-[11px] text-tertiary">
                {t('They can reply once they can use the computer this agent runs on.')}
              </span>
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem destructive onClick={onRemove}>
          {t('Remove')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
