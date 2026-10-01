import { useCallback } from 'react'

import { isObservabilityActive } from '../../app/navItems'
import { toast } from '../../components/ui/toast'
import { DEFAULT_KEY } from '../../lib/appRoutes'
import { copyLinkWithFeedback } from '../../lib/copyLink'
import { isTeamId } from '../../lib/teamId'

import { selectActiveTab, selectScope } from './store/workspaceState'

import type { WorkspaceAccountsResult } from './useWorkspaceAccounts'
import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceInvitationsResult } from './useWorkspaceInvitations'
import type { WorkspaceNamespacesResult } from './useWorkspaceNamespaces'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceTeamResourcesResult } from './useWorkspaceTeamResources'
import type { WorkspaceTeamsResult } from './useWorkspaceTeams'
import type { WorkspaceProps } from './workspaceProps'
import type { AgentPromptSeed } from '../../app/workspaceTabState'
import type { AgentSessionSnapshot } from '../../components/agent/AgentPanel'
import type { Scope } from '../../types'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult &
  WorkspaceTeamsResult &
  WorkspaceInvitationsResult &
  WorkspaceTeamResourcesResult &
  WorkspaceNamespacesResult &
  WorkspaceAccountsResult

export function useWorkspaceScopeActions(a: Args) {
  const {
    workspaceStore,
    workspaceActions,
    setAgentSidebarPendingImport,
    setWorkspaceDockExpanded,
    chatPromptNonceRef,
    setPendingChatPromptQueue,
    updateTab,
  } = a

  const enterScopeInTab = useCallback(
    (tabId: string, next: Scope, defaultActive?: string) => {
      const nextActive =
        defaultActive ?? (next.kind === 'team' ? 'team.integrations' : DEFAULT_KEY[next.kind])

      updateTab(tabId, (tab) => {
        return {
          ...tab,
          scope: next,
          active: nextActive,
          // Entering the agent page (e.g. the "Home" breadcrumb) always means
          // Agent Home, never a silently-reopened conversation — same rule as the
          // left "Agent" nav item.
          agentSessionId: nextActive === 'team.agent' ? null : tab.agentSessionId,
          target: null,
          grafanaInstance:
            nextActive === 'observability.dashboards' && isObservabilityActive(tab.active)
              ? tab.grafanaInstance
              : null,
          dashboardTarget:
            nextActive === 'observability.dashboards' && isObservabilityActive(tab.active)
              ? tab.dashboardTarget
              : null,
          traceDatasourceTarget:
            nextActive === 'observability.dashboards' && isObservabilityActive(tab.active)
              ? tab.traceDatasourceTarget
              : null,
          logDatasourceTarget:
            nextActive === 'observability.dashboards' && isObservabilityActive(tab.active)
              ? tab.logDatasourceTarget
              : null,
          // Scope changes land on a section root — drop any open connector
          // basic-info drill-down so team.integrations shows the list again, and
          // any open dashboard so Dashboards shows its list page.
          connectorDetail: null,
          nuphosDashboard: null,
          filter: '',
          refreshKey: tab.refreshKey + 1,
          count: 0,
          viewLoading: false,
          sshTerminal: null,
        }
      })
    },
    [updateTab],
  )

  const enterScope = useCallback(
    (next: Scope, defaultActive?: string) => {
      const tab = selectActiveTab(workspaceStore.getState())

      if (tab) enterScopeInTab(tab.id, next, defaultActive)
    },
    [enterScopeInTab, workspaceStore],
  )

  const dockAgentToSidebar = useCallback(
    (snapshot: AgentSessionSnapshot | null) => {
      const tab = selectActiveTab(workspaceStore.getState())

      if (!tab) return
      setAgentSidebarPendingImport(snapshot)
      workspaceActions.selectSession(snapshot?.sessionId ?? null)
      updateTab(tab.id, (cur) =>
        cur.active === 'team.agent'
          ? {
              ...cur,
              active: 'team.integrations',
              filter: '',
              count: 0,
              agentSessionId: null,
            }
          : cur,
      )
      workspaceActions.setDockOpen(true)
    },
    [setAgentSidebarPendingImport, updateTab, workspaceActions, workspaceStore],
  )

  const openConversationInNewTab = useCallback(
    (sessionId: string, ownerTeamId?: string) => {
      if (!sessionId) return
      const teamId = isTeamId(ownerTeamId)
        ? ownerTeamId
        : selectScope(workspaceStore.getState())?.teamId

      if (!teamId) return
      workspaceActions.selectSession(sessionId, { teamId })
    },
    [workspaceActions, workspaceStore],
  )

  const copyLink = useCallback(
    (href: string) =>
      copyLinkWithFeedback(href, (value) => navigator.clipboard.writeText(value), {
        onSuccess: () =>
          toast.success('Link copied', undefined, {
            timeoutMs: 1200,
            dedupe: false,
          }),
        onError: () => toast.error('Could not copy link', 'Clipboard was blocked.'),
      }).then(() => {}),
    [],
  )

  const enqueueChatPrompt = useCallback(
    (prompt: AgentPromptSeed) => {
      setPendingChatPromptQueue((prev) => [...prev, prompt])
    },
    [setPendingChatPromptQueue],
  )

  const consumeChatPrompt = useCallback(() => {
    setPendingChatPromptQueue((prev) => prev.slice(1))
  }, [setPendingChatPromptQueue])

  const openInChat = useCallback(
    (href: string, _options?: { forceOpen?: boolean }) => {
      if (!href) return
      // Bump the ref-backed monotonic counter so each push gets a strictly
      // larger nonce than any previously consumed one — even after the
      // consumer dequeues the prompt.
      chatPromptNonceRef.current += 1
      // A seeded prompt is an interactive entry — leave any audit read-only
      // context or the composer would refuse the seed.
      workspaceActions.setSessionReadOnly(false)
      enqueueChatPrompt({
        text: href,
        mode: 'mention',
        nonce: chatPromptNonceRef.current,
      })
    },
    [chatPromptNonceRef, enqueueChatPrompt, workspaceActions],
  )

  // Open a fresh agent chat with a plain-text prompt. Auto-sends by default
  // (flows that hand off to the agent, such as cloud connector setup);
  // pass `send: false` to only prefill the composer — used by shortcuts that
  // seed context but want the user to review/edit the intent before sending
  // (e.g. Monitoring's "Watch with Agent").
  const openAgentChatWithPrompt = useCallback(
    (prompt: string, options?: { send?: boolean; background?: boolean }) => {
      chatPromptNonceRef.current += 1
      workspaceActions.setSessionReadOnly(false)
      if (!options?.background) {
        workspaceActions.selectSession(null)
        setWorkspaceDockExpanded(false)
      }
      enqueueChatPrompt({
        text: prompt,
        autoSend: options?.send !== false,
        newChat: true,
        mode: 'text',
        replace: options?.send === false,
        nonce: chatPromptNonceRef.current,
      })
    },
    [chatPromptNonceRef, enqueueChatPrompt, workspaceActions, setWorkspaceDockExpanded],
  )

  return {
    enterScopeInTab,
    enterScope,
    dockAgentToSidebar,
    openConversationInNewTab,
    copyLink,
    enqueueChatPrompt,
    consumeChatPrompt,
    openInChat,
    openAgentChatWithPrompt,
  }
}

export type WorkspaceScopeActionsResult = ReturnType<typeof useWorkspaceScopeActions>
