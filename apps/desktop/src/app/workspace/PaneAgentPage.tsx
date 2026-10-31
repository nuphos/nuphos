import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { markChannel, useIsChannel } from '../../components/channels/channelKind'
import { ChannelPane } from '../../components/channels/ChannelPane'
import { t } from '../../i18n'

import type { AgentSessionSnapshot } from '../../components/agent/AgentPanel'
import type { UserInfo } from '../../types'
import type { PageMetaInput } from '../pageMetaContext'
import type { AgentPromptSeed, WorkspaceTabState } from '../workspaceTabState'
import type { UpdateWorkspaceTab } from './paneTypes'

type PaneAgentPageProps = {
  tab: WorkspaceTabState
  user: UserInfo
  active: boolean
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
  onOpenNuphosLink: (href: string, beside?: boolean) => boolean
  onOpenSettingsSection: (section: string) => void
  onPagePendingImportConsumed: () => void
  onChatPromptConsumed: () => void
  setPageMeta: (input: PageMetaInput) => void
}

export function PaneAgentPage({
  tab,
  user,
  active,
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
  onOpenNuphosLink,
  onOpenSettingsSection,
  onPagePendingImportConsumed,
  onChatPromptConsumed,
  setPageMeta,
}: PaneAgentPageProps) {
  const tabId = tab.id
  const teamId = tab.scope.kind === 'team' ? tab.scope.teamId : undefined
  const channel = useIsChannel(teamId, tab.active === 'team.agent' ? tab.agentSessionId : null)

  // Still checking: neither view, so a channel never opens as an agent first.
  if (channel === undefined) return null
  if (channel && teamId && tab.agentSessionId)
    return (
      <ChannelPane
        key={tab.agentSessionId}
        teamId={teamId}
        channelId={tab.agentSessionId}
        user={user}
        dockOpen
        onOpenSession={(sid) => updateTab(tabId, (cur) => ({ ...cur, agentSessionId: sid }))}
      />
    )

  return (
    <>
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
          onSessionChange={(sid) => {
            if (sid) markChannel(sid, false)
            updateTab(tabId, (cur) => ({ ...cur, agentSessionId: sid }))
          }}
          onOpenNuphosLink={onOpenNuphosLink}
          onOpenAgentSettings={() => onOpenSettingsSection('workspace.agent')}
          autoFocusComposer={active}
          pendingImport={pendingPageImport?.tabId === tabId ? pendingPageImport.snapshot : null}
          onImportConsumed={onPagePendingImportConsumed}
          pendingPrompt={pendingChatPrompt}
          onPromptConsumed={onChatPromptConsumed}
          onTitleChange={(title, reportedSessionId, agentRuntime) => {
            // Reported with its session because the publish also fires on a
            // session change, while the panel still holds the outgoing
            // conversation — a stale title would flicker through both the tab
            // label and the breadcrumb.
            if (reportedSessionId === tab.agentSessionId) {
              onAgentSessionTitle(tabId, title)
            }
            setPageMeta({
              pageKey: 'team.agent',
              title: title || t('Agent'),
              iconKey: `${reportedSessionId ?? 'new'}:${agentRuntime ?? 'claude-code'}`,
              icon: reportedSessionId ? (
                <AgentAvatar agentId={reportedSessionId} provider={agentRuntime} size={16} />
              ) : (
                <AgentProviderIcon provider={agentRuntime} className="h-3.5 w-3.5" />
              ),
              canonicalHref: pageHref,
            })
          }}
        />
      )}
    </>
  )
}
