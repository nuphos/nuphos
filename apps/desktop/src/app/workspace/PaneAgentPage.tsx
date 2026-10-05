import { MessageSquare } from 'lucide-react'

import { AgentPanel } from '../../components/agent/AgentPanel'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { ConversationRail } from '../../views/ConversationRail'

import type { AgentSessionSnapshot } from '../../components/agent/AgentPanel'
import type { UserInfo } from '../../types'
import type { PageMetaInput } from '../pageMetaContext'
import type { AgentPromptSeed, WorkspaceTabState } from '../workspaceTabState'
import type { UpdateWorkspaceTab } from './paneTypes'

type PaneAgentPageProps = {
  tab: WorkspaceTabState
  user: UserInfo
  active: boolean
  railCollapsed: boolean
  isTeamAdmin: boolean
  agentPaid: boolean
  pageHref: string
  agentUnbound: boolean
  agentConnectedResources: string[]
  pendingPageImport: { tabId: string; snapshot: AgentSessionSnapshot } | null
  pendingChatPrompt: AgentPromptSeed | null
  onDockAgentToSidebar: (snapshot: AgentSessionSnapshot | null) => void
  updateTab: UpdateWorkspaceTab
  onAgentSessionTitle: (tabId: string, title: string) => void
  onOpenConversation: (sessionId: string) => void
  onRailCollapsedChange: (collapsed: boolean) => void
  onOpenNuphosLink: (href: string) => boolean
  onOpenSettingsSection: (section: string) => void
  onStartFirstRunConnect: () => void
  onPagePendingImportConsumed: () => void
  onChatPromptConsumed: () => void
  setPageMeta: (input: PageMetaInput) => void
}

export function PaneAgentPage({
  tab,
  user,
  active,
  railCollapsed,
  isTeamAdmin,
  agentPaid,
  pageHref,
  agentUnbound,
  agentConnectedResources,
  pendingPageImport,
  pendingChatPrompt,
  onDockAgentToSidebar,
  updateTab,
  onAgentSessionTitle,
  onOpenConversation,
  onRailCollapsedChange,
  onOpenNuphosLink,
  onOpenSettingsSection,
  onStartFirstRunConnect,
  onPagePendingImportConsumed,
  onChatPromptConsumed,
  setPageMeta,
}: PaneAgentPageProps) {
  const tabId = tab.id

  return (
    <>
      {tab.scope.kind === 'team' && tab.active === 'team.agent' && (
        <ConversationRail
          collapsed={railCollapsed}
          teamId={tab.scope.teamId}
          currentUserId={user.id}
          refreshKey={tab.refreshKey}
          selectedSessionId={tab.agentSessionId}
          onOpenConversation={(sessionId, title) => {
            onAgentSessionTitle(tabId, title)
            updateTab(tabId, (cur) => ({ ...cur, agentSessionId: sessionId }))
          }}
          onOpenConversationInNewTab={(sessionId) => onOpenConversation(sessionId)}
          onExpand={() => onRailCollapsedChange(false)}
          onCollapse={() => onRailCollapsedChange(true)}
        />
      )}
      {tab.scope.kind === 'team' && tab.active === 'team.agent' && (
        <AgentPanel
          key={`agent-page-${tab.id}`}
          variant="page"
          open
          userName={user.name}
          url={pageHref}
          teamId={tab.scope.teamId}
          paid={agentPaid}
          isTeamAdmin={isTeamAdmin}
          kubeContext={tab.kubeconfigContext}
          unbound={agentUnbound}
          connectedResources={agentConnectedResources}
          onDockToSidebar={onDockAgentToSidebar}
          sessionId={tab.agentSessionId}
          onSessionChange={(sid) => updateTab(tabId, (cur) => ({ ...cur, agentSessionId: sid }))}
          onOpenNuphosLink={onOpenNuphosLink}
          onOpenAgentSettings={() => onOpenSettingsSection('workspace.agent')}
          onStartConnect={onStartFirstRunConnect}
          autoFocusComposer={active}
          pendingImport={pendingPageImport?.tabId === tabId ? pendingPageImport.snapshot : null}
          onImportConsumed={onPagePendingImportConsumed}
          pendingPrompt={pendingChatPrompt}
          onPromptConsumed={onChatPromptConsumed}
          onTitleChange={(title, reportedSessionId, claudeCodeRuntimeAttached, agentRuntime) => {
            // Reported with its session because the publish also fires on a
            // session change, while the panel still holds the outgoing
            // conversation — a stale title would flicker through both the tab
            // label and the breadcrumb.
            if (reportedSessionId === tab.agentSessionId) {
              onAgentSessionTitle(tabId, title)
            }
            setPageMeta({
              pageKey: 'team.agent',
              title: title || 'Agent',
              iconKey: claudeCodeRuntimeAttached ? (agentRuntime ?? 'claude-code') : 'agent',
              icon: claudeCodeRuntimeAttached ? (
                <AgentProviderIcon provider={agentRuntime} className="h-3.5 w-3.5" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />
              ),
              canonicalHref: pageHref,
            })
          }}
        />
      )}
    </>
  )
}
