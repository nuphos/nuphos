import { Profiler, useEffect, useMemo } from 'react'

import { pageLocationForTab } from '../../app/workspaceTabFactory'
import { Sidebar } from '../../components/Sidebar'
import { sidebarView } from '../../components/sidebar/view'
import { useStableCallback } from '../../hooks/useStableCallback'
import { historyShortcut } from '../../lib/historyShortcut'
import { isMac } from '../../lib/platform'
import { reportShellRender } from '../../lib/tabSwitchLog'
import {
  MY_PREFERENCES_DEFAULT_SECTION,
  USER_SETTINGS_DEFAULT_SECTION,
} from '../../views/settings/settingsNav'

import { sidebarSurface } from './store/workspaceState'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

export function WorkspaceSidebarPanel({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const {
    pendingInvitations,
    setSettingsOpen,
    setSettingsInitialSection,
    openSettingsSection,
    setShortcutsHelpOpen,
    setSlackBindRequested,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    activeTab,
    scope,
    currentTeam,
    landingCelebration,
    grafanaInstance,
    sidebarRepositoryNav,
    canGoBack,
    canGoForward,
    surfaceHistory,
    surfaceHistoryIndex,
    updateActiveTab,
    navigateHistory,
    acceptInvitation,
    rejectInvitation,
    accounts,
    enterScope,
    openCreateTeam,
    onSidebarSelect,
    onSidebarOpenKey,
    breadcrumb,
    teamSegment,
    sidebarBack,
    rootIntegrations,
    identitySegment,
    scopeChipForPath,
    onSidebarOpenPath,
    handleLogout,
    selectedSessionId,
    mainPageOpen,
    workspaceActions,
  } = ws

  // ⌘[ / ⌘] (Alt+← / Alt+→ off macOS) step the same history as Back and Forward.
  // A terminal or editor that handles the key keeps it, and an overlay pauses it.
  const historyKeysLive = ws.chatShortcutsLive && !ws.sessionSearchOpen

  useEffect(() => {
    if (!historyKeysLive) return
    const onKeyDown = (event: KeyboardEvent) => {
      const step = historyShortcut(event, isMac)

      if (step === null || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      navigateHistory(step)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyKeysLive, navigateHistory])

  // The sidebar is memoized; stable handlers let it skip the workspace updates
  // (a ⌘T makes several) that change nothing it shows.
  const inDatasourceExplorer =
    activeTab?.active === 'observability.datasources' &&
    Boolean(activeTab.logDatasourceTarget ?? activeTab.traceDatasourceTarget)
  const closeArchivedChatTabs = useStableCallback((sessionId: string) => {
    if (selectedSessionId === sessionId)
      workspaceActions.selectSession(null, { keepMainPage: true })
  })
  const connectSlack = useStableCallback(() => {
    onSidebarSelect('team.integrations')
    setSlackBindRequested(true)
  })
  const goBack = useStableCallback(() => navigateHistory(-1))
  const goForward = useStableCallback(() => navigateHistory(1))
  const history = useMemo(
    () => ({
      entries: surfaceHistory,
      index: surfaceHistoryIndex,
      onJump: workspaceActions.goToSurface,
    }),
    [surfaceHistory, surfaceHistoryIndex, workspaceActions.goToSurface],
  )
  const sidebarBackToParent = useStableCallback(() => {
    // In a datasource explorer, back closes the explorer instead of leaving Grafana.
    if (inDatasourceExplorer)
      updateActiveTab((tab) => ({ ...tab, traceDatasourceTarget: null, logDatasourceTarget: null }))
    else if (sidebarBack) enterScope(sidebarBack.scope, sidebarBack.active)
  })
  const openSettings = useStableCallback(() => {
    setSettingsInitialSection(null)
    setSettingsOpen(true)
  })
  const openMyPreferences = useStableCallback(() =>
    openSettingsSection(MY_PREFERENCES_DEFAULT_SECTION),
  )
  const openUserSettings = useStableCallback(() =>
    openSettingsSection(USER_SETTINGS_DEFAULT_SECTION),
  )
  const openSearch = useStableCallback(() => ws.setSessionSearchOpen(true))
  const openShortcutsHelp = useStableCallback(() => setShortcutsHelpOpen(true))

  if (!scope) return null
  // Only a page with its own navigation (a cloud account, cluster, Grafana,
  // repo) takes over the sidebar when its tab goes full screen; any other page
  // keeps the regular main sidebar.
  const pageHasOwnNavigation =
    sidebarView(scope, ws.sidebarActive, grafanaInstance, sidebarRepositoryNav).level > 0
  const { dynamicNavigation, active, chatShown } = sidebarSurface(
    mainPageOpen,
    ws.workspaceDockExpanded && pageHasOwnNavigation,
    ws.sidebarActive,
  )

  return (
    <Profiler id="sidebar" onRender={(id, _p, ms) => reportShellRender(id, ms)}>
      <Sidebar
        chatNavKeysLive={historyKeysLive}
        scope={scope}
        active={active}
        agentSessionId={selectedSessionId}
        chatShown={chatShown}
        onChatArchived={closeArchivedChatTabs}
        currentHref={activeTab ? pageLocationForTab(activeTab).href : null}
        kubeconfigContext={activeTab?.kubeconfigContext ?? null}
        onSelect={onSidebarSelect}
        onOpenPath={onSidebarOpenPath}
        onOpenKey={onSidebarOpenKey}
        scopeChipForPath={scopeChipForPath}
        user={user}
        onUserUpdated={ws.onUserUpdated}
        onLogout={handleLogout}
        grafanaInstance={grafanaInstance}
        teamSegment={teamSegment}
        identitySegment={identitySegment}
        repositoryNav={sidebarRepositoryNav}
        rootIntegrations={rootIntegrations}
        rootIntegrationsLoading={!accounts}
        slackConnected={
          Boolean(accounts?.slackInstallation) || (accounts?.slackLinkedChannels?.count ?? 0) > 0
        }
        onConnectSlack={connectSlack}
        celebrating={landingCelebration}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        history={history}
        onSidebarBack={inDatasourceExplorer || sidebarBack ? sidebarBackToParent : undefined}
        hierarchy={breadcrumb}
        onOpenSettings={currentTeam ? openSettings : undefined}
        onOpenMyPreferences={currentTeam ? openMyPreferences : undefined}
        onOpenUserSettings={openUserSettings}
        onSearch={openSearch}
        onOpenShortcutsHelp={openShortcutsHelp}
        onCreateTeam={openCreateTeam}
        pendingInvitations={pendingInvitations}
        onAcceptInvitation={acceptInvitation}
        onRejectInvitation={rejectInvitation}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
        dynamicNavigation={dynamicNavigation}
      />
    </Profiler>
  )
}
