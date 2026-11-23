import {
  ArrowLeftRight,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Monitor,
  Settings,
  SlidersHorizontal,
  Users,
} from 'lucide-react'

import { t } from '../../i18n'
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

import type { BreadcrumbSegment } from '../Toolbar'

export type TeamSwitcherActions = {
  onOpenComputers?: () => void
  onOpenSettings?: () => void
  onOpenMyPreferences?: () => void
  onCreateTeam?: () => void
}

export function TeamSwitcherMenu({
  teamSegment,
  onOpenComputers,
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
            <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-primary" />
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
          {onOpenComputers && (
            <MenuItem
              icon={<Monitor className="h-3.5 w-3.5" />}
              hint={<Kbd combo="mod+shift+e" />}
              onClick={onOpenComputers}
            >
              {t('Computers & runtimes')}
            </MenuItem>
          )}
          {onOpenSettings && (
            <MenuItem
              icon={<Settings className="h-3.5 w-3.5" />}
              hint={<Kbd combo="mod+shift+," />}
              onClick={() => onOpenSettings()}
            >
              {t('Team settings')}
            </MenuItem>
          )}
          {onOpenMyPreferences && (
            <MenuItem
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              onClick={() => onOpenMyPreferences()}
            >
              {t('My preferences')}
            </MenuItem>
          )}
          <MenuSubmenu>
            <MenuSubmenuTrigger
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
              chevron={<ChevronRight className="w-3 h-3" />}
              disabled={!teamSegment.options || teamSegment.options.length === 0}
            >
              {t('Switch team')}
            </MenuSubmenuTrigger>
            <MenuContent align="start" className="w-[260px]">
              {teamSegment.options && teamSegment.options.length > 0 ? (
                <>
                  {renderWorkspaceMenuOptions(teamSegment.options)}
                  {onCreateTeam && (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Users className="h-3.5 w-3.5" />}
                        onClick={() => onCreateTeam()}
                      >
                        {t('Create or join team')}
                      </MenuItem>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="px-2.5 py-2 text-tertiary text-[12.5px]">
                    {teamSegment.emptyText || t('No teams')}
                  </div>
                  {onCreateTeam && (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Users className="h-3.5 w-3.5" />}
                        onClick={() => onCreateTeam()}
                      >
                        {t('Create or join team')}
                      </MenuItem>
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
