import type { AgentSessionSnapshot } from '../../components/agent/AgentPanel'
import type { Item } from '../../components/sidebar/types'
import type { JournalChatTarget } from '../../lib/journalEvent'
import type { KubernetesClusterSelection } from '../../lib/kubernetesCluster'
import type {
  AwsEc2Instance,
  AwsLightsailInstance,
  DatabaseConnection,
  GcpComputeInstance,
  GithubInstallation,
  GitlabBinding,
  GrafanaInstance,
  Scope,
  UserInfo,
} from '../../types'
import type { AccountSet, AgentPromptSeed, WorkspaceTabState } from '../workspaceTabState'

export type UpdateWorkspaceTab = (
  tabId: string,
  updater: (tab: WorkspaceTabState) => WorkspaceTabState,
  options?: { history?: 'record' | 'replace' | 'restore' },
) => void

export type WorkspaceTabPaneProps = {
  conversationId?: string | null
  renderAgentPage?: boolean
  dockVisible?: boolean
  isTeamAdmin: boolean
  agentPaid: boolean
  tab: WorkspaceTabState
  active: boolean
  mounted: boolean
  accounts: AccountSet | undefined
  /** Dev-only console override — see the `onboarding.firstRun` hook. */
  firstRunDevForced: boolean
  databaseConnections: DatabaseConnection[] | undefined
  githubInstallations: GithubInstallation[]
  gitlabBindings: GitlabBinding[]
  grafanaInstances: GrafanaInstance[]
  user: UserInfo
  rootIntegrations: Item[]
  rootIntegrationsLoading: boolean
  scopeChipForPath: (href: string) => { label: string; icon: React.ReactNode } | null
  onOpenPath: (href: string, label: string, newTab: boolean) => void
  onOpenKey: (key: string, favoriteLabel: string | null, newTab: boolean) => void
  onDockAgentToSidebar: (snapshot: AgentSessionSnapshot | null) => void
  pendingPageImport: { tabId: string; snapshot: AgentSessionSnapshot } | null
  onPagePendingImportConsumed: () => void
  pendingChatPrompt: AgentPromptSeed | null
  onChatPromptConsumed: () => void
  onOpenNuphosLink: (href: string) => boolean
  onOpenNodeLink: (url: string) => void
  onOpenPlanInChat: (planId: string) => void
  onOpenConversation: (sessionId: string) => void
  /** Whether the Agent page hides its conversation rail. */
  railCollapsed: boolean
  /** Publishes the open conversation's title for the breadcrumb. */
  onAgentSessionTitle: (tabId: string, title: string) => void
  onOpenAuditConversation: (sessionId: string, locate?: JournalChatTarget) => void
  copyLink: (href: string) => Promise<void>
  openInChat: (href: string) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  /** Opens the first-run connect walkthrough in the right-hand dock. */
  onStartFirstRunConnect: () => void
  updateTab: UpdateWorkspaceTab
  onFilterChange: (filter: string) => void
  enterScopeInTab: (tabId: string, next: Scope, defaultActive?: string) => void
  enterCluster: (params: KubernetesClusterSelection & { tabId?: string }) => void
  openLightsailSshTab: (params: {
    teamId: string
    accountId: string
    instance: AwsLightsailInstance
  }) => void
  openEc2SshTab: (params: { teamId: string; accountId: string; instance: AwsEc2Instance }) => void
  openGceSshTab: (params: {
    teamId: string
    projectId: string
    instance: GcpComputeInstance
  }) => void
  onRequestBindGithub: (target: { teamId: string; tabId: string }) => void
  onRequestBindGitlab: (target: { teamId: string; tabId: string }) => void
  onOpenSettingsSection: (section: string) => void
  slackBindRequested: boolean
  onSlackBindHandled: () => void
}
