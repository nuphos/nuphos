import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, LogOut, Settings } from 'lucide-react'

import { Avatar } from '../Avatar'
import { Kbd } from '../ui/kbd'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../ui/menu'
import { renderWorkspaceMenuOptions } from '../WorkspaceMenuOptions'

import { SidebarToggleButton } from './nav-stack'

import type { UserInfo } from '../../types'
import type { BreadcrumbSegment } from '../Toolbar'

/**
 * The 44px strip at the top of the sidebar: the collapse toggle on the leading
 * edge, history buttons on the trailing one. Doubles as the window titlebar.
 */
export function SidebarHeaderBar({
  collapsed,
  onToggleCollapse,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  collapsed: boolean
  onToggleCollapse?: () => void
  canGoBack: boolean
  canGoForward: boolean
  onBack?: () => void
  onForward?: () => void
}) {
  return (
    <div className="titlebar-drag h-[44px] flex-shrink-0 flex items-center justify-between px-3.5">
      {/* On macOS the leading padding clears the traffic lights; elsewhere
        (Windows/Linux) there are none, so the toggle sits flush left. */}
      <div className="titlebar-no-drag flex items-center titlebar-lead-pad">
        {onToggleCollapse && (
          <SidebarToggleButton collapsed={collapsed} onClick={onToggleCollapse} />
        )}
      </div>
      <SidebarHistoryButtons
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={onBack}
        onForward={onForward}
      />
    </div>
  )
}

export function SidebarHistoryButtons({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  canGoBack: boolean
  canGoForward: boolean
  onBack?: () => void
  onForward?: () => void
}) {
  return (
    <div className="titlebar-no-drag flex items-center gap-1.5">
      <button
        type="button"
        // Navigate on press, not on release — same reasoning as the tab
        // strip: waiting for `click` adds the held mouse button to the
        // perceived latency. Keyboard activation arrives as detail-0 click.
        onPointerDown={(event) => {
          if (event.button === 0 && canGoBack) onBack?.()
        }}
        onClick={(event) => {
          if (event.detail === 0) onBack?.()
        }}
        disabled={!canGoBack}
        className={clsx(
          'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
          canGoBack
            ? 'text-secondary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]'
            : 'text-tertiary/45 cursor-default',
        )}
        title="Back"
        aria-label="Back"
      >
        <ChevronLeft className="w-[15px] h-[15px]" />
      </button>
      <button
        type="button"
        onPointerDown={(event) => {
          if (event.button === 0 && canGoForward) onForward?.()
        }}
        onClick={(event) => {
          if (event.detail === 0) onForward?.()
        }}
        disabled={!canGoForward}
        className={clsx(
          'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
          canGoForward
            ? 'text-secondary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]'
            : 'text-tertiary/45 cursor-default',
        )}
        title="Forward"
        aria-label="Forward"
      >
        <ChevronRight className="w-[15px] h-[15px]" />
      </button>
    </div>
  )
}

/** Pulse placeholder shown while the team segment is still loading. */
export function SidebarTeamSwitcherSkeleton() {
  return (
    <div className="px-2.5 pb-1.5">
      <div className="h-9 flex items-center gap-2.5 px-2">
        <div className="h-5 w-5 flex-shrink-0 rounded-md bg-zGray-800/80 animate-pulse" />
        <div className="h-3.5 w-28 rounded bg-zGray-800/65 animate-pulse" />
      </div>
    </div>
  )
}

export function SidebarTeamSwitcher({
  teamSegment,
  onOpenSettings,
  onOpenMyPreferences,
  onCreateTeam,
}: {
  teamSegment: BreadcrumbSegment
  onOpenSettings?: () => void
  onOpenMyPreferences?: () => void
  onCreateTeam?: () => void
}) {
  return (
    <div className="px-2.5 pb-1.5 titlebar-no-drag">
      <Menu
        onOpenChange={(open) => {
          if (open) teamSegment.onExpand?.()
        }}
      >
        <MenuTrigger className="w-full h-9 flex items-center gap-2.5 px-2 rounded-md text-[13.5px] transition-colors outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:bg-[var(--sidebar-overlay-focus)] hover:bg-[var(--sidebar-overlay-hover)] text-main data-[popup-open]:bg-[var(--sidebar-overlay-active)]">
          {teamSegment.loading ? (
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-zViolet-accent" />
          ) : (
            <span className="flex items-center flex-shrink-0 [&>*]:!h-5 [&>*]:!w-5 [&>svg]:!h-5 [&>svg]:!w-5">
              {teamSegment.icon}
            </span>
          )}
          <span className="truncate flex-1 text-left font-medium">{teamSegment.label}</span>
          {!teamSegment.loading && (
            <ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-tertiary" />
          )}
        </MenuTrigger>
        <MenuContent side="bottom" align="start" className="w-[260px]">
          {onOpenSettings && (
            <MenuItem hint={<Kbd combo="mod+shift+," />} onClick={() => onOpenSettings()}>
              Team settings
            </MenuItem>
          )}
          {onOpenMyPreferences && (
            <MenuItem onClick={() => onOpenMyPreferences()}>My preferences</MenuItem>
          )}
          <MenuSubmenu>
            <MenuSubmenuTrigger
              chevron={<ChevronRight className="w-3 h-3" />}
              disabled={!teamSegment.options || teamSegment.options.length === 0}
            >
              Switch workspace
            </MenuSubmenuTrigger>
            <MenuContent align="start" className="w-[260px]">
              {teamSegment.options && teamSegment.options.length > 0 ? (
                <>
                  {renderWorkspaceMenuOptions(teamSegment.options)}
                  {onCreateTeam && (
                    <>
                      <MenuSeparator />
                      <MenuItem onClick={() => onCreateTeam()}>Create or join team</MenuItem>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="px-2.5 py-2 text-tertiary text-[12.5px]">
                    {teamSegment.emptyText || 'No teams'}
                  </div>
                  {onCreateTeam && (
                    <>
                      <MenuSeparator />
                      <MenuItem onClick={() => onCreateTeam()}>Create or join team</MenuItem>
                    </>
                  )}
                </>
              )}
            </MenuContent>
          </MenuSubmenu>
        </MenuContent>
      </Menu>
    </div>
  )
}

export function SidebarUserEntry({
  user,
  onOpenUserSettings,
  onLogout,
}: {
  user: UserInfo
  onOpenUserSettings?: () => void
  onLogout: () => void
}) {
  const name = user.name || user.username || user.email

  return (
    <Menu>
      <MenuTrigger className="titlebar-no-drag min-w-0 flex-1 h-9 flex items-center gap-2.5 px-2 rounded-lg text-[13.5px] text-main outline-none transition-colors hover:bg-[var(--sidebar-overlay-hover)] focus-visible:bg-[var(--sidebar-overlay-focus)] data-[popup-open]:bg-[var(--sidebar-overlay-active)]">
        <Avatar
          src={user.avatarURL}
          name={name}
          size={22}
          className="rounded-full !shadow-none flex-shrink-0"
        />
        <span className="truncate font-medium">{name}</span>
      </MenuTrigger>
      <MenuContent side="top" align="start" sideOffset={8} className="w-[260px] !rounded-xl !p-1.5">
        <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
          <Avatar
            src={user.avatarURL}
            name={name}
            size={28}
            className="rounded-full !shadow-none flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium text-main">{name}</div>
            {user.email && <div className="truncate text-[12px] text-tertiary">{user.email}</div>}
          </div>
        </div>
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
          Log out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
