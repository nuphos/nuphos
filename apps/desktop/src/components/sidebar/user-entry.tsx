import { LogOut, Settings, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { backendHost } from '../../lib/backendHost'
import { Avatar } from '../Avatar'
import { Kbd } from '../ui/kbd'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../ui/menu'

import type { AccountChange, OtherAccount, UserInfo } from '../../types'

/** The backend an account belongs to, when it is not the one this app is on. */
function otherBackend(apiUrl: string | undefined): string | null {
  return apiUrl === window.api.apiUrlSync() ? null : backendHost(apiUrl)
}

function AccountIdentity({
  user,
  size,
  detail,
}: {
  user: UserInfo | undefined
  size: number
  detail?: string | null
}) {
  const name = user ? user.name || user.username || user.email : 'Unknown account'
  const email = user?.email && user.email !== name ? user.email : null
  const sub = [email, detail].filter(Boolean).join(' · ')

  return (
    <>
      <Avatar
        src={user?.avatarURL}
        name={name}
        size={size}
        className="rounded-full !shadow-none flex-shrink-0"
      />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-main">{name}</div>
        {sub && <div className="truncate text-[12px] text-tertiary">{sub}</div>}
      </div>
    </>
  )
}

export function SidebarUserEntry({
  user,
  onOpenUserSettings,
  onLogout,
}: {
  user: UserInfo
  onOpenUserSettings?: () => void
  onLogout: (change?: AccountChange) => void
}) {
  const name = user.name || user.username || user.email
  const [others, setOthers] = useState<OtherAccount[]>([])

  // Read on every open: another window or the CLI may have signed in since.
  const refreshOthers = (open: boolean) => {
    if (!open) return
    api
      .authAccounts()
      .then(setOthers)
      .catch(() => setOthers([]))
  }

  return (
    <Menu onOpenChange={refreshOthers}>
      <MenuTrigger className="titlebar-no-drag min-w-0 flex-1 h-9 flex items-center gap-2.5 px-2 rounded-lg text-[13.5px] text-main outline-none transition-colors hover:bg-[var(--sidebar-overlay-hover)] focus-visible:bg-[var(--sidebar-overlay-focus)] data-[popup-open]:bg-[var(--sidebar-overlay-active)]">
        <Avatar
          src={user.avatarURL}
          name={name}
          size={22}
          className="rounded-full !shadow-none flex-shrink-0"
        />
        <span className="truncate font-medium">{name}</span>
      </MenuTrigger>
      <MenuContent side="top" align="start" sideOffset={8} className="w-[280px] !rounded-xl !p-1.5">
        <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
          <AccountIdentity user={user} size={28} />
        </div>
        <MenuSeparator />
        {others.length > 0 && (
          <MenuGroup>
            <MenuGroupLabel>Switch account</MenuGroupLabel>
            {others.map((other) => (
              <MenuItem
                key={other.key}
                className="!gap-2.5"
                onClick={() => onLogout({ kind: 'switch', key: other.key })}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <AccountIdentity
                    user={other.user}
                    size={22}
                    detail={otherBackend(other.apiUrl)}
                  />
                </div>
              </MenuItem>
            ))}
          </MenuGroup>
        )}
        <MenuItem
          icon={<UserPlus className="h-3.5 w-3.5" />}
          onClick={() => onLogout({ kind: 'add' })}
        >
          Add account
        </MenuItem>
        <MenuSeparator />
        {onOpenUserSettings && (
          <MenuItem
            icon={<Settings className="h-3.5 w-3.5" />}
            hint={<Kbd combo="mod+," />}
            onClick={() => onOpenUserSettings()}
          >
            Settings
          </MenuItem>
        )}
        <MenuItem icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => onLogout()}>
          {others.length > 0 ? `Log out of ${user.email || name}` : 'Log out'}
        </MenuItem>
        {others.length > 0 && (
          <MenuItem
            icon={<LogOut className="h-3.5 w-3.5" />}
            onClick={() => onLogout({ kind: 'logoutAll' })}
          >
            Log out of all accounts
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
