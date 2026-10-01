import { useCallback, useEffect, useRef } from 'react'

import { api } from '../../api'
import { writeLocalStorage } from '../../app/localStorage'
import { LAST_TEAM_STORAGE_KEY } from '../../app/workspaceTabState'
import { ATLAS_WEB_BASE_URL } from '../../lib/webBaseUrl'

import { selectScope } from './store/workspaceState'
import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceScopeActionsResult } from './useWorkspaceScopeActions'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { AgentChatDeepLinkPayload, AgentFocusSessionPayload } from '../../api'
import type { JournalChatTarget } from '../../lib/journalEvent'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult &
  WorkspaceScopeActionsResult

export function useWorkspaceAgentLinks(a: Args) {
  const pane = useWorkspacePane()
  const paneActive = pane?.active ?? true
  const focusSession = pane?.focusSession
  const {
    user,
    workspaceActions,
    setError,
    setAgentSidebarPendingImport,
    setAgentSidebarPendingFork,
    setAuditChatLocate,
    chatPromptNonceRef,
    workspaceStore,
    openConversationInNewTab,
    enqueueChatPrompt,
    openInChat,
  } = a

  const openAgentChatDeepLink = useCallback(
    (payload: AgentChatDeepLinkPayload) => {
      if (payload.teamId) workspaceActions.openTeamTab(payload.teamId)
      const text = [
        payload.prompt,
        payload.cwd ? `Working directory: ${payload.cwd}` : '',
        payload.source ? `Source: ${payload.source}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')

      chatPromptNonceRef.current += 1
      workspaceActions.setSessionReadOnly(false)
      enqueueChatPrompt({
        text,
        filePaths: payload.files,
        autoSend: payload.autoSend,
        newChat: true,
        mode: 'text',
        nonce: chatPromptNonceRef.current,
      })
    },
    [chatPromptNonceRef, enqueueChatPrompt, workspaceActions],
  )

  useEffect(() => {
    if (paneActive) return api.onAgentChatDeepLink(openAgentChatDeepLink)
  }, [paneActive, openAgentChatDeepLink])

  // Clicking the "agent finished" notification: the main process only raises
  // the window, so the surface still holding that conversation has to be
  // brought forward here.
  const focusAgentSession = useCallback(
    ({ sessionId, teamId }: AgentFocusSessionPayload) => {
      if (focusSession?.(sessionId, teamId)) return
      openConversationInNewTab(sessionId, teamId)
    },
    [focusSession, openConversationInNewTab],
  )

  useEffect(() => {
    if (paneActive) return api.onAgentFocusSession(focusAgentSession)
  }, [paneActive, focusAgentSession])

  // "Open in chat" from the Plans library: stay on the current page, open the
  // docked agent sidebar, and seed the composer with a mention chip for the
  // plan (rendered as "Plan #N"), waiting for the user to send. Reuses the
  // same channel as the "Fix in chat" affordance.
  const planChatInFlightRef = useRef(false)
  const openPlanInChat = useCallback(
    (planId: string) => {
      const tid = selectScope(workspaceStore.getState())?.teamId

      // In-flight guard: rapid double-clicks must not enqueue overlapping
      // resume/fork operations.
      if (!planId || !tid || planChatInFlightRef.current) return
      planChatInFlightRef.current = true
      const seedPlanLink = () => openInChat(`${ATLAS_WEB_BASE_URL}/teams/${tid}/plans/${planId}`)

      // Continue a plan in the conversation it was proposed in:
      //  - your own plan  → resume that conversation in place (full context,
      //    writable; no duplicate fork);
      //  - someone else's → fork a writable copy carrying the context, since
      //    only the owner can write to the original.
      // Legacy plans with no source conversation fall back to seeding the
      // self-contained plan link.
      void api
        .agentGetPlan(planId, tid)
        .then((plan) => {
          if (!plan.sourceConversationId) {
            seedPlanLink()

            return
          }
          if (plan.createdBy === user.id) {
            workspaceActions.selectSession(plan.sourceConversationId)
          } else {
            // Clear the previously shown session first so sidebar reconciliation
            // can't race and clobber the forked tab.
            workspaceActions.selectSession(null)
            setAgentSidebarPendingFork(plan.sourceConversationId)
          }
        })
        .catch(seedPlanLink)
        .finally(() => {
          planChatInFlightRef.current = false
        })
    },
    [openInChat, setAgentSidebarPendingFork, user.id, workspaceActions, workspaceStore],
  )

  // Open a conversation surfaced by the Audit log: always a
  // read-only viewer, own session or not — an audit surface must never expose
  // approve/composer/fork. The backend already serves foreign team sessions
  // read-only; the flag additionally forces read-only for one's own.
  const openAuditConversation = useCallback(
    (sessionId: string, locate?: JournalChatTarget) => {
      if (!sessionId) return
      // A pending fork/import queued just before this click would land a
      // writable tab over the audit view — the audit open supersedes both.
      setAgentSidebarPendingFork(null)
      setAgentSidebarPendingImport(null)
      workspaceActions.selectSession(sessionId, { readOnly: true })
      setAuditChatLocate(locate ? { sessionId, target: locate } : null)
    },
    [
      setAgentSidebarPendingFork,
      setAgentSidebarPendingImport,
      setAuditChatLocate,
      workspaceActions,
    ],
  )

  const switchTeam = useCallback(
    (nextTeamId: string) => {
      workspaceActions.switchTeam(nextTeamId)
      writeLocalStorage(LAST_TEAM_STORAGE_KEY, nextTeamId)
      setError(null)
    },
    [setError, workspaceActions],
  )

  return {
    openPlanInChat,
    openAuditConversation,
    switchTeam,
  }
}

export type WorkspaceAgentLinksResult = ReturnType<typeof useWorkspaceAgentLinks>
