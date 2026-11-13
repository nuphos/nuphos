import { Profiler, useEffect, useRef, useState } from 'react'

import { WorkspaceTabPane } from '../../app/workspace/WorkspaceTabPane'
import { EMPTY_LIST } from '../../app/workspaceTabState'
import { PageAsideContext } from '../../hooks/usePageAside'
import { ToolbarSlotsContext } from '../../hooks/useToolbarControls'
import { ToolbarPrimaryActionContext } from '../../hooks/useToolbarPrimaryAction'
import { reportPaneRender } from '../../lib/tabSwitchLog'

import { usePaneOrder } from './usePaneOrder'
import { WorkspacePageToolbar } from './WorkspacePageToolbar'
import { useWorkspacePane } from './WorkspacePaneContext'
import { HeaderEdge } from '../../components/ui/header-edge'

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
    firstRunDevForced,
    sidebarAgentPagePendingImport,
    clearSidebarAgentPagePendingImport,
    pendingChatPrompt,
    scope,
    setAgentSessionTitle,
    updateTab,
    accounts,
    enterScopeInTab,
    copyLink,
    consumeChatPrompt,
    openAuditConversation,
    openLightsailSshTab,
    openEc2SshTab,
    openGceSshTab,
    setActiveFilter,
    setToolbarPrimaryAction,
    toolbarSlots,
    stableDockAgentToSidebar,
    stableOpenNuphosLinkFromChat,
    stableOpenNodeLink,
    stableOpenPlanInChat,
    stableOpenConversationHere,
    stableEnterCluster,
    stableOpenInChat,
    stableOpenAgentChatWithPrompt,
    rootIntegrations,
    scopeChipForPath,
    onSidebarOpenPath,
    onSidebarOpenKey,
  } = ws
  const surfaceRef = useRef<HTMLElement | null>(null)
  const [pageAsideEl, setPageAsideEl] = useState<HTMLDivElement | null>(null)
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
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden workspace-content-surface">
          <WorkspacePageToolbar ws={ws} />
          <HeaderEdge className="flex-1 flex flex-col min-h-0">
            {error && (
              <div className="px-6 py-2 bg-error/15 text-error text-[12.5px] border-b border-error/30">
                {error}
              </div>
            )}
            <PageAsideContext.Provider value={pageAsideEl}>
              <ToolbarPrimaryActionContext.Provider value={setToolbarPrimaryAction}>
                <ToolbarSlotsContext.Provider value={toolbarSlots}>
                  <div className="flex-1 min-h-0">
                    {panes.map((tab) => (
                      <Profiler
                        key={tab.id}
                        id={tab.id}
                        onRender={(id, _phase, actualDuration) =>
                          reportPaneRender(id, actualDuration)
                        }
                      >
                        <WorkspaceTabPane
                          conversationId={mainPageOpen ? null : ws.selectedSessionId}
                          key={tab.id}
                          tab={tab}
                          isTeamAdmin={
                            teams.find((t) => t.id === tab.scope.teamId)?.role === 'ADMINISTRATOR'
                          }
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
                          onAgentSessionTitle={setAgentSessionTitle}
                          onOpenAuditConversation={openAuditConversation}
                          copyLink={copyLink}
                          openInChat={stableOpenInChat}
                          onOpenAgentChat={stableOpenAgentChatWithPrompt}
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
                          renderAgentPage={false}
                          dockVisible={ws.dockOpen}
                        />
                      </Profiler>
                    ))}
                  </div>
                </ToolbarSlotsContext.Provider>
              </ToolbarPrimaryActionContext.Provider>
            </PageAsideContext.Provider>
          </HeaderEdge>
        </div>
        <div ref={setPageAsideEl} className="flex min-h-0 shrink-0 empty:hidden" />
      </div>
    </main>
  )
}
