import { clsx } from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { EditableConversationTitle } from '../../components/agent/panel/ConversationTitleEditor'
import { SessionHeaderMenu } from '../../components/agent/SessionHeaderMenu'
import { SessionParticipants } from '../../components/agent/SessionParticipants'
import { SessionTitlebarResources } from '../../components/agent/SessionTitlebarResources'
import { ChatSummaryPanel } from '../../components/agent/summary/ChatSummaryPanel'
import { ChatSummaryToggle } from '../../components/agent/summary/ChatSummaryToggle'
import { useComposerReplyTarget } from '../../components/agent/summary/useComposerReplyTarget'
import { useSessionInputRequests } from '../../components/agent/summary/useSessionInputRequests'
import { HeaderEdge } from '../../components/ui/header-edge'
import { setChatSummaryDocked } from '../../lib/chatSummaryPanel'
import { t } from '../../i18n'
import { hasCloudOnboardingBinding } from '../../lib/connectorCategories'

import { CORNER_TITLEBAR_CLASS, CornerSidebarToggle } from './CornerSidebarToggle'
import { PaneCloseButton } from './PaneCloseButton'
import { PaneGrip } from './PaneGrip'
import { PaneMenu } from './PaneMenu'
import { SessionFindBar } from './SessionFindBar'
import { useTitlebarFit } from './titlebarFit'
import { useOwnPaneSummary } from './usePaneSummary'
import { useSessionHeading } from './useSessionHeading'
import { usePaneId, useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'
import type { JournalChatTarget } from '../../lib/journalEvent'
import type { UserInfo } from '../../types'

export function WorkspaceAgentPane({
  ws,
  user,
  workspaceExpanded = false,
  foreground = true,
}: {
  ws: WorkspaceController
  user: UserInfo
  workspaceExpanded?: boolean
  foreground?: boolean
}) {
  const pane = useWorkspacePane()
  const paneId = usePaneId()
  const paneActive = pane?.active ?? true
  const paneInFront = foreground && paneActive && !ws.mainPageOpen
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
  const { open: summaryOpen } = useOwnPaneSummary(selectedSessionId)

  // The open dock takes the right edge from the summary panel; see setChatSummaryDocked.
  useEffect(() => setChatSummaryDocked(paneId, dockOpen), [paneId, dockOpen])
  const savedSessionId = currentHeading.saved ? selectedSessionId : null
  // The titlebar menu's Rename opens the same inline editor as clicking the title.
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const teamId = scope?.teamId
  const inputQueue = useSessionInputRequests(savedSessionId, teamId)
  const { replyTarget, openQuestions } = useComposerReplyTarget(savedSessionId, teamId, inputQueue)
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
      if (!foreground) return
      if (!unshown) return workspaceActions.selectSession(sessionId, { keepMainPage: true })
      workspaceActions.forgetSession(unshown)
    },
    [workspaceActions, foreground],
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
  const handleOpenRequest = useCallback(
    (sessionId: string, target?: JournalChatTarget) => {
      workspaceActions.selectSession(sessionId, { keepMainPage: true })
      setAuditChatLocate(target ? { sessionId, target } : null)
    },
    [setAuditChatLocate, workspaceActions],
  )
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [titlebarRef, { compact, tight }] = useTitlebarFit()

  if (!teamId) return null
  const mayRename = currentHeading.canRename === true

  return (
    <main
      data-workspace-focus-surface="session"
      // An expanded dock shrinks this column to zero width rather than removing
      // it, so the dock's width transition slides over it.
      inert={workspaceExpanded || !foreground}
      className={clsx(
        'relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace-content-surface',
        dockOpen && 'workspace-content-surface--leading',
        workspaceExpanded && 'workspace-content-surface--collapsed',
        ws.mainPageOpen || !foreground ? 'hidden' : 'flex',
      )}
    >
      <div className="workspace-session-body flex min-h-0 w-full flex-1 flex-col">
        <div
          ref={titlebarRef}
          className={clsx(
            'workspace-agent-titlebar sheet-titlebar-row relative flex flex-shrink-0 items-center pl-3',
            pane?.cornerPane && CORNER_TITLEBAR_CLASS,
            // The viewport-anchored dock toggle (see `.workspace-dock-toggle`)
            // sits over this header only while the dock is closed; once it is
            // open the toggle rides the dock's own tab strip instead.
            dockOpen ? 'pr-3' : 'pr-12',
          )}
        >
          <CornerSidebarToggle />
          {/* Drag area sits beside Share (no no-drag hole); it clips so chips never cover Share. */}
          <div
            key={`heading-${selectedSessionId ?? 'home'}`}
            className="t-session-heading titlebar-drag flex min-w-0 flex-1 self-stretch items-center gap-2 overflow-hidden text-[13px] font-medium text-secondary"
          >
            {selectedSessionId && (
              // A Task is its runtime here, even a Bot's: the face belongs to its chat.
              <AgentAvatar
                agentId={selectedSessionId}
                provider={currentHeading.runtime}
                face={false}
                animated
              />
            )}
            <EditableConversationTitle
              key={`title-${selectedSessionId ?? 'home'}`}
              sessionId={selectedSessionId}
              teamId={teamId}
              title={selectedSessionId ? currentHeading.title : t('New Task')}
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
          {savedSessionId && (
            <SessionParticipants
              key={savedSessionId}
              sessionId={savedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              currentUserId={user.id}
              canManage={mayRename}
              compact={compact}
            />
          )}
          {savedSessionId && (
            <SessionHeaderMenu
              key={`menu-${savedSessionId}`}
              sessionId={savedSessionId}
              teamId={teamId}
              title={currentHeading.title}
              canRename={mayRename}
              canArchive={currentHeading.canArchive === true}
              watching={currentHeading.watching}
              shortcutsActive={paneInFront && ws.chatShortcutsLive && !workspaceExpanded}
              onRename={() => setRenamingSessionId(savedSessionId)}
              onFork={() => setAgentSidebarPendingFork(savedSessionId)}
              canFork={!selectedSessionReadOnly}
              onClosePane={pane?.split ? pane.closePane : undefined}
              summaryInMenu={tight}
            />
          )}
          {!savedSessionId && pane?.split && <PaneMenu onClosePane={pane.closePane} />}
          {savedSessionId && (
            <ChatSummaryToggle
              active={paneInFront}
              hidden={tight}
              pendingCount={inputQueue.requests.length}
              sessionId={savedSessionId}
            />
          )}
          {pane?.split && <PaneCloseButton onClosePane={pane.closePane} />}
          {/* The rest of the header moves the window, so a pane moves by its grip. Electron cuts
            no-drag holes in page order, so the grip comes after the drag area it sits over. */}
          <PaneGrip label={currentHeading.title} />
        </div>
        <SessionFindBar
          key={selectedSessionId ?? 'home'}
          rootRef={transcriptRef}
          active={paneInFront && !workspaceExpanded}
        />
        <HeaderEdge className="@container relative flex min-h-0 min-w-0 flex-1">
          <div ref={transcriptRef} className="flex min-h-0 min-w-0 flex-1">
            <AgentPanel
              key={`agent-main-${teamId}`}
              variant="page"
              open={!workspaceExpanded && foreground}
              userName={user.name}
              runtimeUrlRef={runtimeUrlRef}
              teamId={teamId}
              isTeamAdmin={currentTeam?.role === 'ADMINISTRATOR'}
              runtimeKubeContextRef={runtimeKubeContextRef}
              unbound={unbound}
              autoFocusComposer={paneInFront && !dockOpen}
              // A pane in the background that opens a chat must not take the keyboard.
              focusComposerOnOpen={paneInFront}
              newChatRequest={ws.newChatRequest}
              newChatDraftId={paneId}
              sessionId={selectedSessionId}
              sessionReadOnly={selectedSessionReadOnly}
              decisionReplyTo={replyTarget?.chosen ?? undefined}
              replyTarget={replyTarget}
              openQuestions={openQuestions}
              onSessionChange={handleSessionChange}
              onOpenNuphosLink={stableOpenNuphosLinkFromChat}
              onOpenAgentSettings={handleOpenAgentSettings}
              pendingImport={foreground ? agentSidebarPendingImport : null}
              onImportConsumed={handleImportConsumed}
              pendingForkSessionId={foreground ? agentSidebarPendingFork : null}
              onForkConsumed={clearAgentSidebarPendingFork}
              pendingLocate={foreground ? auditChatLocate : null}
              onLocateConsumed={handleLocateConsumed}
              pendingPrompt={foreground ? pendingChatPrompt : null}
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
              onOpenRequest={handleOpenRequest}
              onChooseReply={replyTarget?.onChoose}
              requests={inputQueue.requests}
              requestsLoaded={inputQueue.loaded}
              requestsFailed={inputQueue.failed}
            />
          )}
        </HeaderEdge>
      </div>
    </main>
  )
}
