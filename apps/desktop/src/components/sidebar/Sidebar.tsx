import clsx from 'clsx'
import { useState } from 'react'

import { RenameConversationDialog } from '../agent/panel/ConversationTitleEditor'
import { useSuspendTitlebarDrag } from '../../hooks/useSuspendTitlebarDrag'
import { SIDEBAR_PANEL_PADDING_CLASS } from '../SidebarNavItem'

import {
  SidebarHeaderBar,
  SidebarTeamSwitcher,
  SidebarTeamSwitcherSkeleton,
  SidebarUserEntry,
} from './header'
import { SidebarHelpMenu } from './help-menu'
import { SidebarBackControl, SidebarNavStack } from './nav-stack'
import { SidebarIdentitySelector, SidebarInvitations } from './parts'
import { SidebarItemContextMenu, SidebarSectionList } from './sections-list'
import { sharedChatSection, teamSections, withChatSections } from './sections-services'
import { settingsBackTarget } from './types'
import { useSidebarChrome } from './use-sidebar-chrome'
import { useSidebarChats, useSidebarCrdSections } from './use-sidebar-data'
import { useSidebarFavorites } from './use-sidebar-favorites'
import { useSidebarSharedChats } from './use-sidebar-shared-chats'
import { sectionsFor, sidebarView } from './view'

import type { Item, SidebarProps } from './types'

