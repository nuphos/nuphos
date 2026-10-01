import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Profiler, useEffect, useRef } from 'react'

import { WorkspaceTabPane } from '../../app/workspace/WorkspaceTabPane'
import { EMPTY_LIST } from '../../app/workspaceTabState'
import { Toolbar } from '../../components/Toolbar'
import { ToolbarSlotsContext } from '../../hooks/useToolbarControls'
import { ToolbarPrimaryActionContext } from '../../hooks/useToolbarPrimaryAction'
import { teamCanUseAgent } from '../../lib/agentAccess'
import { reportPaneRender, reportShellRender } from '../../lib/tabSwitchLog'

import { usePaneOrder } from './usePaneOrder'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

/** Focus already where the tab surface wants it: on a tab (its strip counts) or
 *  in a field the user is typing into. */
function keepsFocus(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) return true

  const surface = element.closest<HTMLElement>('[data-workspace-focus-surface]')

  return surface?.dataset.workspaceFocusSurface === 'tab'
}

export function WorkspaceMainPane({ ws, user }: { ws: WorkspaceController; user: UserInfo }) {
  const {
    teams,
    databaseConnectionsByTeam,
    tabs,
    tabBuckets,
    activeTabId,
    mountedTabIds,
    dockOpen,
    mainPageOpen,
    grafanaInstancesByTeam,
    githubInstallationsByTeam,
    gitlabBindingsByTeam,
    error,
    setBindGithubTarget,
    setBindGitlabTarget,
    openSettingsSection,
    slackBindRequested,
    handleSlackBindRequested,
    firstRunDevForced,
    startFirstRunConnect,
    sidebarAgentPagePendingImport,
    clearSidebarAgentPagePendingImport,
    activeTab,
    pendingChatPrompt,
    activeExternalLink,
    toolbarPageUrl,
    scope,
    filter,
    count,
    viewLoading,
    setAgentSessionTitle,
    namespaces,
    switching,
    updateTab,
    loadNamespaces,
    accounts,
    enterScopeInTab,
    copyLink,
    consumeChatPrompt,
    openAuditConversation,
    setClusterNamespace,
    openLightsailSshTab,
    openEc2SshTab,
    openGceSshTab,
    onRefresh,
    toolbarSegments,
    showListControls,
    setActiveFilter,
    toolbarPrimaryAction,
    setToolbarPrimaryAction,
    setToolbarLeftEl,
    setToolbarRightEl,
    setToolbarHeaderRightEl,
    toolbarHeaderRightOccupied,
    toolbarSlots,
    stableDockAgentToSidebar,
    stableOpenNuphosLinkFromChat,
    stableOpenNodeLink,
    stableOpenPlanInChat,
    stableOpenConversationHere,
    stableEnterCluster,
    stableOpenInChat,
    stableOpenAgentChatWithPrompt,
    toolbarHasControls,
    rootIntegrations,
    scopeChipForPath,
    onSidebarOpenPath,
    onSidebarOpenKey,
  } = ws
  const surfaceRef = useRef<HTMLElement | null>(null)
  const focusedTabRef = useRef<string | null>(null)
  const paneActive = useWorkspacePane()?.active ?? true

  // Keyboard focus follows the tab that just came to the front. Clicking a tab
  // already does this; a tab opened from elsewhere — a chat link, the sidebar, a
  // deep link — fires no pointer or focus event inside this surface, so the pane
  // went on treating the chat as the focused layer and ⌘W closed the whole pane
  // instead of the tab. Only the tab changing may move focus: focusing this
  // surface also promotes its pane to the split's active one, so reacting to
  // `paneActive` itself would hijack the pane the user just clicked into.
  useEffect(() => {
    const surfaced = dockOpen || mainPageOpen ? activeTabId : null

    if (surfaced === focusedTabRef.current) return
    focusedTabRef.current = surfaced
    const surface = surfaceRef.current

    // Never steal focus from a background pane, or from typing: an open dock
    // still lets the composer hold focus, and a tab may open mid-sentence.
    if (!surfaced || !paneActive || !surface) return
    if (keepsFocus(document.activeElement)) return
    surface.focus({ preventScroll: true })
  }, [activeTabId, dockOpen, mainPageOpen, paneActive])

  // Browser panes come last and outlive a session switch, so their webviews are
  // never unmounted or moved — see usePaneOrder.
  const { panes, mountedIds } = usePaneOrder(tabs, tabBuckets, activeTabId, mountedTabIds)

  if (!scope) return null

  return (
    <main
      ref={surfaceRef}
      tabIndex={-1}
      data-workspace-focus-surface="tab"
      className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-main">
          {activeTab?.active !== 'team.browser' && activeTab?.active !== 'team.terminal' && (
            <Profiler id="toolbar" onRender={(id, _p, ms) => reportShellRender(id, ms)}>
              <Toolbar
                segments={toolbarSegments}
                filter={filter}
                onFilterChange={setActiveFilter}
                count={count}
                headerRightActions={
                  <div
                    ref={setToolbarHeaderRightEl}
                    className="titlebar-no-drag flex items-center gap-1 empty:hidden"
                  />
                }
                hasHeaderRightActions={toolbarHeaderRightOccupied}
                filterControls={
                  // Left portal target: views push filters/tabs/pickers here via
                  // useToolbarSlot('left', …). `empty:hidden` so an unused slot never
                  // adds a stray flex gap next to the search box.
                  <div
                    ref={setToolbarLeftEl}
                    className="titlebar-no-drag flex items-center gap-1 empty:hidden"
                  />
                }
                extraActions={
                  <>
                    {/* Right portal target: always present so any active view can
                      render its own controls (e.g. the Grafana dashboard's
                      variable / time-range pickers) via useToolbarSlots().right.
                      `empty:hidden` so it adds no flex gap before the CTA when a
                      page uses the App-level action below instead. */}
                    <div
                      ref={setToolbarRightEl}
                      className="titlebar-no-drag flex items-center gap-2 empty:hidden"
                    />
                    {toolbarPrimaryAction ? (
                      <button
                        type="button"
                        disabled={toolbarPrimaryAction.disabled}
                        onClick={toolbarPrimaryAction.onClick}
                        className="h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                        {toolbarPrimaryAction.label}
                      </button>
                    ) : null}
                  </>
                }
                onRefresh={onRefresh}
                hasControls={toolbarHasControls}
                showFilter={showListControls}
                namespaces={showListControls && scope.kind === 'cluster' ? namespaces : undefined}
                namespacesLoading={activeTab?.namespacesState === 'loading'}
                namespacesTruncated={activeTab?.namespacesTruncated}
                namespacesTotal={activeTab?.namespacesTotal}
                onLoadNamespaces={
                  showListControls && scope.kind === 'cluster' ? loadNamespaces : undefined
                }
                selectedNamespace={
                  showListControls && scope.kind === 'cluster' ? (scope.namespace ?? '') : undefined
                }
                onSelectNamespace={
                  showListControls && scope.kind === 'cluster' ? setClusterNamespace : undefined
                }
                switching={switching}
                loading={viewLoading}
                currentPageUrl={toolbarPageUrl}
                externalLink={activeExternalLink}
              />
            </Profiler>
          )}
          <div className="flex-1 flex flex-col min-h-0 bg-main">
            {error && (
              <div className="px-6 py-2 bg-error/15 text-error text-[12.5px] border-b border-error/30">
                {error}
              </div>
            )}
            <ToolbarPrimaryActionContext.Provider value={setToolbarPrimaryAction}>
              <ToolbarSlotsContext.Provider value={toolbarSlots}>
                <div className="flex-1 min-h-0 bg-main">
                  {panes.map((tab) => (
                    <Profiler
                      key={tab.id}
                      id={tab.id}
                      onRender={(id, _phase, actualDuration) =>
                        reportPaneRender(id, actualDuration)
                      }
                    >
                      <WorkspaceTabPane
                        key={tab.id}
                        tab={tab}
                        isTeamAdmin={
                          teams.find((t) => t.id === tab.scope.teamId)?.role === 'ADMINISTRATOR'
                        }
                        agentPaid={teamCanUseAgent(teams.find((t) => t.id === tab.scope.teamId))}
                        active={tab.id === activeTabId}
                        mounted={mountedIds.has(tab.id)}
                        accounts={accounts}
                        firstRunDevForced={firstRunDevForced}
                        databaseConnections={databaseConnectionsByTeam[tab.scope.teamId]}
                        githubInstallations={
                          githubInstallationsByTeam[tab.scope.teamId] ?? EMPTY_LIST
                        }
                        gitlabBindings={gitlabBindingsByTeam[tab.scope.teamId] ?? EMPTY_LIST}
                        grafanaInstances={grafanaInstancesByTeam[tab.scope.teamId] ?? EMPTY_LIST}
                        user={user}
                        rootIntegrations={rootIntegrations}
                        rootIntegrationsLoading={accounts === undefined}
                        scopeChipForPath={scopeChipForPath}
                        onOpenPath={onSidebarOpenPath}
                        onOpenKey={onSidebarOpenKey}
                        onDockAgentToSidebar={stableDockAgentToSidebar}
                        pendingPageImport={sidebarAgentPagePendingImport}
                        onPagePendingImportConsumed={clearSidebarAgentPagePendingImport}
                        pendingChatPrompt={
                          tab.active === 'team.agent' && tab.id === activeTabId
                            ? pendingChatPrompt
                            : null
                        }
                        onChatPromptConsumed={consumeChatPrompt}
                        onOpenNuphosLink={stableOpenNuphosLinkFromChat}
                        onOpenNodeLink={stableOpenNodeLink}
                        onOpenPlanInChat={stableOpenPlanInChat}
                        onOpenConversation={stableOpenConversationHere}
                        railCollapsed={tab.agentRailCollapsed ?? true}
                        onAgentSessionTitle={setAgentSessionTitle}
                        onOpenAuditConversation={openAuditConversation}
                        copyLink={copyLink}
                        openInChat={stableOpenInChat}
                        onOpenAgentChat={stableOpenAgentChatWithPrompt}
                        onStartFirstRunConnect={startFirstRunConnect}
                        updateTab={updateTab}
                        onFilterChange={setActiveFilter}
                        enterScopeInTab={enterScopeInTab}
                        enterCluster={stableEnterCluster}
                        openLightsailSshTab={openLightsailSshTab}
                        openEc2SshTab={openEc2SshTab}
                        openGceSshTab={openGceSshTab}
                        onRequestBindGithub={setBindGithubTarget}
                        onRequestBindGitlab={setBindGitlabTarget}
                        onOpenSettingsSection={openSettingsSection}
                        slackBindRequested={slackBindRequested && tab.id === activeTabId}
                        onSlackBindHandled={handleSlackBindRequested}
                        renderAgentPage={false}
                        dockVisible={ws.dockOpen}
                      />
                    </Profiler>
                  ))}
                </div>
              </ToolbarSlotsContext.Provider>
            </ToolbarPrimaryActionContext.Provider>
          </div>
        </div>
      </div>
    </main>
  )
}
