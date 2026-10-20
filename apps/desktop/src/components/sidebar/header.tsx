import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ChevronsUpDown, Loader2 } from 'lucide-react'

import { SkeletonReveal } from '../SkeletonReveal'
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

/** Placeholder shown while the team segment is still loading; SkeletonReveal pulses it. */
function SidebarTeamSwitcherSkeleton() {
  return (
    <div className="px-2.5 pb-1.5">
      <div className="h-9 flex items-center gap-2.5 px-2">
        <div className="h-5 w-5 flex-shrink-0 rounded-md bg-zGray-800/80" />
        <div className="h-3.5 w-28 rounded bg-zGray-800/65" />
      </div>
    </div>
  )
}

type TeamSwitcherActions = {
  onOpenSettings?: () => void
  onOpenMyPreferences?: () => void
  onCreateTeam?: () => void
}

/** The team switcher, revealed from its skeleton once the team segment loads. */
export function SidebarTeamSwitcher({
  teamSegment,
  loading,
  ...actions
}: TeamSwitcherActions & { teamSegment?: BreadcrumbSegment; loading: boolean }) {
  if (!teamSegment && !loading) return null

  return (
    <SkeletonReveal ready={Boolean(teamSegment)} skeleton={<SidebarTeamSwitcherSkeleton />}>
      {teamSegment && <TeamSwitcherMenu teamSegment={teamSegment} {...actions} />}
    </SkeletonReveal>
  )
}

function TeamSwitcherMenu({
  teamSegment,
  onOpenSettings,
  onOpenMyPreferences,
  onCreateTeam,
}: TeamSwitcherActions & { teamSegment: BreadcrumbSegment }) {
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
