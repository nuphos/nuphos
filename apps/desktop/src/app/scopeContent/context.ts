import type { DatasourceSummary } from '../../grafana/client'
import type { useClusterAccessProbe } from '../../hooks/useClusterAccessProbe'
import type {
  AwsResourceDetailRef,
  AwsS3Detail,
  CloudflareResourceDetailRef,
  ConnectorDetailRef,
  LinearNavState,
  NuphosDashboardRef,
  RepoProvider,
  TriggerFormRef,
} from '../../lib/appRoutes'
import type { JournalChatTarget } from '../../lib/journalEvent'
import type { KubernetesClusterSelection } from '../../lib/kubernetesCluster'
import type {
  AtlasCluster,
  AwsAccount,
  AwsEc2Instance,
  AwsEcsCluster,
  AwsLightsailInstance,
  CloudflareZone,
  DatabaseConnection,
  GcpComputeInstance,
  GcpProject,
  GithubInstallation,
  GitlabBinding,
  GrafanaInstance,
  Scope,
} from '../../types'
import type { DetailTarget } from '../../views/DetailView'
import type { GithubNavState } from '../../views/GithubView'
import type { GitlabNavState } from '../../views/gitlabNav'
import type { AccountSet, SshTerminalTabState } from '../workspaceTabState'

