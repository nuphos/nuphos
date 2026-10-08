import { clsx } from 'clsx'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { connectedResourceLabels } from '../../app/accountScopes'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { EditableConversationTitle } from '../../components/agent/panel/ConversationTitleEditor'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { SessionParticipants } from '../../components/agent/SessionParticipants'
import { teamCanUseAgent } from '../../lib/agentAccess'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'
import { isLocalAgentRuntime } from '../../lib/localAgentSharing'
import { ConversationRail } from '../../views/ConversationRail'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'
import type { AgentProvider } from '../../types/runtime'

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
    workspaceActions,
    startFirstRunConnect,
    stableOpenNuphosLinkFromChat,
  } = ws
  const [heading, setHeading] = useState<{
    sessionId: string | null
    title: string
    canRename?: boolean
    runtime: AgentProvider | null
    runtimeId?: string
  }>({ sessionId: null, title: 'Agent', runtime: null })
  const [conversationRailCollapsed, setConversationRailCollapsed] = useState(true)
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
    (sessionId: string | null) => workspaceActions.selectSession(sessionId, { keepMainPage: true }),
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
  const handleTitleChange = useCallback(
    (
      nextTitle: string,
      sessionId: string | null,
      runtimeAttached: boolean,
      agentRuntime?: AgentProvider,
      canRename?: boolean,
      runtimeId?: string,
    ) => {
      setHeading({
        sessionId,
        canRename,
        runtimeId,
        title: nextTitle || 'Agent',
        runtime: runtimeAttached ? (agentRuntime ?? 'claude-code') : null,
      })
    },
    [],
  )

  // The dock covers this column instead of reflowing it: while expanded the
  // content keeps the width it had and the shrinking column clips it, until
  // the dock has finished its width transition back.
  const contentRef = useRef<HTMLDivElement>(null)

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
  const currentHeading =
    heading.sessionId === selectedSessionId
      ? heading
      : { sessionId: selectedSessionId, title: 'Agent', runtime: null }

  return (
    <main
      data-workspace-focus-surface="session"
      // An expanded dock shrinks this column to zero width rather than removing
      // it, so the dock's width transition slides over it.
      inert={workspaceExpanded}
      className={clsx(
        'min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-agentCanvas',
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
          <div className="titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 text-[13px] font-medium text-secondary">
            {currentHeading.runtime && (
              <AgentProviderIcon
                provider={currentHeading.runtime}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
            )}
            <EditableConversationTitle
              key={selectedSessionId ?? 'home'}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              canRename={currentHeading.canRename === true}
            />
          </div>
          {selectedSessionId && (
            <SessionParticipants
              key={selectedSessionId}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              currentUserId={user.id}
              warnLocalAgent={
                currentHeading.canRename === true && isLocalAgentRuntime(currentHeading.runtimeId)
              }
            />
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">
          <ConversationRail
            collapsed={conversationRailCollapsed}
            teamId={teamId}
            currentUserId={user.id}
            selectedSessionId={selectedSessionId}
            onOpenConversation={(sessionId) => handleSessionChange(sessionId)}
            onOpenConversationInNewTab={(sessionId) => handleSessionChange(sessionId)}
            onExpand={() => setConversationRailCollapsed(false)}
            onCollapse={() => setConversationRailCollapsed(true)}
          />
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
