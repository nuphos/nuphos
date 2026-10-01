import { Profiler } from 'react'

import { pageLocationForTab } from '../../app/workspaceTabFactory'
import { Sidebar } from '../../components/Sidebar'
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

  if (!scope) return null
  const { dynamicNavigation, active, chatShown } = sidebarSurface(
    mainPageOpen,
    ws.workspaceDockExpanded,
    ws.sidebarActive,
  )
  const closeArchivedChatTabs = (sessionId: string) => {
    if (selectedSessionId === sessionId)
      workspaceActions.selectSession(null, { keepMainPage: true })
  }

  return (
    <Profiler id="sidebar" onRender={(id, _p, ms) => reportShellRender(id, ms)}>
      <Sidebar
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
        onConnectSlack={() => {
          onSidebarSelect('team.integrations')
          setSlackBindRequested(true)
        }}
        celebrating={landingCelebration}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={() => navigateHistory(-1)}
        onForward={() => navigateHistory(1)}
        onSidebarBack={
          activeTab?.active === 'observability.datasources' &&
          (activeTab.logDatasourceTarget || activeTab.traceDatasourceTarget)
            ? // Inside a datasource explorer, back means "close the explorer"
              // (up one level to the datasource list), not "leave Grafana".
              () =>
                updateActiveTab((tab) => ({
                  ...tab,
                  traceDatasourceTarget: null,
                  logDatasourceTarget: null,
                }))
            : sidebarBack
              ? () => enterScope(sidebarBack.scope, sidebarBack.active)
              : undefined
        }
        hierarchy={breadcrumb}
        onOpenSettings={
          currentTeam
            ? () => {
                setSettingsInitialSection(null)
                setSettingsOpen(true)
              }
            : undefined
        }
        onOpenMyPreferences={
          currentTeam ? () => openSettingsSection(MY_PREFERENCES_DEFAULT_SECTION) : undefined
        }
        onOpenUserSettings={() => openSettingsSection(USER_SETTINGS_DEFAULT_SECTION)}
        onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
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