export function Sidebar({
  scope,
  active,
  agentSessionId = null,
  chatShown = true,
  onChatArchived,
  currentHref = null,
  onSelect,
  onOpenPath,
  onOpenKey,
  scopeChipForPath,
  kubeconfigContext = null,
  user,
  onLogout,
  grafanaInstance,
  teamSegment,
  teamSkeleton = false,
  identitySegment,
  repositoryNav,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  onSidebarBack,
  hierarchy,
  onOpenSettings,
  onOpenMyPreferences,
  onOpenUserSettings,
  onOpenShortcutsHelp,
  onCreateTeam,
  pendingInvitations = [],
  onAcceptInvitation,
  onRejectInvitation,
  rootIntegrations,
  rootIntegrationsLoading = false,
  collapsed = false,
  onToggleCollapse,
  dynamicNavigation = false,
}: SidebarProps) {
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; title: string } | null>(
    null,
  )
  const teamId = scope.teamId
  const chrome = useSidebarChrome({ teamId, collapsed })
  const { width, dragging, setDragging, peek, setPeek } = chrome
  const { chatItems, newChatActive, archiveChat, archivingIds } = useSidebarChats({
    teamId,
    agentSessionId,
    chatShown,
    onArchived: onChatArchived,
  })
  const { sharedChatItems } = useSidebarSharedChats({ teamId, agentSessionId, chatShown })

  // Keep the small, fixed workspace shortcut group above Chats. Favorites and
  // connected-resource groups live in New Tab while split. Expanded workspace
  // mode restores the original scope-specific navigation.
  const teamScope = { kind: 'team' as const, teamId }
  const navigationScope = dynamicNavigation ? scope : teamScope
  const customResourceTypeSections = useSidebarCrdSections({
    scope: navigationScope,
    kubeconfigContext: dynamicNavigation ? kubeconfigContext : null,
    active,
  })
  const sections = dynamicNavigation
    ? sectionsFor(
        scope,
        active,
        grafanaInstance,
        repositoryNav,
        rootIntegrations,
        rootIntegrationsLoading,
        chatItems,
        customResourceTypeSections,
      )
    : teamSections(rootIntegrations, rootIntegrationsLoading, chatItems)
  const view = dynamicNavigation
    ? sidebarView(scope, active, grafanaInstance, repositoryNav)
    : { key: `team:${teamId}`, level: 0 }
  const teamView = view.level === 0
  const settingsBack = dynamicNavigation ? settingsBackTarget(scope, active) : null

  const { favoriteMatch, canFavorite, toggleFavorite, favoriteItems, pinnedChatItems } =
    useSidebarFavorites({
      userId: user?.id ?? '',
      teamId,
      teamView,
      // Shared rows are live rows too: a pin resolves its icon by finding
      // itself here, and only the render order keeps them out of `sections`.
      sections: [...sections, ...sharedChatSection(sharedChatItems)],
      currentHref,
      activeSessionId: chatShown ? agentSessionId : undefined,
      scopeChipForPath,
      onOpenPath,
      onOpenKey,
    })

  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: Item } | null>(null)

  const renderSections = teamView
    ? withChatSections(sections, pinnedChatItems, sharedChatItems, favoriteMatch)
    : [...sections]

  if (dynamicNavigation && teamView && favoriteItems.length > 0) {
    renderSections.splice(1, 0, { title: 'Favorites', items: favoriteItems })
  }

  const sidebarSections = dynamicNavigation
    ? renderSections
    : renderSections.filter(
        (section, index) =>
          index === 0 ||
          section.title === 'Pinned' ||
          section.title === 'Shared' ||
          section.title === 'Chats',
      )

  const showSidebar = !collapsed || peek

  // Floating, the panel is an overlay: the pane titlebar underneath stays
  // draggable and eats the press meant for the panel's own toggle.
  useSuspendTitlebarDrag(collapsed && peek)

  return (
    <>
      {/*
        In-flow spacer: reserves the docked width and tweens to 0 on collapse,
        pushing the content area. The visible surface below is absolutely
        positioned so it can float over the content while peeking.
      */}
      <div
        aria-hidden
        className={clsx('flex-shrink-0', !dragging && 't-resize')}
        style={{ width: collapsed ? 0 : width }}
      />
      {/* Left-edge hover target that triggers the floating peek while collapsed. */}
      {collapsed && (
        <div
          className="absolute left-0 top-0 bottom-0 z-30 w-2.5"
          onMouseEnter={() => setPeek(true)}
        />
      )}
      <aside
        style={{
          width,
          transform: showSidebar ? 'translateX(0)' : 'translateX(-100%)',
        }}
        onMouseEnter={collapsed ? () => setPeek(true) : undefined}
        // Only past the trailing edge counts as leaving. Losing the pointer any
        // other way — the native traffic lights, out of the window — is a hole
        // in the hover region, not an exit.
        onMouseLeave={collapsed ? (event) => setPeek(event.clientX < width) : undefined}
        className={clsx(
          'sidebar-surface absolute left-0 top-0 bottom-0 z-40 flex flex-col',
          'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          showSidebar ? 'pointer-events-auto' : 'pointer-events-none',
          // Lift the panel off the content while it floats; docked it sits flush.
          collapsed && peek && 'is-floating shadow-2xl rounded-r-xl',
        )}
      >
        {!collapsed && (
          <div
            onMouseDown={() => setDragging(true)}
            className={clsx(
              'absolute right-0 top-[55px] bottom-3 w-0.5 cursor-col-resize z-10',
              dragging ? 'bg-zViolet-500/30' : 'hover:bg-zGray-800/60',
            )}
          />
        )}
        <SidebarHeaderBar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
        />

        {!teamSegment && teamSkeleton && <SidebarTeamSwitcherSkeleton />}

        {teamSegment && (
          <SidebarTeamSwitcher
            teamSegment={teamSegment}
            onOpenSettings={onOpenSettings}
            onOpenMyPreferences={onOpenMyPreferences}
            onCreateTeam={onCreateTeam}
          />
        )}

        <nav
          onScroll={chrome.handleNavScroll}
          className={clsx(
            SIDEBAR_PANEL_PADDING_CLASS,
            'flex-1 overflow-x-hidden overflow-y-auto scrollbar-thin scrollbar-overlay',
          )}
        >
          <SidebarNavStack viewKey={view.key} level={view.level}>
            {dynamicNavigation && !settingsBack && onSidebarBack && (
              <SidebarBackControl hierarchy={hierarchy} onBack={() => onSidebarBack()} />
            )}
            <SidebarSectionList
              sections={sidebarSections}
              scope={teamScope}
              active={active}
              teamView={teamView}
              newChatActive={newChatActive}
              archivingIds={archivingIds}
              isGroupCollapsed={chrome.isGroupCollapsed}
              toggleGroup={chrome.toggleGroup}
              favoriteMatch={favoriteMatch}
              canFavorite={canFavorite}
              toggleFavorite={toggleFavorite}
              onItemMenu={setItemMenu}
              onSelect={onSelect}
              onOpenKey={onOpenKey}
            />
          </SidebarNavStack>
        </nav>

        {dynamicNavigation &&
          identitySegment &&
          (scope.kind === 'aws-account' || scope.kind === 'gcp-project') && (
            <div className="px-3.5 pt-2.5 pb-3.5 titlebar-no-drag border-t border-zGray-800/60">
              <SidebarIdentitySelector scope={scope} segment={identitySegment} />
            </div>
          )}

        <div className="flex-shrink-0 flex items-center gap-1 border-t border-zGray-800/60 px-1.5 pb-1.5 pt-1.5">
          {user ? (
            <SidebarUserEntry
              user={user}
              onOpenUserSettings={onOpenUserSettings}
              onLogout={onLogout}
            />
          ) : (
            <div className="flex-1" />
          )}
          {pendingInvitations.length > 0 && (
            <SidebarInvitations
              invitations={pendingInvitations}
              onAccept={onAcceptInvitation}
              onReject={onRejectInvitation}
            />
          )}
          <SidebarHelpMenu onOpenShortcutsHelp={onOpenShortcutsHelp} />
        </div>
      </aside>
      {renameTarget && (
        <RenameConversationDialog
          key={renameTarget.sessionId}
          {...renameTarget}
          teamId={teamId}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {itemMenu && (
        <SidebarItemContextMenu
          menu={itemMenu}
          onClose={() => setItemMenu(null)}
          canFavorite={canFavorite}
          favoriteMatch={favoriteMatch}
          toggleFavorite={toggleFavorite}
          archiveChat={archiveChat}
          renameChat={(sessionId, title) => setRenameTarget({ sessionId, title })}
        />
      )}
    </>
  )
}
