import { clsx } from 'clsx'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { connectedResourceLabels } from '../../app/accountScopes'
import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { EditableConversationTitle } from '../../components/agent/panel/ConversationTitleEditor'
import { SessionHeaderMenu } from '../../components/agent/SessionHeaderMenu'
import { SessionParticipants } from '../../components/agent/SessionParticipants'
import { SessionTitlebarResources } from '../../components/agent/SessionTitlebarResources'
import { ChatSummaryPanel } from '../../components/agent/summary/ChatSummaryPanel'
import { ChatSummaryToggle } from '../../components/agent/summary/ChatSummaryToggle'
import { teamCanUseAgent } from '../../lib/agentAccess'
import { useChatSummaryOpen } from '../../lib/chatSummaryPanel'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'
import { isLocalAgentRuntime } from '../../lib/localAgentSharing'

import { PaneGrip } from './PaneGrip'
import { PaneMenu } from './PaneMenu'
import { SessionFindBar } from './SessionFindBar'
import { useTitlebarFit } from './titlebarFit'
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
  const pane = useWorkspacePane()
  const paneActive = pane?.active ?? true
  const paneInFront = paneActive && !ws.mainPageOpen
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
    stableOpenNuphosLinkFromChat,
    stableOpenSessionResource,
  } = ws
  const { currentHeading, handleTitleChange } = useSessionHeading(selectedSessionId)
  const summaryOpen = useChatSummaryOpen()
  const savedSessionId = currentHeading.saved !== false ? selectedSessionId : null
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

  const transcriptRef = useRef<HTMLDivElement>(null)
  const [titlebarRef, { compact, tight }] = useTitlebarFit()

  if (!teamId) return null
  const mayRename = currentHeading.canRename === true

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
      <div
        // Laid out at the width the column has once the dock settles, so the
        // dock's width transition slides over or uncovers it instead of
        // reflowing the transcript on every frame. Expanded keeps the docked width.
        style={{ width: dockOpen ? 'calc(100cqw - var(--workspace-dock-width))' : '100cqw' }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={titlebarRef}
          className={clsx(
            'workspace-agent-titlebar relative flex h-[44px] flex-shrink-0 items-center border-b border-zGray-800/60 pl-3',
            // The viewport-anchored dock toggle (see `.workspace-dock-toggle`)
            // sits over this header only while the dock is closed; once it is
            // open the toggle rides the dock's own tab strip instead.
            dockOpen ? 'pr-3' : 'pr-12',
          )}
        >
          {/* Drag area sits beside Share (no no-drag hole); it clips so chips never cover Share. */}
          <div
            key={`heading-${selectedSessionId ?? 'home'}`}
            className="t-session-heading titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary"
          >
            {selectedSessionId && (
              <AgentAvatar
                agentId={selectedSessionId}
                provider={currentHeading.runtime}
                animated
              />
            )}
            <EditableConversationTitle
              key={`title-${selectedSessionId ?? 'home'}`}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              canRename={mayRename}
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
              canManage={mayRename}
              warnLocalAgent={mayRename && isLocalAgentRuntime(currentHeading.runtimeId)}
              compact={compact}
            />
          )}
          {savedSessionId && (
            <SessionHeaderMenu
              key={`menu-${savedSessionId}`}
              sessionId={savedSessionId}
              teamId={teamId}
              userId={user.id}
              title={currentHeading.title}
              canRename={mayRename}
              canArchive={currentHeading.canArchive === true}
              watching={currentHeading.watching}
              shortcutsActive={ws.chatShortcutsLive && !ws.mainPageOpen && !workspaceExpanded}
              onRename={() => setRenamingSessionId(savedSessionId)}
              onFork={() => setAgentSidebarPendingFork(savedSessionId)}
              canFork={!selectedSessionReadOnly}
              onClosePane={pane?.split ? pane.closePane : undefined}
              summaryInMenu={tight}
            />
          )}
          {!savedSessionId && pane?.split && <PaneMenu onClosePane={pane.closePane} />}
          {savedSessionId && <ChatSummaryToggle active={paneInFront} hidden={tight} />}
          {/* The rest of the header moves the window, so a pane moves by its grip. Electron cuts
            no-drag holes in page order, so the grip comes after the drag area it sits over. */}
          <PaneGrip label={currentHeading.title} />
        </div>
        <SessionFindBar
          key={selectedSessionId ?? 'home'}
          rootRef={transcriptRef}
          active={paneInFront && !workspaceExpanded}
        />
        <div className="@container relative flex min-h-0 min-w-0 flex-1">
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
          {savedSessionId && (
            <ChatSummaryPanel
              key={savedSessionId}
              open={summaryOpen}
              sessionId={savedSessionId}
              teamId={teamId}
              onOpenLink={stableOpenSessionResource}
              onOpenSession={handleSessionChange}
            />
          )}
        </div>
      </div>
    </main>
  )
}