export type ScopeContentProps = {
  scope: Scope
  active: string
  currentUserId: string
  filter: string
  browserUrl?: string
  onBrowserNavigate?: (url: string) => void
  onFilterChange: (filter: string) => void
  refreshKey: number
  /** Per-tab kubeconfig context; null when no cluster has been selected.
   *  Cluster-scoped views read this via `useKubeContext` to route k8s IPC. */
  kubeconfigContext: string | null
  /** Set when auto-rehydration of `kubeconfigContext` failed for this tab.
   *  Rendered in the cluster-scope placeholder so the user can see *why*
   *  the view isn't loading instead of an indefinite spinner. */
  kubeconfigContextError: string | null
  namespace: string
  accounts: AccountSet | undefined
  githubInstallations: GithubInstallation[]
  gitlabBindings: GitlabBinding[]
  grafanaInstances: GrafanaInstance[]
  target: DetailTarget | null
  setTarget: (t: DetailTarget | null) => void
  s3Detail: AwsS3Detail | null
  setS3Detail: (d: AwsS3Detail | null) => void
  architectureDetail: { diagramId: string; diagramName: string } | null
  setArchitectureDetail: (d: { diagramId: string; diagramName: string } | null) => void
  triggerDetail: { triggerId: string; triggerName: string } | null
  setTriggerDetail: (d: { triggerId: string; triggerName: string } | null) => void
  triggerForm: TriggerFormRef | null
  setTriggerForm: (f: TriggerFormRef | null) => void
  nuphosDashboard: NuphosDashboardRef | null
  setNuphosDashboard: (d: NuphosDashboardRef | null) => void
  nuphosDashboards: { id: string; name: string }[] | undefined
  setNuphosDashboards: (dashboards: { id: string; name: string }[]) => void
  linearNav: LinearNavState | null
  setLinearNav: (nav: LinearNavState) => void
  restoredTitle: string | undefined
  connectorDetail: ConnectorDetailRef | null
  setConnectorDetail: (d: ConnectorDetailRef | null) => void
  awsDetail: AwsResourceDetailRef | null
  setAwsDetail: (d: AwsResourceDetailRef | null) => void
  cloudflareDetail: CloudflareResourceDetailRef | null
  setCloudflareDetail: (d: CloudflareResourceDetailRef | null) => void
  addIntegrationOpen: boolean
  setAddIntegrationOpen: (open: boolean) => void
  grafanaInstance: { id: string; name: string; url: string } | null
  setGrafanaInstance: (i: { id: string; name: string; url: string } | null) => void
  dashboardTarget: { uid: string; title: string; folderTitle?: string } | null
  setDashboardTarget: (t: { uid: string; title: string; folderTitle?: string } | null) => void
  traceDatasourceTarget: DatasourceSummary | null
  logDatasourceTarget: DatasourceSummary | null
  sshTerminal: SshTerminalTabState | null
  setTraceDatasourceTarget: (t: DatasourceSummary | null) => void
  setLogDatasourceTarget: (t: DatasourceSummary | null) => void
  githubNav: GithubNavState
  setGithubNav: (nav: GithubNavState) => void
  gitlabNav: GitlabNavState
  setGitlabNav: (nav: GitlabNavState) => void
  repoProvider: RepoProvider
  setRepoProvider: (provider: RepoProvider) => void
  onConnectGithub: () => void
  onConnectGitlab: () => void
  onOpenSettingsSection: (section: string) => void
  slackBindRequested: boolean
  onSlackBindHandled: () => void
  onSelectActive: (key: string, filter?: string) => void
  onCount: (n: number) => void
  onLoading: (loading: boolean) => void
  onPickAwsRole: (a: AwsAccount) => void
  onPickGcpServiceAccount: (p: GcpProject) => void
  onOpenAwsAccountRoles: (accountId: string) => void
  onOpenAwsAccountResources: (accountId: string) => void
  onExitToConnectors: () => void
  onOpenDatabaseConnection: (connectionId: string) => void
  onOpenDatabaseConnectionOverview: (connectionId: string) => void
  databaseConnections: DatabaseConnection[] | undefined
  onOpenAzureSubscriptionApps: (subscriptionId: string) => void
  onOpenGcpProjectServiceAccounts: (projectId: string) => void
  onOpenGcpProjectResources: (projectId: string) => void
  onOpenCloudflareAccountIam: (accountId: string) => void
  onOpenCloudflareAccountResources: (accountId: string) => void
  onOpenLinodeAccount: (accountId: string) => void
  onOpenHetznerAccount: (accountId: string) => void
  onOpenTencentAccount: (accountId: string) => void
  onOpenAliyunAccount: (accountId: string) => void
  onOpenVolcengineAccount: (accountId: string) => void
  onOpenBetterStackIntegration: (integrationId: string) => void
  onOpenUptimeKumaInstance: (instanceId: string) => void
  onOpenTailscaleClient: (clientId: string) => void
  onOpenZeaburProvider: (zeaburId: string) => void
  onPickCloudflareZone: (z: CloudflareZone) => void
  onPickCluster: (c: AtlasCluster) => void
  onPickEcsCluster: (c: AwsEcsCluster) => void
  // Re-fetch this tab's cluster kubeconfig (VKE: issue a fresh credential) and
  // repoint the tab at the returned context — the RBAC mask's re-check.
  refreshClusterKubeconfig: () => Promise<void>
  onOpenLightsailSsh: (params: {
    teamId: string
    accountId: string
    roleId?: string
    instance: AwsLightsailInstance
  }) => void
  onOpenEc2Ssh: (params: {
    teamId: string
    accountId: string
    roleId?: string
    instance: AwsEc2Instance
  }) => void
  onOpenGceSsh: (params: {
    teamId: string
    projectId: string
    serviceAccountId?: string
    instance: GcpComputeInstance
  }) => void
  onAccountsChanged: () => void
  enterCluster: (params: KubernetesClusterSelection & { tabId?: string }) => void
  /** Seed the agent chat with text (used by the "Fix in chat" affordance
   *  on error blocks that can be self-remediated by the agent). */
  openInChat: (text: string) => void
  /** Open a fresh agent chat and auto-send the given prompt. */
  onOpenAgentChat: (prompt: string, options?: { send?: boolean }) => void
  /** Open a plan (from the Plans library) in the agent chat side panel. */
  onOpenPlanInChat: (planId: string) => void
  onOpenConversation: (sessionId: string) => void
  /** Viewer is a team administrator — gates approving permission-grant rows in the Plans library. */
  isTeamAdmin: boolean
  onOpenAuditConversation: (sessionId: string, locate?: JournalChatTarget) => void
  /** Open a node's link: nuphos.ai pages open in-app, everything else external. */
  onOpenNodeLink: (url: string) => void
}

export type RenderPage = (
  pageKey: string,
  title: string,
  icon: React.ReactNode,
  content: React.ReactNode,
) => React.ReactNode

export type RenderActiveNavPage = (
  fallbackTitle: string,
  fallbackIcon: React.ReactNode,
  content: React.ReactNode,
) => React.ReactNode

export type ScopeRenderContext = ScopeContentProps & {
  renderPage: RenderPage
  renderActiveNavPage: RenderActiveNavPage
  clusterAccess: ReturnType<typeof useClusterAccessProbe>
  scopedDatabaseConnection: DatabaseConnection | undefined
  awsRoleId: string | undefined
  gcpServiceAccountId: string | undefined
}

/** A section renderer returns undefined when its branches don't match; a
 *  rendered value (including null) means the page is handled. */
export type ScopeSectionRenderer = (ctx: ScopeRenderContext) => React.ReactNode | undefined
