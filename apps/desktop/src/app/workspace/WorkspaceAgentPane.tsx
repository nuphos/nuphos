import { clsx } from 'clsx'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { connectedResourceLabels } from '../../app/accountScopes'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { EditableConversationTitle } from '../../components/agent/panel/ConversationTitleEditor'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { SessionHeaderMenu } from '../../components/agent/SessionHeaderMenu'
import { SessionParticipants } from '../../components/agent/SessionParticipants'
import { SessionTitlebarResources } from '../../components/agent/SessionTitlebarResources'
import { teamCanUseAgent } from '../../lib/agentAccess'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'
import { isLocalAgentRuntime } from '../../lib/localAgentSharing'

import { SessionFindBar } from './SessionFindBar'
import { useSessionHeading } from './useSessionHeading'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

export function WorkspaceAgentPane({
  ws,
  user,
  workspaceExpanded = false,
}: {
  ws: WorkspaceController
  user: UserInfo
  workspaceExpanded?: boolean
}) {
  const paneActive = useWorkspacePane()?.active ?? true
  const {
    accounts,
    activeKubeContext,
    activePageUrl,
    dockOpen,
    agentSidebarPendingFork,
    agentSidebarPendingImport,
    auditChatLocate,
    clearAgentSidebarPendingFork,
    consumeChatPrompt,
    currentTeam,
    firstRunDevForced,
    githubInstallationsByTeam,
    gitlabBindingsByTeam,
    grafanaInstancesByTeam,
    openSettingsSection,
    pendingChatPrompt,
    scope,
    setAgentSidebarPendingImport,
    setAuditChatLocate,
    selectedSessionId,
    selectedSessionReadOnly,
    setAgentSidebarPendingFork,
    workspaceActions,
    startFirstRunConnect,
    stableOpenNuphosLinkFromChat,
    stableOpenSessionResource,
  } = ws
  const { currentHeading, handleTitleChange } = useSessionHeading(selectedSessionId)
  // The titlebar menu's Rename opens the same inline editor as clicking the title.
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const teamId = scope?.teamId
  const connectedResources = useMemo(
    () =>
      connectedResourceLabels(
        accounts,
        teamId ? (githubInstallationsByTeam[teamId]?.length ?? 0) : 0,
        teamId ? (gitlabBindingsByTeam[teamId]?.length ?? 0) : 0,
        teamId ? (grafanaInstancesByTeam[teamId]?.length ?? 0) : 0,
      ),
    [accounts, githubInstallationsByTeam, gitlabBindingsByTeam, grafanaInstancesByTeam, teamId],
  )
  const unbound =
    firstRunDevForced || (accounts !== undefined && !hasCloudOnboardingBinding(accounts))
  // Workspace context is consumed only when dispatching the next turn. Keep it
  // fresh through stable refs so changing a right-hand tab does not pass new
  // props through AgentPanel and re-render the entire open transcript.
  const runtimeUrlRef = useRef<string | undefined>(activePageUrl)
  const runtimeKubeContextRef = useRef<string | null | undefined>(activeKubeContext)

  useLayoutEffect(() => {
    runtimeUrlRef.current = activePageUrl
    runtimeKubeContextRef.current = activeKubeContext
  }, [activeKubeContext, activePageUrl])
  const handleSessionChange = useCallback(
    (sessionId: string | null, unshown?: string) => {
      if (unshown) workspaceActions.forgetSession(unshown)
      else workspaceActions.selectSession(sessionId, { keepMainPage: true })
    },
    [workspaceActions],
  )
  const openDockTab = useCallback(
    (tabId: string) => {
      workspaceActions.activateTab(tabId)
      workspaceActions.setDockOpen(true)
    },
    [workspaceActions],
  )
  const handleOpenAgentSettings = useCallback(
    () => openSettingsSection('workspace.agent'),
    [openSettingsSection],
  )
  const handleImportConsumed = useCallback(
    () => setAgentSidebarPendingImport(null),
    [setAgentSidebarPendingImport],
  )
  const handleLocateConsumed = useCallback(() => setAuditChatLocate(null), [setAuditChatLocate])

  // The dock covers this column instead of reflowing it: while expanded the
  // content keeps the width it had and the shrinking column clips it, until
  // the dock has finished its width transition back.
  const contentRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const content = contentRef.current

    if (!content) return
    if (workspaceExpanded) {
      content.style.minWidth = `${String(content.offsetWidth)}px`

      return
    }
    const release = (event: TransitionEvent) => {
      const target = event.target

      if (
        event.propertyName === 'width' &&
        target instanceof HTMLElement &&
        target.dataset.workspaceFocusSurface === 'tab'
      ) {
        content.style.minWidth = ''
      }
    }

    document.addEventListener('transitionend', release)

    return () => document.removeEventListener('transitionend', release)
  }, [workspaceExpanded])

  if (!teamId) return null

  return (
    <main
      data-workspace-focus-surface="session"
      // An expanded dock shrinks this column to zero width rather than removing
      // it, so the dock's width transition slides over it.
      inert={workspaceExpanded}
      className={clsx(
        'relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace-content-surface',
        ws.mainPageOpen ? 'hidden' : 'flex',
      )}
    >
      <div ref={contentRef} className="flex min-h-0 w-full flex-1 flex-col">
        <div
          className={clsx(
            'workspace-agent-titlebar flex h-[44px] flex-shrink-0 items-center border-b border-zGray-800/60 pl-3',
            // The viewport-anchored dock toggle (see `.workspace-dock-toggle`)
            // sits over this header only while the dock is closed; once it is
            // open the toggle rides the dock's own tab strip instead.
            dockOpen ? 'pr-3' : 'pr-12',
          )}
        >
          {/* Keep the native drag rectangle beside the Share action so hit testing
            never relies on a no-drag hole inside its draggable ancestor. */}
          <div
            key={`heading-${selectedSessionId ?? 'home'}`}
            className="t-session-heading titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 text-[13px] font-medium text-secondary"
          >
            {currentHeading.runtime && (
              <AgentProviderIcon
                provider={currentHeading.runtime}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
            )}
            <EditableConversationTitle
              key={`title-${selectedSessionId ?? 'home'}`}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              canRename={currentHeading.canRename === true}
              editing={renamingSessionId === selectedSessionId}
              onEditingChange={(editing) =>
                setRenamingSessionId((current) =>
                  editing ? selectedSessionId : current === selectedSessionId ? null : current,
                )
              }
            />
            {selectedSessionId && (
              <SessionTitlebarResources
                key={`resources-${selectedSessionId}`}
                sessionId={selectedSessionId}
                teamId={teamId}
                onOpen={stableOpenSessionResource}
                onOpenTab={openDockTab}
              />
            )}
          </div>
          {selectedSessionId && (
            <SessionParticipants
              key={selectedSessionId}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              currentUserId={user.id}
              canManage={currentHeading.canRename === true}
              warnLocalAgent={
                currentHeading.canRename === true && isLocalAgentRuntime(currentHeading.runtimeId)
              }
            />
          )}
          {selectedSessionId && currentHeading.saved !== false && (
            <SessionHeaderMenu
              key={`menu-${selectedSessionId}`}
              sessionId={selectedSessionId}
              teamId={teamId}
              userId={user.id}
              title={currentHeading.title}
              canRename={currentHeading.canRename === true}
              canArchive={currentHeading.canArchive === true}
              onRename={() => setRenamingSessionId(selectedSessionId)}
              onFork={() => setAgentSidebarPendingFork(selectedSessionId)}
              canFork={!selectedSessionReadOnly}
            />
          )}
        </div>
        <SessionFindBar
          key={selectedSessionId ?? 'home'}
          rootRef={transcriptRef}
          active={paneActive && !ws.mainPageOpen && !workspaceExpanded}
        />
        <div ref={transcriptRef} className="flex min-h-0 min-w-0 flex-1">
          <AgentPanel
            key={`agent-main-${teamId}`}
            variant="page"
            open={!workspaceExpanded}
            userName={user.name}
            runtimeUrlRef={runtimeUrlRef}
            teamId={teamId}
            paid={teamCanUseAgent(currentTeam)}
            isTeamAdmin={currentTeam?.role === 'ADMINISTRATOR'}
            runtimeKubeContextRef={runtimeKubeContextRef}
            unbound={unbound}
            connectedResources={connectedResources}
            onStartConnect={startFirstRunConnect}
            autoFocusComposer={paneActive && !dockOpen}
            newChatRequest={ws.newChatRequest}
            sessionId={selectedSessionId}
            sessionReadOnly={selectedSessionReadOnly}
            onSessionChange={handleSessionChange}
            onOpenNuphosLink={stableOpenNuphosLinkFromChat}
            onOpenAgentSettings={handleOpenAgentSettings}
            pendingImport={agentSidebarPendingImport}
            onImportConsumed={handleImportConsumed}
            pendingForkSessionId={agentSidebarPendingFork}
            onForkConsumed={clearAgentSidebarPendingFork}
            pendingLocate={auditChatLocate}
            onLocateConsumed={handleLocateConsumed}
            pendingPrompt={pendingChatPrompt}
            onPromptConsumed={consumeChatPrompt}
            onTitleChange={handleTitleChange}
          />
        </div>
      </div>
    </main>
  )
}
